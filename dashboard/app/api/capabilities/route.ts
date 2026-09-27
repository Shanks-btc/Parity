import type { NextRequest } from "next/server";
import { fail, getParity, HttpError, json, quickRetry } from "@/lib/server/parity";

export const dynamic = "force-dynamic";

/** GET /api/capabilities?asset={symbol} — real Borrow / Earn / Multiply status (with the cached fallback). */
export async function GET(req: NextRequest) {
  try {
    const asset = req.nextUrl.searchParams.get("asset");
    if (!asset || !/^[A-Za-z0-9.]{1,12}$/.test(asset)) throw new HttpError(400, "asset must be a reserve symbol, e.g. AAPLx.");
    const { client } = await getParity();
    return json(await quickRetry(() => client.getAssetCapabilities(asset)));
  } catch (err) {
    return fail(err);
  }
}
