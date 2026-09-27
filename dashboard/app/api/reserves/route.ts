import { fail, getParity, json, MARKET_ADDRESS } from "@/lib/server/parity";

export const dynamic = "force-dynamic";

/** GET /api/reserves — the market's xStock reserves with live LTV / liquidation threshold and Kamino's oracle price. */
export async function GET() {
  try {
    const { client } = await getParity();
    const withDetail = (r: { symbol: string; mintAddress: string; loanToValuePct: number; liquidationThresholdPct: number }) => {
      const reserve = client.getReserve(r.symbol);
      // klend reports these as fractions (0.73); the rest of the app (and the landing snapshot) uses percent.
      const pct = (fraction: number) => Math.round(fraction * 10000) / 100;
      return { ...r, loanToValuePct: pct(r.loanToValuePct), liquidationThresholdPct: pct(r.liquidationThresholdPct), reserveAddress: String(reserve.address), oraclePriceUsd: reserve.getOracleMarketPrice().toString() };
    };
    return json({
      market: MARKET_ADDRESS,
      reserves: client.listXStockReserves().map(withDetail),
      usdc: withDetail(client.listReserves().find((r) => r.symbol === "USDC")!),
    });
  } catch (err) {
    return fail(err);
  }
}
