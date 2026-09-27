import { market } from "@/lib/market";

/**
 * Temporary external hop for wallets that hold none of the asset yet (a real in-app buy flow is a separate, later
 * phase). Deliberately plain text-link styling — it leaves the app, so it must not look like an in-app action.
 *
 * URL format VERIFIED LIVE in Chrome 2026-09-26: Jupiter's swap page takes query parameters
 * `https://jup.ag/swap?sell=<mint>&buy=<mint>` and opens with them pre-filled (USDC → the xStock). The older
 * path form `/swap/<A>-<B>` is redirected and silently drops the xStock, so it is NOT used.
 */
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export function jupiterBuyUrl(symbol: string): string | null {
  const mint = market.xstocks.find((x) => x.symbol === symbol)?.mint;
  return mint ? `https://jup.ag/swap?sell=${USDC_MINT}&buy=${mint}` : null;
}

const linkClass = "text-gold-strong underline underline-offset-2 hover:text-gold-text";

/** One asset: "Don't have AAPLx yet? Buy it on Jupiter ↗". Several: a short list of per-asset links. */
export function BuyOnJupiter({ symbols, className = "" }: { symbols: string[]; className?: string }) {
  const links = symbols.map((s) => ({ symbol: s, href: jupiterBuyUrl(s) })).filter((l): l is { symbol: string; href: string } => l.href !== null);
  if (links.length === 0) return null;
  const ext = { target: "_blank", rel: "noopener noreferrer" } as const;

  if (links.length === 1) {
    const { symbol, href } = links[0];
    return (
      <p data-testid="buy-on-jupiter" className={`m-0 font-serif text-[13px] leading-normal text-ink-muted ${className}`}>
        Don&apos;t have {symbol} yet?{" "}
        <a href={href} {...ext} className={linkClass}>
          Buy it on Jupiter ↗
        </a>
      </p>
    );
  }
  return (
    <p data-testid="buy-on-jupiter" className={`m-0 font-serif text-[13px] leading-normal text-ink-muted ${className}`}>
      Don&apos;t have the stock yet? Buy it on Jupiter:{" "}
      {links.map((l, i) => (
        <span key={l.symbol}>
          {i > 0 && " · "}
          <a href={l.href} {...ext} className={linkClass}>
            {l.symbol} ↗
          </a>
        </span>
      ))}
    </p>
  );
}
