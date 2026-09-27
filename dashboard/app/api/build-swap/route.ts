import type { NextRequest } from "next/server";
import Decimal from "decimal.js";
import { fail, getParity, HttpError, json, quickRetry, requireWallet } from "@/lib/server/parity";
import { clientIp, rateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { buildPlainSwapTransaction } from "../../../../src/kamino/jupiter";
import { deserializeFromTransport, simulate } from "../../../../src/kamino/execute";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The same three assets Parity has verified end to end — not "any token".
const BUYABLE = ["AAPLx", "SPYx", "TSLAx"];
const MIN_USDC = 0.1;
const MAX_USDC = 10_000;
const SLIPPAGE_BPS = 100;

/**
 * POST /api/build-swap { wallet, asset, usdcAmount, preview? } — a plain Jupiter swap USDC → xStock as its OWN
 * transaction (not nested in a Kamino flash loan). Same pattern as the Kamino routes: real quote, then the exact
 * unsigned transaction is simulated against live mainnet state before it is handed out.
 *   preview: true  → quote + simulation only, no transaction (for showing the numbers while typing)
 *   otherwise      → also returns the unsigned base64 transaction for the wallet to sign; refuses (422) if the
 *                    simulation failed. Signing/submitting reuse the shared wallet + /api/submit-transaction flow.
 */
export async function POST(req: NextRequest) {
  try {
    const retryAfter = rateLimit(`swap:${clientIp(req)}`, 20);
    if (retryAfter !== null) return rateLimitedResponse(retryAfter, "swap requests");

    const body = await req.json().catch(() => null);
    if (!body) throw new HttpError(400, "Body must be JSON.");
    const wallet = requireWallet(body.wallet);
    if (typeof body.asset !== "string" || !BUYABLE.includes(body.asset)) throw new HttpError(400, `asset must be one of ${BUYABLE.join(", ")}.`);
    const usdc = body.usdcAmount;
    if (typeof usdc !== "number" || !Number.isFinite(usdc) || usdc < MIN_USDC || usdc > MAX_USDC) {
      throw new HttpError(400, `usdcAmount must be between ${MIN_USDC} and ${MAX_USDC} USDC.`);
    }

    const { client } = await getParity();
    const usdcReserve = client.getReserve("USDC");
    const assetReserve = client.getReserve(body.asset);
    const usdcDecimals = usdcReserve.getMintDecimals();
    const amountRaw = new Decimal(usdc).mul(new Decimal(10).pow(usdcDecimals)).toFixed(0);

    const balances = await quickRetry(() => client.getWalletBalances(wallet));
    const held = new Decimal(balances.find((b) => b.symbol === "USDC")?.amount ?? "0");
    if (held.lt(usdc)) {
      throw new HttpError(422, `This wallet holds ${held.toString()} USDC, less than the ${usdc} USDC to spend.`);
    }

    const swap = await buildPlainSwapTransaction({
      ownerAddress: wallet,
      inputMint: usdcReserve.getLiquidityMint(),
      outputMint: assetReserve.getLiquidityMint(),
      amountRaw,
      slippageBps: SLIPPAGE_BPS,
    });

    const outDecimals = assetReserve.getMintDecimals();
    const human = (raw: string) => new Decimal(raw).div(new Decimal(10).pow(outDecimals)).toString();
    const quote = {
      spendUsdc: String(usdc),
      asset: body.asset,
      expectedOut: human(swap.quote.outAmount),
      minimumOut: human(swap.quote.otherAmountThreshold),
      slippageBps: swap.quote.slippageBps,
      priceImpactPct: swap.quote.priceImpactPct,
      routes: swap.quote.routeLabels,
      oraclePriceUsd: assetReserve.getOracleMarketPrice().toString(),
    };

    const simulation = await quickRetry(() => simulate(client.getRpc(), deserializeFromTransport(swap.transactionBase64)));
    const sim = {
      ran: true as const,
      success: simulation.success,
      slot: simulation.slot,
      unitsConsumed: simulation.unitsConsumed,
      failureReason: simulation.success ? null : JSON.stringify(simulation.error, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
      keyLogs: (simulation.logs ?? []).filter((l) => /error|failed|insufficient/i.test(l)).slice(-4),
    };

    if (!simulation.success) {
      return json({ error: "Simulation did not pass, no transaction issued.", problems: [`On-chain simulation failed: ${sim.failureReason} ${sim.keyLogs.join(" | ")}`], quote, simulation: sim }, 422);
    }
    if (body.preview === true) return json({ quote, simulation: sim });
    return json({ transaction: swap.transactionBase64, lastValidBlockHeight: swap.lastValidBlockHeight, quote, simulation: sim });
  } catch (err) {
    return fail(err);
  }
}
