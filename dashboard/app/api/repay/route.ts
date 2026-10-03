import type { NextRequest } from "next/server";
import Decimal from "decimal.js";
import { fail, getParity, HttpError, json, quickRetry, requireWallet } from "@/lib/server/parity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/repay { wallet, asset, amount, preview? } — repays borrowed `asset` (e.g. USDC) against the wallet's
 * real Vanilla Kamino obligation. `amount` is a positive number, or the literal string "max" to repay the full
 * debt (klend-sdk resolves the exact amount, including interest accrued since this was last read, on-chain).
 *   preview: true  → simulation only, no transaction (for the confirmation dialog's "projected state" numbers)
 *   otherwise      → also returns the unsigned base64 transaction for the wallet to sign; refuses (422) if the
 *                    simulation failed.
 * Vanilla positions only — Multiply unwind is a separate, not-yet-built flow.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) throw new HttpError(400, "Body must be JSON.");
    const wallet = requireWallet(body.wallet);
    if (typeof body.asset !== "string" || !body.asset) throw new HttpError(400, "asset is required.");
    const amount = body.amount === "max" ? ("max" as const) : new Decimal(typeof body.amount === "string" || typeof body.amount === "number" ? body.amount : NaN);
    if (amount !== "max" && (!(amount instanceof Decimal) || !amount.isFinite() || amount.lte(0))) {
      throw new HttpError(400, 'amount must be a positive number, or the literal string "max".');
    }

    const { manager } = await getParity();
    const result = await quickRetry(() => manager.repay(wallet, body.asset, amount, { includeTransaction: true }));
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
