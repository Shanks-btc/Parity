import snapshot from "./market-snapshot.json";

/**
 * Market figures as last verified live against Kamino's xStocks market on Solana mainnet.
 * Written by `npm run snapshot:landing` at the repo root — refresh by rerunning it, never by
 * hand-editing numbers. This is a snapshot, not a live feed; the UI says so and shows when.
 */
export const market = snapshot;

export const pct = (n: number, digits = 2) => `${n.toFixed(digits)}%`;

/** Signed percentage with a real minus sign, e.g. "−1.37%". */
export const signedPct = (n: number, digits = 2) => `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(digits)}%`;

export const checkedAtLabel = () => {
  const d = new Date(market.checkedAt);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return `${date}, ${time} UTC`;
};

/**
 * The one rendered USDC borrow APY. The Strategies "Borrow" card and the Problem section's Parity
 * card both display exactly this value, so the two can never show different numbers.
 */
export const borrowApyLabel = pct(market.usdc.borrowApyPct);

export type AssetSymbol = keyof typeof market.assets;

/** Every asset on the page (Capabilities cards), in page order. */
export const allAssets = Object.keys(market.assets) as AssetSymbol[];

/** Assets with / without live Kamino Multiply positions at the last snapshot, in page order. */
export const multiplyLiveAssets = allAssets.filter((s) => market.assets[s].multiply.obligations > 0);
export const multiplyNotLiveAssets = allAssets.filter((s) => market.assets[s].multiply.obligations === 0);

/** "A", "A and B", "A, B, and C" (or "or"). */
export const listJoin = (items: string[], word: "and" | "or" = "and") =>
  items.length <= 2 ? items.join(` ${word} `) : `${items.slice(0, -1).join(", ")}, ${word} ${items[items.length - 1]}`;
