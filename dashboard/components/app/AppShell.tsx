import type { ReactNode } from "react";
import { SiteNav } from "../SiteNav";
import { Footer } from "../landing/Footer";
import { ConnectWalletButton } from "../wallet/ConnectWalletButton";

type NavKey = "portfolio" | "earn" | "borrow" | "trade";

/** Light app frame shared by Borrow, Earn and Portfolio: sticky nav (with the wallet button) → content → footer. */
export function AppShell({ active, children }: { active?: NavKey; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-paper font-serif text-ink">
      <SiteNav tone="light" active={active} action={<ConnectWalletButton />} />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}

/** Page container: the 1440px design width with the landing page's gutters. */
export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1440px] px-4 py-10 md:px-10 md:py-14 xl:px-14 ${className}`}>{children}</div>;
}

export function PageHeader({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: ReactNode }) {
  return (
    <header className="mb-8 md:mb-10">
      {eyebrow && <div className="mb-3 font-mono text-[11px] tracking-[0.04em] text-gold-strong">{eyebrow}</div>}
      <h1 className="m-0 font-serif text-[32px] font-semibold leading-tight text-ink md:text-[42px]">{title}</h1>
      {subtitle && <p className="mb-0 mt-3 max-w-[680px] font-serif text-[16px] leading-normal text-ink-muted md:text-[17px]">{subtitle}</p>}
    </header>
  );
}

/** Small loading / error / notice strip used by every data-backed panel. */
export function Notice({ tone = "neutral", children }: { tone?: "neutral" | "clay" | "positive" | "gold"; children: ReactNode }) {
  const cls = {
    neutral: "border-line bg-surface text-ink-muted",
    clay: "border-clay-text/40 bg-clay-tint text-clay-text",
    positive: "border-positive/40 bg-positive-tint text-ink",
    gold: "border-gold-deep/40 bg-gold-tint text-gold-strong",
  }[tone];
  return <div role={tone === "clay" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 font-serif text-[14px] leading-normal ${cls}`}>{children}</div>;
}
