import type { ReactNode } from "react";

/**
 * Full-bleed band (top rule + optional background) with the content capped at the 1440px design
 * width. Padding follows the mockup's 72px/56px at xl and steps down for smaller screens.
 */
export function Section({
  children,
  className = "",
  id,
  labelledBy,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  labelledBy?: string;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={`border-t border-line ${className}`}>
      <div className="mx-auto max-w-[1440px] px-4 py-14 md:px-10 md:py-[72px] xl:px-14">{children}</div>
    </section>
  );
}

export function SectionTitle({ id, children, className = "" }: { id: string; children: ReactNode; className?: string }) {
  return (
    <h2 id={id} className={`m-0 font-serif text-[28px] font-semibold leading-tight text-ink md:text-[34px] ${className}`}>
      {children}
    </h2>
  );
}

/** Small dot + mono uppercase label ("STEP ONE", "INFRASTRUCTURE"). */
export function DotLabel({ tone, children }: { tone: "gold" | "clay" | "positive"; children: ReactNode }) {
  const color = { gold: "text-gold-text", clay: "text-clay-text", positive: "text-positive" }[tone];
  const dot = { gold: "bg-gold-text", clay: "bg-clay-text", positive: "bg-positive" }[tone];
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block size-1.5 rounded-full ${dot}`} />
      <span className={`font-mono text-[11px] tracking-[0.04em] ${color}`}>{children}</span>
    </div>
  );
}
