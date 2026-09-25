/**
 * `npm run check:market`
 *
 * Step zero. Don't write any more code against Kamino assumptions until this
 * has actually run against mainnet and printed real reserve data. This is the
 * live-verification step for everything KaminoClient assumes.
 */
import "dotenv/config";
import { KaminoClient } from "./client.js";

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const marketAddress = process.env.KAMINO_MAIN_MARKET;

  if (!rpcUrl || !marketAddress) {
    throw new Error("Set SOLANA_RPC_URL and KAMINO_MAIN_MARKET in .env first.");
  }

  console.log(`Loading Kamino market ${marketAddress} via ${rpcUrl}...`);
  const client = new KaminoClient(rpcUrl, marketAddress);
  await client.init();

  const allReserves = client.listReserves();
  console.log(`\nTotal reserves in this market: ${allReserves.length}`);

  const xStocks = client.listXStockReserves();
  console.log(`Reserves matching xStock heuristic (symbol starts/ends with "x"): ${xStocks.length}`);
  console.table(
    xStocks.map((r) => ({
      symbol: r.symbol,
      mint: r.mintAddress,
      LTV: r.loanToValuePct,
      liqThreshold: r.liquidationThresholdPct,
    }))
  );

  if (xStocks.length === 0) {
    console.warn(
      "\n⚠️  No reserves matched the xStock heuristic. Either the heuristic is wrong " +
        "(check allReserves below for the real symbol format) or this isn't the market " +
        "xStocks actually live in — check Kamino's app for the correct market address.\n"
    );
    console.log("All reserve symbols found:", allReserves.map((r) => r.symbol));
  }
}

main().catch((err) => {
  console.error("Market check failed:", err);
  process.exit(1);
});
