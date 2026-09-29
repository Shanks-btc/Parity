import type { NextRequest } from "next/server";
import { fail, getParity, HttpError, json, quickRetry } from "@/lib/server/parity";
import { clientIp, rateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { fromRaw, legMints, LIMITS, requireAmount, requireAsset, requireInput, requireSide, SLIPPAGE_BPS, solUsd, toRaw } from "@/lib/server/swap";
import { fetchPlainSwapQuote, JupiterNoRouteError } from "../../../../src/kamino/jupiter";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/swap-quote?asset=SPYx&side=buy|sell&counterToken=USDC|SOL&amount=<in the PAY leg> | &usd=<USD value to pay>
 *
 * A real Jupiter quote and nothing else: no wallet, no transaction, no simulation (that is /api/build-swap).
 * EXACT-INPUT only — Jupiter returns NO_ROUTES_FOUND for exact-output quotes on every xStock pair, so the caller says
 * what it pays and the output is an estimate. `side` picks which leg is which:
 *   buy  (default): pay counterToken, receive asset   — amount/usd are in counterToken units
 *   sell:           pay asset, receive counterToken   — amount is in the asset's own units
 * A pair with no route answers { available: false } (HTTP 200) so the client can simply hide it.
 */
export async function GET(req: NextRequest) {
  try {
    const retryAfter = rateLimit(`swapq:${clientIp(req)}`, 30);
    if (retryAfter !== null) return rateLimitedResponse(retryAfter, "quote requests");

    const q = req.nextUrl.searchParams;
    const asset = requireAsset(q.get("asset"));
    const side = requireSide(q.get("side"));
    const counterToken = requireInput(q.get("counterToken") ?? q.get("token"));
    const { client } = await getParity();
    const usdcMint = client.getReserve("USDC").getLiquidityMint();
    const assetReserve = client.getReserve(asset);
    const rate = counterToken === "USDC" ? 1 : await quickRetry(() => solUsd(usdcMint));
    const { payMint, payDecimals, receiveMint, receiveDecimals } = legMints(client, asset, side, counterToken);

    let amount: number;
    if (side === "buy" && q.get("usd") !== null) {
      const usd = Number(q.get("usd"));
      if (!Number.isFinite(usd) || usd <= 0 || usd > 100_000) throw new HttpError(400, "usd must be a positive number.");
      amount = requireAmount(Math.max(usd / rate, LIMITS[counterToken].min), side, counterToken);
    } else amount = requireAmount(q.get("amount"), side, counterToken);

    const oraclePriceUsd = assetReserve.getOracleMarketPrice().toString();
    try {
      const { quote } = await quickRetry(() => fetchPlainSwapQuote({ inputMint: payMint, outputMint: receiveMint, amountRaw: toRaw(amount, payDecimals), slippageBps: SLIPPAGE_BPS }));
      return json({
        available: true,
        asset,
        side,
        counterToken,
        inAmount: fromRaw(quote.inAmount, payDecimals),
        expectedOut: fromRaw(quote.outAmount, receiveDecimals),
        minimumOut: fromRaw(quote.otherAmountThreshold, receiveDecimals),
        slippageBps: quote.slippageBps,
        priceImpactPct: quote.priceImpactPct,
        routes: quote.routeLabels,
        oraclePriceUsd,
        counterUsd: rate,
      });
    } catch (e) {
      // (quickRetry re-throws after its attempts; a "no route" answer is definitive and is not an error for the client.)
      if (e instanceof JupiterNoRouteError) return json({ available: false, asset, side, counterToken, reason: e.message, oraclePriceUsd, counterUsd: rate });
      throw e;
    }
  } catch (err) {
    return fail(err);
  }
}
