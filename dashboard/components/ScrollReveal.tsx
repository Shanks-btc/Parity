"use client";

import { useEffect } from "react";
import { easeOutCubic, parseTokens, renderAt } from "@/lib/countup";

/** Count-up length — quick and subtle, well under a second. */
const COUNT_MS = 800;

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
 *
 * Count-up ([data-countup] figures, see CountUp.tsx) rides on the SAME observer, so the number arriving and the section
 * fading in are one entrance: when a section is hidden its figures are primed to zero, and when it is revealed they
 * count up to the exact text they were rendered with (parsed from that text — never a separate target). Figures in a
 * section already on screen at load are left alone, like the fade-in; reduced motion returns before any of this runs.
 */
export function ScrollReveal({ selector = "main > section" }: { selector?: string }) {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!("IntersectionObserver" in window)) return;

    const frames = new Set<number>();
    const primed: HTMLElement[] = [];
    const figures = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[data-countup]")];
    const prime = (root: HTMLElement) =>
      figures(root).forEach((el) => {
        el.dataset.countupFinal ??= el.textContent ?? "";
        primed.push(el);
        el.textContent = renderAt(el.dataset.countupFinal, parseTokens(el.dataset.countupFinal), 0);
      });
    const count = (root: HTMLElement) =>
      figures(root).forEach((el) => {
        const final = el.dataset.countupFinal ?? el.textContent ?? "";
        const tokens = parseTokens(final);
        const t0 = performance.now();
        const step = (now: number) => {
          const p = Math.min(1, (now - t0) / COUNT_MS);
          el.textContent = renderAt(final, tokens, easeOutCubic(p));
          if (p < 1) frames.add(requestAnimationFrame(step));
          else el.textContent = final; // exactly the rendered value, never a rounded approximation
        };
        frames.add(requestAnimationFrame(step));
      });

    // Fires when a section's top edge is 10% above the viewport's bottom edge.
    const margin = 0.1;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.reveal = "shown";
          count(entry.target as HTMLElement);
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
      prime(el);
      hidden.push(el);
      observer.observe(el);
    });

    return () => {
      observer.disconnect();
      frames.forEach(cancelAnimationFrame);
      // Strict-mode remount / route change: never leave anything hidden — or stuck mid-count — behind.
      hidden.forEach((el) => delete el.dataset.reveal);
      primed.forEach((el) => {
        if (el.dataset.countupFinal !== undefined) el.textContent = el.dataset.countupFinal;
      });
    };
  }, [selector]);

  return null;
}
