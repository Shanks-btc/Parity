import type { NextRequest } from "next/server";
import { fail, getParity, HttpError, json, quickRetry, requireWallet } from "@/lib/server/parity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/close-position { wallet, collateralAsset, debtAsset, preview? } — repays the full debt AND withdraws
 * the full collateral of the wallet's real Vanilla Kamino obligation, as ONE atomic transaction (one signature).
 *   preview: true  → simulation only, no transaction
 *   otherwise      → also returns the unsigned base64 transaction for the wallet to sign; refuses (422) if the
 *                    simulation failed.
 *
 * Does NOT reclaim the obligation account's rent: the klend program has no "close obligation" instruction
 * (verified against the installed SDK's program IDL — see src/kamino/client.ts, buildCloseVanillaPositionTx).
 * The obligation PDA stays allocated on-chain after this; only the deposited collateral and the debt move.
 * Vanilla positions only — Multiply unwind is a separate, not-yet-built flow.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) throw new HttpError(400, "Body must be JSON.");
    const wallet = requireWallet(body.wallet);
    if (typeof body.collateralAsset !== "string" || !body.collateralAsset) throw new HttpError(400, "collateralAsset is required.");
    if (typeof body.debtAsset !== "string" || !body.debtAsset) throw new HttpError(400, "debtAsset is required.");

    const { manager } = await getParity();
    const result = await quickRetry(() => manager.close(wallet, body.collateralAsset, body.debtAsset, { includeTransaction: true }));
    if (!result.valid) {
      return json({ error: result.problems[0] ?? "Simulation did not pass, no transaction issued.", manage: result }, 422);
    }
    if (body.preview === true) {
      const { transaction, ...rest } = result;
      void transaction;
      return json(rest);
    }
    if (!result.transaction) return json({ error: "Simulation passed but no transaction was produced.", manage: result }, 500);
    const { transaction, ...manage } = result;
    return json({ transaction: transaction.base64, lastValidBlockHeight: transaction.lastValidBlockHeight, manage });
  } catch (err) {
    return fail(err);
  }
}
