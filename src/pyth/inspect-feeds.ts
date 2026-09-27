/**
 * `npm run check:feeds`
 *
 * Won't do anything useful until FEED_ID_REGISTRY in feeds.ts is populated
 * with real feed IDs from https://www.pyth.network/developers/price-feed-ids.
 * This script exists so that once it is, verifying it works is one command.
 */
import "dotenv/config";
import { PythFeedClient } from "./feeds";

async function main() {
  const hermesUrl = process.env.PYTH_HERMES_URL ?? "https://hermes.pyth.network";
  const client = new PythFeedClient(hermesUrl, process.env.PYTH_API_KEY);

  const symbolsToCheck = ["AAPLx"]; // extend once feed IDs are filled in

  for (const symbol of symbolsToCheck) {
    try {
      const result = await client.checkDivergence(symbol);
      console.log(`\n${symbol}:`);
      console.log(`  Real price:    $${result.realPrice.price.toFixed(2)}`);
      console.log(`  Wrapper price: $${result.onChainWrapperPrice.price.toFixed(2)}`);
      console.log(`  Spread:        ${result.spreadPct.toFixed(3)}%`);
      console.log(
        `  Feed age:      real=${result.staleness.realFeedAgeSeconds}s, ` +
          `wrapper=${result.staleness.wrapperFeedAgeSeconds}s`
      );
    } catch (err) {
      console.error(`${symbol}: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error("Feed check failed:", err);
  process.exit(1);
});
