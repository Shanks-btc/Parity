/**
 * Pyth Hermes integration.
 *
 * Purpose, deliberately narrow: Kamino prices its own collateral internally
 * (Chainlink, per their public docs). We don't touch that. What we add is an
 * INDEPENDENT check — the agent cross-references Pyth's real equity price
 * against the xStock's on-chain price before recommending a position size,
 * and surfaces that spread to the user as a risk signal. That's the honest
 * "Pyth is central to the product" story, not Pyth-as-a-logo.
 *
 * UNVERIFIED / NEEDS A LIVE CHECK:
 *   - Exact Hermes feed IDs for Equity.US.<TICKER>/USD and Crypto.<TICKER>X/USD
 *     per xStock you plan to support — these are per-symbol and need to be
 *     pulled from Pyth's price feed registry, not guessed from the naming
 *     pattern. Run `npm run check:feeds` once you have real feed IDs filled in.
 *
 * VERIFIED LIVE 2026-09-22: since Pyth's Core upgrade (2026-08-26), the price-update
 * endpoint (/v2/updates/price/latest) requires an API key — a Bearer token — even for
 * ordinary crypto feeds like BTC/USD. The metadata search endpoint (/v2/price_feeds)
 * is still open. This is a change from Hermes's historical no-key public access, so
 * PYTH_API_KEY must be set (get one at https://pyth-network.appspot.com/ / Pyth Terminal)
 * or every checkDivergence() call will 401.
 */

export interface PriceSnapshot {
  feedId: string;
  price: number;
  confidence: number;
  publishTimeUnix: number;
}

export interface DivergenceCheck {
  symbol: string;
  realPrice: PriceSnapshot;
  onChainWrapperPrice: PriceSnapshot;
  spreadPct: number; // (wrapper - real) / real * 100
  staleness: {
    realFeedAgeSeconds: number;
    wrapperFeedAgeSeconds: number;
  };
}

// Placeholder registry — REPLACE with real feed IDs looked up per-symbol at
// https://www.pyth.network/developers/price-feed-ids before relying on this.
const FEED_ID_REGISTRY: Record<string, { real: string; wrapper: string }> = {
  // Verified live via Hermes on 2026-09-22 — see npm run check:feeds output.
  AAPLx: {
    real: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688", // Equity.US.AAPL/USD
    wrapper: "978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675", // Crypto AAPLXUSD
  },
  // Verified live via Hermes /v2/price_feeds?query=SPY on 2026-09-24 (same Equity.US.<T>/USD +
  // Crypto.<T>X/USD pairing as AAPLx). Hermes also lists Crypto.SPYX/SPY.RR (9e916cc0…), a
  // redemption-rate feed — not used here.
  SPYx: {
    real: "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5", // Equity.US.SPY/USD
    wrapper: "2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14", // Crypto.SPYX/USD
  },
};

export class PythFeedClient {
  constructor(private hermesUrl: string, private apiKey?: string) {}

  private async fetchPrice(feedId: string): Promise<PriceSnapshot> {
    const url = `${this.hermesUrl}/v2/updates/price/latest?ids[]=${feedId}`;
    const res = await fetch(url, {
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
    });
    if (!res.ok) {
      throw new Error(
        `Hermes request failed (${res.status}) for feed ${feedId}` +
          (res.status === 401
            ? " — set PYTH_API_KEY (Hermes has required a key for price updates since the 2026-08-26 Core upgrade)"
            : "")
      );
    }
    const data = await res.json();
    const parsed = data?.parsed?.[0];
    if (!parsed) {
      throw new Error(`No parsed price data returned for feed ${feedId}`);
    }
    const expo = parsed.price.expo;
    return {
      feedId,
      price: Number(parsed.price.price) * Math.pow(10, expo),
      confidence: Number(parsed.price.conf) * Math.pow(10, expo),
      publishTimeUnix: parsed.price.publish_time,
    };
  }

  /**
   * Compares real equity price vs the xStock's own tracking feed for one symbol.
   * Throws if the symbol isn't in FEED_ID_REGISTRY — fill that in with verified
   * feed IDs before calling this for a given xStock.
   */
  async checkDivergence(symbol: string): Promise<DivergenceCheck> {
    const feeds = FEED_ID_REGISTRY[symbol];
    if (!feeds) {
      throw new Error(
        `No Pyth feed IDs registered for "${symbol}". Look up the real feed IDs ` +
          `and add them to FEED_ID_REGISTRY before using this symbol.`
      );
    }

    const [real, wrapper] = await Promise.all([
      this.fetchPrice(feeds.real),
      this.fetchPrice(feeds.wrapper),
    ]);

    const now = Math.floor(Date.now() / 1000);
    const spreadPct = ((wrapper.price - real.price) / real.price) * 100;

    return {
      symbol,
      realPrice: real,
      onChainWrapperPrice: wrapper,
      spreadPct,
      staleness: {
        realFeedAgeSeconds: now - real.publishTimeUnix,
        wrapperFeedAgeSeconds: now - wrapper.publishTimeUnix,
      },
    };
  }
}
