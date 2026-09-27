import type { NextRequest } from "next/server";
import { fail, getParity, HttpError, json } from "@/lib/server/parity";
import { clientIp, rateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { confirmTransaction, deserializeFromTransport, submitSignedTransaction } from "../../../../src/kamino/execute";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/** Production builds minify @solana/kit error text to "Solana error #NNN"; surface the RPC's own logs when it has them. */
function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (!/^Solana error #/.test(message)) return message;
  const logs = (err as { context?: { logs?: string[] } }).context?.logs;
  return `Rejected by the network (${message.split(";")[0]})${logs?.length ? `: ${logs.slice(-3).join(" | ")}` : "."}`;
}

const SUBMIT_LIMIT_PER_MINUTE = 8;
const MAX_BASE64_LENGTH = 2048; // a v0 transaction is at most 1232 bytes, about 1644 base64 characters

/**
 * POST /api/submit-transaction { signedTransaction, lastValidBlockHeight? } — submits a transaction the
 * wallet has already signed (this server never holds a key), then polls for confirmation. Always answers
 * with a resolved outcome: success | failed (on-chain error + logs) | timeout (with whether the blockhash
 * has expired, i.e. whether it can still land) | rejected (never reached the chain, no fee paid).
 */
export async function POST(req: NextRequest) {
  try {
    // Per-IP limit: submitting is the one route that spends the server's RPC budget on arbitrary input.
    const retryAfter = rateLimit(`submit:${clientIp(req)}`, SUBMIT_LIMIT_PER_MINUTE);
    if (retryAfter !== null) {
      return rateLimitedResponse(retryAfter, "submissions");
    }
    const body = await req.json().catch(() => null);
    const signed = body?.signedTransaction;
    if (typeof signed !== "string" || signed.length === 0 || signed.length > MAX_BASE64_LENGTH) {
      throw new HttpError(400, "signedTransaction must be a base64 wire transaction.");
    }
    const { client } = await getParity();
    const rpc = client.getRpc();

    let signature;
    try {
      const tx = deserializeFromTransport(signed);
      // Explicit, so the message stays readable in production builds (the SDK's own error text is minified there).
      if (Object.values(tx.signatures).some((s) => s === null)) {
        return json({ status: "rejected", error: "Transaction is missing signatures, your wallet did not sign it." });
      }
      signature = await submitSignedTransaction(rpc, tx);
    } catch (err) {
      // The RPC's preflight simulation refused it, or it could not be decoded — it never landed.
      return json({ status: "rejected", error: describeError(err) });
    }
    const lastValid = typeof body.lastValidBlockHeight === "string" && /^\d+$/.test(body.lastValidBlockHeight) ? BigInt(body.lastValidBlockHeight) : undefined;
    return json(await confirmTransaction(rpc, signature, "confirmed", { timeoutMs: 60_000, lastValidBlockHeight: lastValid }));
  } catch (err) {
    return fail(err);
  }
}
