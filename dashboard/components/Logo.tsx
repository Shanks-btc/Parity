import { HomeLink } from "./HomeLink";

/**
 * Parity's logo lockup: a tapered gold checkmark (no tile behind it) + the "Parity" logotype in
 * Manrope 800, letter-spacing −1px. The logotype is deliberately NOT Fraunces — it is a separate
 * treatment from the page's headings, which keep Fraunces. In the header it is deliberately the
 * largest text in the bar (30px vs. 13px links) so the brand mark leads the hierarchy.
 *
 * The checkmark path was drawn in a 140×130 box but only occupies x 65.35–132.2, y 55.47–121.25
 * (computed by sampling the curves), so the viewBox is cropped to that box + 1px. Without the
 * crop it would render at roughly half the intended size.
 */
const CHECK_PATH =
  "M 66,104 C 70,100 78,98 84,108 C 90,118 96,124 100,120 C 108,108 122,78 132,58 C 133,56 130,54 128,57 C 118,76 104,104 99,112 C 94,106 85,92 76,92 C 71,92 63,98 66,104 Z";

export function CheckMark({ size, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="64.3 54.4 68.9 67.9"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d={CHECK_PATH} />
    </svg>
  );
}

/**
 * `tone` only sets the wordmark colour (ink on light pages, near-white on dark ones); the
 * checkmark is the same gold (#C9973A) everywhere. `size="sm"` is the footer variant.
 * With `href`, the whole lockup (icon + text) is one link to the landing page ("/") — see
 * HomeLink for how a click behaves when you're already there.
 */
export function Logo({
  tone = "light",
  size = "md",
  href,
}: {
  tone?: "light" | "dark";
  size?: "sm" | "md";
  href?: string;
}) {
  const small = size === "sm";
  const lockup = (
    <>
      {/* Header lockup: 28px/34px on phones, 30px/37px from md up (icon ≈ 1.2× the wordmark size).
          Footer ("sm"): 19px/24px, unchanged. */}
      <CheckMark className={`shrink-0 text-gold-deep ${small ? "size-[24px]" : "size-[clamp(28px,9vw,34px)] md:size-[37px]"}`} />
      Parity
    </>
  );
  const className = `flex items-center font-logo font-extrabold leading-none tracking-[-1px] ${
    small ? "gap-[8px] text-[19px]" : "gap-[8px] text-[clamp(22px,7.4vw,28px)] md:gap-[10px] md:text-[30px]"
  } ${tone === "dark" ? "text-term-text" : "text-ink"}`;

  return href ? (
    <HomeLink className={`${className} rounded-md`}>{lockup}</HomeLink>
  ) : (
    <span className={className}>{lockup}</span>
  );
}
