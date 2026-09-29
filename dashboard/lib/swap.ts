/** Client-side constants and helpers for the in-app swap (the Trade page's Spot panel). */

export const SWAP_ASSETS = ["AAPLx", "SPYx", "TSLAx"] as const;
export type SwapAsset = (typeof SWAP_ASSETS)[number];
export type PayToken = "USDC" | "SOL";
export const PAY_TOKENS: PayToken[] = ["USDC", "SOL"];
export type SwapSide = "buy" | "sell";

/**
 * SOL that MAX never spends. The read-only preflight measured 0.0328 SOL for a first Kamino Borrow (account rent +
 * fees), plus margin, so a wallet that swaps ALL its SOL into an xStock could no longer open a position.
 * Re-measure this if the Kamino builders change (scripts/preflight-sol.ts).
 */
export const SOL_RESERVE = 0.04;

/** Slippage the server uses for every swap (kept in step with SLIPPAGE_BPS in lib/server/swap.ts). */
export const SLIPPAGE_PCT = 1;
export const USD_CHIPS = [1, 2, 5, 10];
export const SELL_CHIPS_PCT = [25, 50, 75, 100];
export const MIN_PAY: Record<PayToken, number> = { USDC: 0.1, SOL: 0.001 };

const trim = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
/** Rounds DOWN to `decimals` and returns a plain decimal string (never exponent notation). */
export const floorTo = (n: number, decimals: number) => trim((Math.floor(n * 10 ** decimals + 1e-9) / 10 ** decimals).toFixed(decimals));
/** Rounds UP to `decimals` (used when converting a USD chip to SOL so the USD value is never short). */
export const ceilTo = (n: number, decimals: number) => trim((Math.ceil(n * 10 ** decimals - 1e-9) / 10 ** decimals).toFixed(decimals));

/** The most a MAX click may put in the box. SOL keeps SOL_RESERVE; USDC uses the full movable balance. */
export function maxPay(token: PayToken, balance: number): number {
  return token === "SOL" ? Math.max(0, balance - SOL_RESERVE) : balance;
}

export const lamportsToSol = (l: number) => l / 1e9;
export const solText = (sol: number) => `${sol.toLocaleString("en-US", { maximumSignificantDigits: 3, maximumFractionDigits: 6 })} SOL`;

/** `expectedOut`/`minimumOut` are in the RECEIVE leg's units: the asset for a buy, the counter token for a sell. */
export interface SwapQuoteOk {
  available: true;
  asset: string;
  side: SwapSide;
  counterToken: PayToken;
  inAmount: string;
  expectedOut: string;
  minimumOut: string;
  slippageBps: number;
  priceImpactPct: string;
  routes: string[];
  oraclePriceUsd: string;
  counterUsd: number;
}
export interface SwapQuoteNone {
  available: false;
  asset: string;
  side: SwapSide;
  counterToken: PayToken;
  reason: string;
  oraclePriceUsd: string;
  counterUsd: number;
}
export type SwapQuote = SwapQuoteOk | SwapQuoteNone;

export interface SwapPreview {
  quote: { side: SwapSide; counterToken: PayToken; spend: string; asset: string; expectedOut: string; minimumOut: string; slippageBps: number; priceImpactPct: string; routes: string[]; oraclePriceUsd: string };
  simulation: {
    ran: true;
    success: boolean;
    slot: string;
    unitsConsumed: string | null;
    costs: { networkFeeLamports: number; priorityFeeLamports: number; tokenAccountRentLamports: number; createsTokenAccount: boolean; otherKeptRentLamports: number; totalFeeLamports: number; temporaryAccounts: number };
  };
}
