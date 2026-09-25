/**
 * `npm run dev:agent` — quick manual loop for testing the agent against a
 * stated intent. This is a CLI smoke test, not the product surface; the
 * dashboard is the real interface, this exists so the agent core can be
 * exercised before any UI is wired up.
 *
 * On Windows/PowerShell, run this INTERACTIVELY (just `npm run dev:agent` and
 * type the answers) rather than piping input in. Piped/non-TTY stdin here
 * closes (EOF) right after PowerShell writes its content, before the second
 * rl.question() below gets a line — and since an unresolved Promise alone
 * doesn't keep Node's event loop alive, the process just exits (code 0, no
 * error) once nothing else references stdin. Looks like silent success;
 * it's actually the CLI never getting past the prompts. Verified 2026-09-22.
 */
import "dotenv/config";
import readline from "node:readline/promises";
import { KaminoClient } from "../kamino/client.js";
import { PythFeedClient } from "../pyth/feeds.js";
import { ParityAgent } from "./core.js";

/** Unwraps Anthropic SDK / Pyth / generic errors to one readable line instead of a raw dump. */
function formatError(err: unknown): string {
  if (err && typeof err === "object" && "error" in err) {
    const inner = (err as { error?: { error?: { message?: string } } }).error?.error?.message;
    if (inner) return inner;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

async function main() {
  const { SOLANA_RPC_URL, KAMINO_MAIN_MARKET, PYTH_HERMES_URL, PYTH_API_KEY, ANTHROPIC_API_KEY } =
    process.env;

  if (!SOLANA_RPC_URL || !KAMINO_MAIN_MARKET || !ANTHROPIC_API_KEY) {
    throw new Error(
      "Missing required env vars — check .env against .env.example. " +
        "SOLANA_RPC_URL, KAMINO_MAIN_MARKET, and ANTHROPIC_API_KEY are all required."
    );
  }

  console.log("Loading Kamino market (this hits live mainnet RPC)...");
  const kamino = new KaminoClient(SOLANA_RPC_URL, KAMINO_MAIN_MARKET);
  await kamino.init();

  const pyth = new PythFeedClient(PYTH_HERMES_URL ?? "https://hermes.pyth.network", PYTH_API_KEY);
  const agent = new ParityAgent(kamino, pyth, ANTHROPIC_API_KEY);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const walletAddress = await rl.question("Wallet address to reason about: ");
  const intent = await rl.question("Stated intent (e.g. 'I want yield without selling my AAPLx'): ");
  rl.close();

  console.log("\nRunning agent...\n");
  const result = await agent.handleIntent(intent, walletAddress);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Agent run failed:", formatError(err));
  process.exit(1);
});
