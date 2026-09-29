import type { NextRequest } from "next/server";
import Decimal from "decimal.js";
import { address } from "@solana/kit";
import { fail, getParity, HttpError, json, quickRetry, requireWallet } from "@/lib/server/parity";
import { clientIp, rateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { fromRaw, legMints, requireAmount, requireAsset, requireInput, requireSide, SLIPPAGE_BPS, toRaw } from "@/lib/server/swap";
import { buildPlainSwapTransaction, JupiterNoRouteError } from "../../../../src/kamino/jupiter";
import { simulateSwapWithCosts } from "../../../../src/kamino/swap-cost";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/build-swap { wallet, asset, side: "buy" | "sell", counterToken: "USDC" | "SOL", amount, preview? } — a
 * plain Jupiter swap as its OWN transaction (not nested in a Kamino flash loan). Real quote, then the exact unsigned
 * transaction is simulated against live mainnet state before it is handed out.
 *   side "buy"  (default): pay counterToken, receive asset — amount is in counterToken units.
 *   side "sell":            pay asset, receive counterToken — amount is in the asset's own units.
 *   preview: true  → quote + simulation (with measured costs) only, no transaction, for the confirmation dialog
 *   otherwise      → also returns the unsigned base64 transaction for the wallet to sign; refuses (422) if the
 *                    simulation failed. Signing/submitting reuse the shared wallet + /api/submit-transaction flow.
 */
export async function POST(req: NextRequest) {
  try {
    const retryAfter = rateLimit(`swap:${clientIp(req)}`, 8);
    if (retryAfter !== null) return rateLimitedResponse(retryAfter, "swap requests");

    const body = await req.json().catch(() => null);
    if (!body) throw new HttpError(400, "Body must be JSON.");
    const wallet = requireWallet(body.wallet);
    const asset = requireAsset(body.asset);
    const side = requireSide(body.side);
    const counterToken = requireInput(body.counterToken ?? body.input);
    const amount = requireAmount(body.amount, side, counterToken);

    const { client } = await getParity();
    const { payMint, payDecimals, receiveMint, receiveDecimals } = legMints(client, asset, side, counterToken);
    const amountRaw = toRaw(amount, payDecimals);

    // Refuse before building when the wallet plainly cannot pay (the simulation would say the same, less clearly).
    if (side === "buy" && counterToken === "USDC") {
      const balances = await quickRetry(() => client.getWalletBalances(wallet));
      const held = new Decimal(balances.find((b) => b.symbol === "USDC")?.amount ?? "0");
      if (held.lt(amount)) throw new HttpError(422, `This wallet holds ${held.toString()} USDC, less than the ${amount} USDC to spend.`);
    } else if (side === "buy") {
      const lamports = await quickRetry(() => client.getRpc().getBalance(address(wallet)).send());
      if (Number(lamports.value) < Number(amountRaw)) throw new HttpError(422, `This wallet holds ${fromRaw(lamports.value.toString(), 9)} SOL, less than the ${amount} SOL to spend.`);
    } else {
      const balances = await quickRetry(() => client.getWalletBalances(wallet));
      const held = new Decimal(balances.find((b) => b.symbol === asset)?.amount ?? "0");
      if (held.lt(amount)) throw new HttpError(422, `This wallet holds ${held.toString()} ${asset}, less than the ${amount} to sell.`);
    }

    let swap;
    try {
      swap = await buildPlainSwapTransaction({ ownerAddress: wallet, inputMint: payMint, outputMint: receiveMint, amountRaw, slippageBps: SLIPPAGE_BPS });
    } catch (e) {
      if (e instanceof JupiterNoRouteError) throw new HttpError(422, e.message);
      throw e;
    }

    const assetReserve = client.getReserve(asset);
    const quote = {
      side,
      counterToken,
      spend: String(amount),
      asset,
      expectedOut: fromRaw(swap.quote.outAmount, receiveDecimals),
      minimumOut: fromRaw(swap.quote.otherAmountThreshold, receiveDecimals),
      slippageBps: swap.quote.slippageBps,
      priceImpactPct: swap.quote.priceImpactPct,
      routes: swap.quote.routeLabels,
      oraclePriceUsd: assetReserve.getOracleMarketPrice().toString(),
    };

    const sim = await quickRetry(() => simulateSwapWithCosts(client.getRpc(), swap.transactionBase64, receiveMint));
    const simulation = { ran: true as const, success: sim.success, slot: sim.slot, unitsConsumed: sim.unitsConsumed, failureReason: sim.failureReason, keyLogs: sim.keyLogs, costs: sim.costs };

    if (!sim.success) {
      return json({ error: "Simulation did not pass, no transaction issued.", problems: [`On-chain simulation failed: ${sim.failureReason} ${sim.keyLogs.join(" | ")}`], quote, simulation }, 422);
    }
    if (body.preview === true) return json({ quote, simulation });
    return json({ transaction: swap.transactionBase64, lastValidBlockHeight: swap.lastValidBlockHeight, quote, simulation });
  } catch (err) {
    return fail(err);
  }
}
