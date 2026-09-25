"use client";

import { useEffect } from "react";

/**
 * Fade-in-up reveal for the landing page's sections, driven by one IntersectionObserver.
 *
 * Mounted once from the page; it finds `main > section` elements itself instead of wrapping each
 * section, so the sections stay direct children of <main> (and stay server components). The CSS
 * lives in globals.css ([data-reveal]).
 *
 * Rules, chosen so nothing can end up stuck invisible:
 *  - prefers-reduced-motion: reduce → does nothing at all (content is simply visible).
 *  - The hero, and any section already on screen at load, is left alone (no hide → flash → show).
 *  - Sections below the fold get `data-reveal="hidden"`, then "shown" the first time they cross
 *    into view (observer disconnects after that — it animates once, not on every scroll).
 *  - No IntersectionObserver / no JS → nothing is ever hidden.
 */
export function ScrollReveal({ selector = "main > section" }: { selector?: string }) {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!("IntersectionObserver" in window)) return;

    // Fires when a section's top edge is 10% above the viewport's bottom edge.
    const margin = 0.1;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.reveal = "shown";
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0, rootMargin: `0px 0px -${margin * 100}% 0px` }
    );

    const hidden: HTMLElement[] = [];
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      if (el.matches('[aria-labelledby="hero-title"]')) return;
      // Already in (or above) the trigger zone: leave visible rather than flicker it.
      if (el.getBoundingClientRect().top < window.innerHeight * (1 - margin)) return;
      el.dataset.reveal = "hidden";
      hidden.push(el);
      observer.observe(el);
    });

    return () => {
      observer.disconnect();
      // Strict-mode remount / route change: never leave anything hidden behind.
      hidden.forEach((el) => delete el.dataset.reveal);
    };
  }, [selector]);

  return null;
}
