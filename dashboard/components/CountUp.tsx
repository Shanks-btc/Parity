import type { ElementType, ReactNode } from "react";

/**
 * A figure that counts up from 0 when its section scrolls into view (driven by ScrollReveal — the same observer as the
 * fade-in). It renders the REAL final text, so server HTML, no-JS and reduced-motion users all simply see the value;
 * the animation only changes how it arrives. `children` must be the plain figure string, e.g. "7.43%".
 */
export function CountUp({ as: Tag = "div", className, children }: { as?: ElementType; className?: string; children: ReactNode }) {
  return (
    <Tag data-countup="" className={className}>
      {children}
    </Tag>
  );
}
