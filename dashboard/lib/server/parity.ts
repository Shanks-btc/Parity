import { KaminoClient } from "../../../src/kamino/client";
import { StrategyValidator } from "../../../src/agent/validate";
import { PositionManager } from "../../../src/agent/manage";
import { withRpcRetry } from "../../../src/kamino/rpc-retry";

/** Short retry for the RPC provider's intermittent 429s / dropped connections — the UI must not stall for the agent's 10s backoff. */
export const quickRetry = <T,>(fn: () => Promise<T>) => withRpcRetry(fn, 3, 700);

/**
 * Server-side access to the already-built, already-verified backend (src/kamino, src/agent).
 * Nothing here reimplements protocol logic — it only holds one loaded KaminoClient so each request
 * doesn't pay the market-load cost, and reloads it every MARKET_TTL_MS so oracle prices stay fresh.
 */

export const MARKET_ADDRESS = process.env.KAMINO_MAIN_MARKET ?? "5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua";
const MARKET_TTL_MS = 60_000;

type Loaded = { client: KaminoClient; validator: StrategyValidator; manager: PositionManager; loadedAt: number };
const g = globalThis as unknown as { __parity?: { current?: Loaded; loading?: Promise<Loaded> } };
const state = (g.__parity ??= {});

export async function getParity(): Promise<Loaded> {
  if (state.current && Date.now() - state.current.loadedAt < MARKET_TTL_MS) return state.current;
  if (!state.loading) {
    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) throw new HttpError(503, "SOLANA_RPC_URL is not configured on the server.");
    state.loading = (async () => {
      const client = new KaminoClient(rpcUrl, MARKET_ADDRESS);
      await quickRetry(() => client.init());
      return (state.current = { client, validator: new StrategyValidator(client), manager: new PositionManager(client), loadedAt: Date.now() });
    })().finally(() => {
      state.loading = undefined;
    });
  }
  return state.loading;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function requireWallet(value: unknown): string {
  if (typeof value !== "string" || !BASE58_PUBKEY.test(value)) throw new HttpError(400, "wallet must be a base58 Solana public key.");
  return value;
}

/** JSON reply that survives bigint values (Solana RPC errors and slots contain them). */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function fail(err: unknown): Response {
  if (err instanceof HttpError) return json({ error: err.message }, err.status);
  const message = err instanceof Error ? err.message : String(err);
  console.error("[api]", message);
  return json({ error: message }, 500);
}
