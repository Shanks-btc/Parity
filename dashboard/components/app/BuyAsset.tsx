import Link from "next/link";

/**
 * "Don't have AAPLx yet? Buy it here." Same-tab links to the in-app swap on the Trade page (Spot mode), never to an
 * outside site. `next` tells the swap where its "Continue" button should go after a purchase (Multiply, or Borrow).
 */
export const buyHref = (symbol: string, next?: "multiply") => `/trade?asset=${symbol}&mode=spot${next ? `&next=${next}` : ""}`;

const linkClass = "text-gold-strong underline underline-offset-2 hover:text-gold-text";

export function BuyAsset({ symbols, next, className = "" }: { symbols: string[]; next?: "multiply"; className?: string }) {
  if (symbols.length === 0) return null;
  if (symbols.length === 1) {
    const symbol = symbols[0];
    return (
      <p data-testid="buy-in-app" className={`m-0 font-serif text-[13px] leading-normal text-ink-muted ${className}`}>
        Don&apos;t have {symbol} yet?{" "}
        <Link href={buyHref(symbol, next)} className={linkClass}>
          Buy it here →
        </Link>
      </p>
    );
  }
  return (
    <p data-testid="buy-in-app" className={`m-0 font-serif text-[13px] leading-normal text-ink-muted ${className}`}>
      Don&apos;t have the stock yet? Buy it here:{" "}
      {symbols.map((s, i) => (
        <span key={s}>
          {i > 0 && " · "}
          <Link href={buyHref(s, next)} className={linkClass}>
            {s} →
          </Link>
        </span>
      ))}
    </p>
  );
}
