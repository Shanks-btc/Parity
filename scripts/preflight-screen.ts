/** READ-ONLY: screen holder wallets for use as simulation subjects (SOL, obligations, USDC account, user metadata). */
import "dotenv/config";
import { address } from "@solana/kit";
import * as klend from "@kamino-finance/klend-sdk";
import { KaminoClient } from "../src/kamino/client";
import { withRpcRetry } from "../src/kamino/rpc-retry";

const client = new KaminoClient(process.env.SOLANA_RPC_URL!, process.env.KAMINO_MAIN_MARKET!);
await withRpcRetry(() => client.init(), 3, 2000);
const rpc = client.getRpc();
const CANDS: Record<string, string[]> = {
  SPYx: ["7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z", "2Z7zhqp1eddmHNmEqexftST6DFPWmoL4QqfgiG5uJMJx", "9U76mo3WuP28s4kYJ9CMH1CiQh6Ph3r5Zg5awZM5vMQd", "6LY1JzAFVZsP2a2xKrtU6znQMQ5h4i7tocWdgrkZzkzF", "DrAR2ZNC5KYZps7NJyYHfzeZTaqbMUaGM3CBUWfpbCUs", "9A9dUreQvTNoqNrqQC2DN1onfZWBtCBsTiuA6oGXZwc6", "7a8xxAJBELDo6P9dikSYctdw6ce8F4mWr3ahcAD8Ao49", "6truu3rZuiB9rKQg4VYC3Dt3QwV7DgwGqXrYUcrvnDDE"],
  TSLAx: ["6LY1JzAFVZsP2a2xKrtU6znQMQ5h4i7tocWdgrkZzkzF", "AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2", "4gtnFprfzM2CRtRZeh8BuscNFTKvkvF4Cfzb1uneuAJs", "92GYvf31937niBKJfeV6MHMCaMonVQS1Kv1ULZW2PBhr", "7ANWqbfHRqRr4Y7KgZguXJXoPk3HFoWLqq6ET8e9HRmb", "8aDaBQkTrS6HVMjyc6EZebgdiaXhLYGriDWKWWp1NpFF"],
  AAPLx: ["C68a6RCGLiPskbPYtAcsCjhG8tfTWYcoB4JjCrXFdqyo", "AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2", "44P5Ct5JkPz76Rs2K6juC65zXMpFRDrHatxcASJ4Dyra", "u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w", "1"].filter((x) => x.length > 20),
};
const usdcMint = client.getReserve("USDC").getLiquidityMint();
for (const [sym, wallets] of Object.entries(CANDS)) {
  console.log(`\n${sym} candidates:`);
  for (const w of wallets) {
    try {
      const pos = await withRpcRetry(() => client.getPosition(w), 3, 2000);
      const usdcAcc = await withRpcRetry(() => rpc.getTokenAccountsByOwner(address(w), { mint: address(usdcMint) }, { encoding: "base64" }).send(), 3, 2000);
      const [meta] = await (klend as any).userMetadataPda ? [await (klend as any).userMetadataPda(address(w), klend.PROGRAM_ID)] : [null];
      const metaInfo = meta ? await rpc.getAccountInfo(meta[0] ?? meta, { encoding: "base64" }).send() : null;
      const spot = pos.walletBalances.find((b) => b.symbol === sym);
      console.log(`  ${w}  SOL ${Number(pos.solBalance).toFixed(3)}  ${sym} ${Number(spot?.amount ?? 0).toFixed(4)}  obligations ${pos.obligations.length} [${pos.obligations.map((o) => o.type).join(",")}]  USDC-acct ${usdcAcc.value.length ? "yes" : "NO"}  userMeta ${metaInfo ? (metaInfo.value ? "yes" : "NO") : "?"}`);
    } catch (e) { console.log(`  ${w}  ERROR ${(e as Error).message.slice(0, 80)}`); }
  }
}
