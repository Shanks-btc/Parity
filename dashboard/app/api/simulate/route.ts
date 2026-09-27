import type { NextRequest } from "next/server";
import { fail, getParity, HttpError, json, quickRetry, requireWallet } from "@/lib/server/parity";
import { parseStrategy } from "@/lib/server/strategy-input";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/simulate { wallet, strategy } — builds the real transaction and runs it through the RPC's
 * simulateTransaction against live mainnet state. Nothing is signed; the result carries the simulation
 * outcome, slot, compute units and the projected health factor. No transaction is returned here.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) throw new HttpError(400, "Body must be JSON.");
    const wallet = requireWallet(body.wallet);
    const strategy = parseStrategy(body.strategy);
    const { validator } = await getParity();
    return json(await quickRetry(() => validator.validate(wallet, strategy)));
  } catch (err) {
    return fail(err);
  }
}
