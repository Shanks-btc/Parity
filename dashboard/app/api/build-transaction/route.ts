import type { NextRequest } from "next/server";
import { fail, getParity, HttpError, json, quickRetry, requireWallet } from "@/lib/server/parity";
import { parseStrategy } from "@/lib/server/strategy-input";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/build-transaction { wallet, strategy } — returns the serialized UNSIGNED transaction
 * (serializeForTransport) for the connected wallet to sign, together with the simulation of that exact
 * transaction. It refuses (422) to hand out a transaction whose simulation failed, so a wallet is never
 * asked to sign something already known to fail.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) throw new HttpError(400, "Body must be JSON.");
    const wallet = requireWallet(body.wallet);
    const strategy = parseStrategy(body.strategy);
    const { validator } = await getParity();
    const result = await quickRetry(() => validator.validate(wallet, strategy, { includeTransaction: true }));
    if (!result.valid || !result.transaction) {
      return json({ error: "Simulation did not pass, no transaction issued.", validation: result }, 422);
    }
    const { transaction, ...validation } = result;
    return json({ transaction: transaction.base64, lastValidBlockHeight: transaction.lastValidBlockHeight, validation });
  } catch (err) {
    return fail(err);
  }
}
