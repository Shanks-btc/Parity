/**
 * `npm run check:multiply` (add the script if not already in package.json)
 *
 * Verification script for the Phase 1 Multiply read-only data layer — same pattern
 * as inspect-market.ts. Confirms getMultiplyMetrics() against live data before
 * anything is built on top of it.
 */
import "dotenv/config";
import { KaminoClient } from "./client";

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const marketAddress = process.env.KAMINO_MAIN_MARKET;

  if (!rpcUrl || !marketAddress) {
    throw new Error("Set SOLANA_RPC_URL and KAMINO_MAIN_MARKET in .env first.");
  }

  console.log(`Loading Kamino market ${marketAddress} via ${rpcUrl}...`);
  const client = new KaminoClient(rpcUrl, marketAddress);
  await client.init();

  const symbol = "SPYx";
  console.log(`\nFetching live Multiply metrics for ${symbol}...`);
  const metrics = await client.getMultiplyMetrics(symbol);

  console.log(`\nMultiply-tagged entries found for ${symbol}: ${metrics.length}`);
  console.log(JSON.stringify(metrics, null, 2));
}

main().catch((err) => {
  console.error("Multiply metrics check failed:", err);
  process.exit(1);
});
