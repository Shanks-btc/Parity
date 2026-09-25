/**
 * The public mainnet RPC rate-limits bursts (HTTP 429, retry-after ~10s) and occasionally drops
 * connections ("fetch failed" / ConnectTimeoutError) — both VERIFIED repeatedly since Phase 2.
 * Neither says anything about whether a strategy works, so they are retried here rather than
 * surfacing to the agent, which would otherwise count them as failed validations (it did, in the
 * first Phase 5 end-to-end run, and gave up on a sound AAPLx borrow).
 */
export function isTransientNetworkError(err: unknown): boolean {
  const e = err as { message?: string; cause?: { code?: string; message?: string } };
  const text = `${e?.message ?? err} ${e?.cause?.code ?? ""} ${e?.cause?.message ?? ""}`;
  return /\b429\b|Too Many Requests|fetch failed|ConnectTimeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|UND_ERR|TimeoutError|aborted due to timeout/i.test(
    text
  );
}

export async function withRpcRetry<T>(fn: () => Promise<T>, attempts = 4, delayMs = 10_000): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransientNetworkError(err) || i >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
