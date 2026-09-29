import Decimal from "decimal.js";
import { fetchPlainSwapQuote } from "../../../src/kamino/jupiter";
import type { KaminoClient } from "../../../src/kamino/client";
import { HttpError } from "./parity";

/** The only assets and counter-tokens the in-app swap offers. Arbitrary tokens are out of scope. */
export const SWAP_ASSETS = ["AAPLx", "SPYx", "TSLAx"] as const;
export const SWAP_INPUTS = ["USDC", "SOL"] as const;
export type SwapInput = (typeof SWAP_INPUTS)[number];
export const SWAP_SIDES = ["buy", "sell"] as const;
export type SwapSide = (typeof SWAP_SIDES)[number];
export const SLIPPAGE_BPS = 100;

export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const SOL_DECIMALS = 9;
/** Below these a swap is not worth its fees; above these it is not a demo-sized swap (buy side, amount in the counter token). */
export const LIMITS: Record<SwapInput, { min: number; max: number }> = { USDC: { min: 0.1, max: 10_000 }, SOL: { min: 0.001, max: 100 } };
/** Sell side, amount in the xStock being sold: no meaningful fixed minimum (prices differ 100x across assets), just "more than dust". */
export const MIN_SELL = 0.000001;
export const MAX_SELL = 1_000_000;

export function requireAsset(v: unknown): (typeof SWAP_ASSETS)[number] {
  if (typeof v !== "string" || !(SWAP_ASSETS as readonly string[]).includes(v)) throw new HttpError(400, `asset must be one of ${SWAP_ASSETS.join(", ")}.`);
  return v as (typeof SWAP_ASSETS)[number];
}
export function requireInput(v: unknown): SwapInput {
  if (typeof v !== "string" || !(SWAP_INPUTS as readonly string[]).includes(v)) throw new HttpError(400, `counterToken must be one of ${SWAP_INPUTS.join(", ")}.`);
  return v as SwapInput;
}
export function requireSide(v: unknown): SwapSide {
  if (v === undefined || v === null) return "buy";
  if (typeof v !== "string" || !(SWAP_SIDES as readonly string[]).includes(v)) throw new HttpError(400, `side must be one of ${SWAP_SIDES.join(", ")}.`);
  return v as SwapSide;
}
export function requireAmount(v: unknown, side: SwapSide, counterToken: SwapInput): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (side === "buy") {
    const { min, max } = LIMITS[counterToken];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `amount must be between ${min} and ${max} ${counterToken}.`);
    return n;
  }
  if (typeof n !== "number" || !Number.isFinite(n) || n < MIN_SELL || n > MAX_SELL) throw new HttpError(400, `amount must be between ${MIN_SELL} and ${MAX_SELL} (the asset you're selling).`);
  return n;
}
export const toRaw = (amount: number, decimals: number) => new Decimal(amount).mul(new Decimal(10).pow(decimals)).toFixed(0, Decimal.ROUND_DOWN);
export const fromRaw = (raw: string | number, decimals: number) => new Decimal(raw).div(new Decimal(10).pow(decimals)).toString();

// USD per SOL as Jupiter quotes it right now (SOL -> USDC, 1 SOL), cached briefly so typing doesn't multiply calls.
const g = globalThis as unknown as { __solUsd?: { at: number; value: number } };
export async function solUsd(usdcMint: string): Promise<number> {
  if (g.__solUsd && Date.now() - g.__solUsd.at < 20_000) return g.__solUsd.value;
  const { quote } = await fetchPlainSwapQuote({ inputMint: WSOL_MINT, outputMint: usdcMint, amountRaw: "1000000000", slippageBps: 50 });
  const value = Number(quote.outAmount) / 1e6;
  g.__solUsd = { at: Date.now(), value };
  return value;
}

/**
 * Resolves which mint is being PAID and which is being RECEIVED for a given side.
 *   buy:  pay = counterToken (USDC/SOL),  receive = asset
 *   sell: pay = asset,                    receive = counterToken (USDC/SOL)
 * `amount` (in the caller) is always denominated in the PAY leg — Jupiter has no exact-output route for any xStock
 * pair, so every quote and build here is exact-input regardless of which side is being asked for.
 */
export function legMints(client: KaminoClient, asset: (typeof SWAP_ASSETS)[number], side: SwapSide, counterToken: SwapInput) {
  const assetReserve = client.getReserve(asset);
  const assetMint = assetReserve.getLiquidityMint();
  const assetDecimals = assetReserve.getMintDecimals();
  const counterMint = counterToken === "USDC" ? client.getReserve("USDC").getLiquidityMint() : WSOL_MINT;
  const counterDecimals = counterToken === "USDC" ? client.getReserve("USDC").getMintDecimals() : SOL_DECIMALS;
  return side === "buy"
    ? { payMint: counterMint, payDecimals: counterDecimals, receiveMint: assetMint, receiveDecimals: assetDecimals }
    : { payMint: assetMint, payDecimals: assetDecimals, receiveMint: counterMint, receiveDecimals: counterDecimals };
}
