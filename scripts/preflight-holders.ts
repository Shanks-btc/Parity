/** READ-ONLY: find real mainnet wallets holding enough of each xStock to serve as simulation subjects. */
import "dotenv/config";
import { address } from "@solana/kit";
import { KaminoClient } from "../src/kamino/client";
import { withRpcRetry } from "../src/kamino/rpc-retry";
import Decimal from "decimal.js";

const client = new KaminoClient(process.env.SOLANA_RPC_URL!, process.env.KAMINO_MAIN_MARKET!);
await withRpcRetry(() => client.init(), 3, 2000);
const rpc = client.getRpc();
const T22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const out: Record<string, any[]> = {};
for (const sym of ["SPYx", "TSLAx", "AAPLx"]) {
  const reserve = client.getReserve(sym);
  const mint = reserve.getLiquidityMint();
  const price = reserve.getOracleMarketPrice();
  const accts = await withRpcRetry(() => rpc.getProgramAccounts(address(T22), { encoding: "jsonParsed", filters: [{ memcmp: { offset: 0n, bytes: mint as any, encoding: "base58" } }] }).send(), 3, 3000);
  const holders = accts.map((a: any) => { const i = a.account.data?.parsed?.info; const t = i?.tokenAmount; return { owner: i?.owner as string, raw: t ? new Decimal(t.amount).div(new Decimal(10).pow(t.decimals)) : new Decimal(0) }; }).filter((h) => h.owner && h.raw.gt(0)).sort((a, b) => b.raw.comparedTo(a.raw));
  console.log(`\n${sym}: mint ${mint}, oracle $${price.toFixed(2)}, ${holders.length} wallet token accounts with a balance`);
  out[sym] = [];
  for (const h of holders.slice(0, 12)) {
    if (h.owner === "BEDkFDUCGmzCrXgNmqrSEiF5vSnEARAhMPw83jMMKkyx") continue;
    const usd = h.raw.mul(price);
    console.log(`  ${h.owner}  ${h.raw.toString().padEnd(14)} ~$${usd.toFixed(2)}`);
    out[sym].push({ owner: h.owner, raw: h.raw.toString() });
  }
}
console.log("\nJSON " + JSON.stringify(out));
