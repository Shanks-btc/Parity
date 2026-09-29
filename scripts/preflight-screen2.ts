/** READ-ONLY: find xStock holders that ALREADY have a Kamino user-metadata account but no Multiply obligation. */
import { boot, address, withRpcRetry } from "./preflight-lib";
import { userMetadataPda, PROGRAM_ID } from "@kamino-finance/klend-sdk";
const { client, rpc } = await boot();
const T22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
for (const sym of ["SPYx", "TSLAx"]) {
  const reserve = client.getReserve(sym), mint = reserve.getLiquidityMint(), price = reserve.getOracleMarketPrice();
  const accts: any[] = await withRpcRetry(() => rpc.getProgramAccounts(address(T22), { encoding: "jsonParsed", filters: [{ memcmp: { offset: 0n, bytes: mint as any, encoding: "base58" } }] }).send(), 3, 3000) as any;
  const holders = accts.map((a) => { const i = a.account.data?.parsed?.info; const t = i?.tokenAmount; return { owner: i?.owner as string, ui: t ? Number(t.amount) / 10 ** t.decimals : 0 }; }).filter((h) => h.owner && h.ui * Number(price) >= 3 && h.ui * Number(price) < 20000).slice(0, 4000);
  const pdas = await Promise.all(holders.map(async (h) => (await userMetadataPda(address(h.owner), PROGRAM_ID))[0]));
  const withMeta: typeof holders = [];
  for (let i = 0; i < pdas.length; i += 100) {
    const res = await withRpcRetry(() => rpc.getMultipleAccounts(pdas.slice(i, i + 100), { encoding: "base64" }).send(), 3, 2000);
    res.value.forEach((v, j) => v && withMeta.push(holders[i + j]));
  }
  console.log(`\n${sym}: ${holders.length} holders worth $3-$20k checked, ${withMeta.length} already have Kamino user metadata`);
  for (const h of withMeta.slice(0, 8)) {
    const pos = await withRpcRetry(() => client.getPosition(h.owner), 3, 2000).catch(() => null);
    console.log(`  ${h.owner}  ${sym} ${h.ui.toFixed(5)} (~$${(h.ui * Number(price)).toFixed(2)})  SOL ${pos ? Number(pos.solBalance).toFixed(3) : "?"}  obligations ${pos ? pos.obligations.map((o) => `${o.type}[${o.deposits.map((d) => d.symbol).join("+")}]`).join(",") || "none" : "?"}`);
  }
}
