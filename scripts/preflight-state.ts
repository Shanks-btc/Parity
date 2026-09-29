/** READ-ONLY preflight, step 1: wallet state. No signing, no sending, no keypair. */
import "dotenv/config";
import { address } from "@solana/kit";
import { KaminoClient } from "../src/kamino/client";
import { withRpcRetry } from "../src/kamino/rpc-retry";

const WALLET = process.argv[2];
const t0 = Date.now();
const client = new KaminoClient(process.env.SOLANA_RPC_URL!, process.env.KAMINO_MAIN_MARKET!);
await withRpcRetry(() => client.init(), 3, 2000);
console.log(`market loaded in ${Date.now() - t0}ms`);

const pos = await withRpcRetry(() => client.getPosition(WALLET), 3, 2000);
console.log("\nSOL balance:", pos.solBalance);
console.log("spot balances of Kamino-listed tokens (nonzero):");
for (const b of pos.walletBalances) console.log(`  ${b.symbol.padEnd(7)} movable(raw)=${b.amount}  on-screen=${b.displayAmount}  valueUsd=${b.valueUsd}`);
if (pos.walletBalances.length === 0) console.log("  (none)");
console.log("obligations:", pos.obligations.length ? JSON.stringify(pos.obligations.map((o) => ({ type: o.type, address: o.obligationAddress, deposits: o.deposits.map((d) => `${d.symbol} ${d.amount}`), borrows: o.borrows.map((d) => `${d.symbol} ${d.amount}`), hf: o.healthFactor })), null, 1) : "NONE (no Vanilla, no Multiply)");

// Which token accounts exist (zero-balance ones included), per mint, both token programs
const rpc = client.getRpc();
console.log("\nassociated / token accounts that exist, by mint:");
for (const sym of ["USDC", "SPYx", "AAPLx", "TSLAx"]) {
  const reserve = client.getReserve(sym);
  const mint = reserve.getLiquidityMint();
  const res = await withRpcRetry(() => rpc.getTokenAccountsByOwner(address(WALLET), { mint: address(mint) }, { encoding: "jsonParsed" }).send(), 3, 2000);
  console.log(`  ${sym.padEnd(6)} mint ${mint}: ${res.value.length ? res.value.map((a: any) => `${a.pubkey} (len ${a.account.data?.parsed ? "parsed" : "?"}, owner-program ${a.account.owner})`).join("; ") : "NO token account"}`);
}
const info = await rpc.getAccountInfo(address(WALLET), { encoding: "base64" }).send();
console.log("\nwallet account on chain:", info.value ? `exists, ${info.value.lamports} lamports, owner ${info.value.owner}` : "does NOT exist on chain (0 lamports)");
