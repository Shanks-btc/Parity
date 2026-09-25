"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "./Logo";
import { MenuIcon } from "./icons";

type Tone = "light" | "dark";
type NavKey = "portfolio" | "earn" | "borrow" | "trade";

// Portfolio/Earn/Borrow have no screens yet (later phase) — kept as the mockup's hash links.
// Trade points at the real /trade concept page this phase builds (the mockup had "#trade").
const LINKS: { key: NavKey; label: string; href: string }[] = [
  { key: "earn", label: "Earn", href: "#earn" },
  { key: "borrow", label: "Borrow", href: "#borrow" },
  { key: "trade", label: "Trade", href: "/trade" },
  { key: "portfolio", label: "Portfolio", href: "#portfolio" },
];

const TONES = {
  light: {
    // Sticky header: translucent paper + blur so content scrolling underneath doesn't collide
    // with the links (90% opaque keeps text behind it from showing through legibly).
    header: "border-line bg-paper/90",
    link: "text-ink hover:text-gold-text",
    soon: "text-ink-faint",
    soonTag: "border-line-strong text-ink-faint",
    menuButton: "border-line-strong text-ink",
    panel: "border-line bg-surface",
    panelDivider: "border-line-soft",
    pad: "xl:px-[56px]",
  },
  dark: {
    header: "border-term-line bg-charcoal/90",
    link: "text-term-text hover:text-gold",
    soon: "text-term-faint",
    soonTag: "border-term-line text-term-faint",
    menuButton: "border-term-control text-term-text",
    panel: "border-term-line bg-term-surface",
    panelDivider: "border-term-line",
    pad: "xl:px-[40px]",
  },
} as const;

/**
 * Shared header for both modes. At md and up the links sit inline; below md they collapse into a
 * menu button with a dropdown, while the right-hand action (Connect Wallet / wallet chip) stays
 * visible at every width.
 */
export function SiteNav({ tone, active, action }: { tone: Tone; active?: NavKey; action: ReactNode }) {
  const t = TONES[tone];
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Inline bar links are 13px (was 14) so the 30px logo clearly leads; the mobile dropdown keeps 14px
  // because there the links are the whole content and need a comfortable tap-and-read size.
  const linkClass = (variant: "inline" | "menu") =>
    `font-mono font-medium tracking-[0.01em] ${variant === "inline" ? "text-[13px]" : "text-[14px]"}`;

  const items = (variant: "inline" | "menu") =>
    LINKS.map(({ key, label, href }) => {
      if (key === active) {
        return (
          <span
            key={key}
            aria-current="page"
            className={`${linkClass(variant)} text-gold ${
              variant === "inline" ? "-mb-[25px] border-b-2 border-gold pb-[24px]" : "block py-[12px]"
            }`}
          >
            {label}
          </span>
        );
      }
      const className = `${linkClass(variant)} ${t.link} ${variant === "menu" ? "block py-[12px]" : ""}`;
      const onClick = variant === "menu" ? () => setOpen(false) : undefined;
      return href.startsWith("/") ? (
        <Link key={key} href={href} className={className} onClick={onClick}>
          {label}
        </Link>
      ) : (
        <a key={key} href={href} className={className} onClick={onClick}>
          {label}
        </a>
      );
    });

  const spend = (variant: "inline" | "menu") => (
    <span
      aria-disabled="true"
      className={`pointer-events-none flex items-center gap-[6px] ${linkClass(variant)} ${t.soon} ${variant === "menu" ? "py-[12px]" : ""}`}
    >
      Spend <span className={`rounded border px-[5px] py-px text-[10px] ${t.soonTag}`}>SOON</span>
    </span>
  );

  return (
    // Sticky (not fixed): it stays in flow, so no body padding is needed to compensate.
    <header className={`sticky top-0 z-50 border-b backdrop-blur-md ${t.header}`}>
      <div className={`mx-auto flex max-w-[1440px] items-center justify-between gap-[12px] px-[16px] py-[16px] md:px-[40px] md:py-[28px] ${t.pad}`}>
        <div className="flex items-center md:gap-[24px] lg:gap-[44px]">
          <Logo tone={tone} href="/" />
          <nav aria-label="Primary" className="hidden items-center gap-[20px] md:flex lg:gap-[32px]">
            {items("inline")}
            {spend("inline")}
          </nav>
        </div>

        <div className="flex items-center gap-[8px]">
          {action}
          <button
            type="button"
            className={`flex size-[40px] shrink-0 cursor-pointer items-center justify-center rounded-lg border md:hidden ${t.menuButton}`}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="site-menu"
            onClick={() => setOpen((o) => !o)}
          >
            <MenuIcon open={open} />
          </button>
        </div>
      </div>

      {open && (
        <nav id="site-menu" aria-label="Primary (mobile)" className={`absolute inset-x-0 top-full z-20 border-b md:hidden ${t.panel}`}>
          <ul className="flex flex-col px-[16px] py-[4px]">
            {[...items("menu"), spend("menu")].map((item, i) => (
              <li key={i} className={`border-b last:border-b-0 ${t.panelDivider}`}>
                {item}
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
