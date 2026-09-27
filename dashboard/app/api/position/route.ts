import type { NextRequest } from "next/server";
import { fail, getParity, json, quickRetry, requireWallet } from "@/lib/server/parity";

export const dynamic = "force-dynamic";

/** GET /api/position?wallet={pubkey} — KaminoClient.getPosition(): every obligation per reserve + spot balances. */
export async function GET(req: NextRequest) {
  try {
    const wallet = requireWallet(req.nextUrl.searchParams.get("wallet"));
    const { client } = await getParity();
    return json(await quickRetry(() => client.getPosition(wallet)));
  } catch (err) {
    return fail(err);
  }
}
