/** READ-ONLY: what buying each xStock costs: real Jupiter quotes (USDC->x, SOL->x), the swap tx created accounts and fees. */
import { boot, USER, address, describeIx, withRpcRetry } from "./preflight-lib";
import { buildPlainSwapTransaction } from "../src/kamino/jupiter";
import { deserializeFromTransport } from "../src/kamino/execute";
import { getCompiledTransactionMessageDecoder, decompileTransactionMessageFetchingLookupTables } from "@solana/kit";

const { client, rpc } = await boot();
const SOL = "So11111111111111111111111111111111111111112";
const usdc = client.getReserve("USDC").getLiquidityMint();
const J = "https://lite-api.jup.ag/swap/v1";
const jget = async (u: string): Promise<any> => {
  for (let i = 0; i < 2; i++) {
    const r = await fetch(u);
    const t = await r.text();
    try {
      const j = JSON.parse(t);
      if (r.ok) return j;
      if (i) return { error: `${r.status} ${t.slice(0, 160)}` };
    } catch {
      if (i) return { error: `${r.status} ${t.slice(0, 160)}` };
    }
  }
};
const routeOf = (q: any) => (q.routePlan ?? []).map((p: any) => `${p.swapInfo?.label} ${p.percent}%`).join(" + ");

// SOL/USD rate as Jupiter quotes it (for converting SOL costs to USD)
const solQ = await jget(`${J}/quote?inputMint=${SOL}&outputMint=${usdc}&amount=1000000000&slippageBps=50`);
const solUsd = Number(solQ.outAmount) / 1e6;
console.log(`Jupiter: 1 SOL -> ${solUsd.toFixed(2)} USDC (route ${routeOf(solQ)})\n`);

const targets: { asset: string; label: string; raw: number }[] = [
  { asset: "SPYx", label: "Borrow SPYx (deposit 0.00171879)", raw: 171879 },
  { asset: "AAPLx", label: "Borrow AAPLx (deposit 0.00584617)", raw: 584617 },
  { asset: "SPYx", label: "Multiply SPYx floor (0.00000129)", raw: 129 },
  { asset: "TSLAx", label: "Multiply TSLAx floor (0.00000269)", raw: 269 },
];
for (const asset of ["SPYx", "AAPLx", "TSLAx"]) targets.push({ asset, label: `${asset} $1.00 reference buy`, raw: Math.ceil((1 / Number(client.getReserve(asset).getOracleMarketPrice())) * 1e8) });
const quotes: any[] = [];
for (const t of targets) {
  const res = client.getReserve(t.asset);
  const mint = res.getLiquidityMint();
  const price = Number(res.getOracleMarketPrice());
  const usd = (t.raw / 1e8) * price;
  const qU = await jget(`${J}/quote?inputMint=${usdc}&outputMint=${mint}&amount=${t.raw}&swapMode=ExactOut&slippageBps=100`);
  const qS = await jget(`${J}/quote?inputMint=${SOL}&outputMint=${mint}&amount=${t.raw}&swapMode=ExactOut&slippageBps=100`);
  const row = {
    ...t, price, usd,
    usdc: qU.error ? null : Number(qU.inAmount) / 1e6, impU: qU.priceImpactPct, routeU: qU.error ? qU.error : routeOf(qU),
    sol: qS.error ? null : Number(qS.inAmount) / 1e9, impS: qS.priceImpactPct, routeS: qS.error ? qS.error : routeOf(qS),
  };
  quotes.push(row);
  console.log(`${t.label}\n   ${(t.raw / 1e8).toFixed(8)} ${t.asset} = $${usd.toFixed(4)} at Kamino oracle $${price.toFixed(2)}`);
  console.log(`   USDC->${t.asset} (ExactOut): USDC needed ${row.usdc ?? "n/a"}  priceImpact ${row.impU}%  route ${row.routeU}`);
  console.log(`   SOL ->${t.asset} (ExactOut): SOL needed ${row.sol ?? "n/a"} (~$${row.sol ? (row.sol * solUsd).toFixed(4) : "n/a"})  priceImpact ${row.impS}%  route ${row.routeS}`);
}

// The buy transaction itself: decode instructions built for the USER, and simulate a same-shape stand-in (holds USDC, no xStock account)
const STAND_IN = "Gm1mMs1Bs5imsbSMPoAFFCAcQHuBsZPmTeEE3uKRNLG2";
async function decode(b64: string) {
  const tx = deserializeFromTransport(b64);
  const compiled = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  const msg: any = await decompileTransactionMessageFetchingLookupTables(compiled, rpc);
  return { tx, ixs: msg.instructions as any[] };
}
const buys: any = {};
for (const asset of ["SPYx", "AAPLx", "TSLAx"]) {
  console.log(`\n=== BUY TX for ${asset}: 1 USDC -> ${asset}`);
  const mint = client.getReserve(asset).getLiquidityMint();
  for (const who of [USER, STAND_IN]) {
    const tag = who === USER ? "USER" : "stand-in";
    const swap: any = await withRpcRetry(() => buildPlainSwapTransaction({ ownerAddress: who, inputMint: usdc, outputMint: mint, amountRaw: "1000000", slippageBps: 100 }), 2, 2000).catch((e) => ({ error: (e as Error).message }));
    if (swap.error) { console.log(`  [${tag}] could not build: ${swap.error}`); continue; }
    const { tx, ixs } = await decode(swap.transactionBase64);
    const d = ixs.map(describeIx);
    const cb = d.filter((x) => x.program === "computeBudget").map((x) => x.name);
    const limit = Number((cb.find((n) => n.startsWith("setComputeUnitLimit")) ?? "(0)").match(/\((\d+)\)/)?.[1] ?? 0);
    const pricePerCu = Number((cb.find((n) => n.startsWith("setComputeUnitPrice")) ?? "(0").match(/\((\d+)/)?.[1] ?? 0);
    const prio = Math.ceil((limit * pricePerCu) / 1e6);
    const fee = await rpc.getFeeForMessage(Buffer.from(tx.messageBytes).toString("base64") as any, { commitment: "confirmed" }).send();
    console.log(`  [${tag}] ${ixs.length} ixs: ${d.map((x) => `${x.program}:${x.name}`).join(", ")}`);
    console.log(`     compute budget: ${cb.join(", ") || "none"} => priority fee = ceil(${limit} CU x ${pricePerCu} uLamports/CU / 1e6) = ${prio} lamports; network fee (getFeeForMessage) ${fee.value} lamports`);
    const writable = new Map<string, string>();
    ixs.forEach((ix, i) => (ix.accounts ?? []).forEach((a: any, j: number) => {
      if ((Number(a.role) & 1) && !(Number(a.role) & 2) && !writable.has(String(a.address))) writable.set(String(a.address), `${d[i].program}:${d[i].name}:${j}`);
    }));
    const addrs = [...writable.keys()];
    const pre = await rpc.getMultipleAccounts(addrs.map((a) => address(a)), { encoding: "base64" }).send();
    const created = addrs.filter((_, i) => !pre.value[i]);
    console.log(`     accounts it would create: ${created.length ? created.map((a) => `${a.slice(0, 8)}… (${writable.get(a)})`).join("; ") : "none"}`);
    if (who === STAND_IN) {
      const before = await rpc.getBalance(address(who), { commitment: "confirmed" }).send();
      const sim: any = await rpc.simulateTransaction(swap.transactionBase64, { encoding: "base64", sigVerify: false, commitment: "confirmed", accounts: { addresses: [address(who), ...created.map((a) => address(a))], encoding: "base64" } }).send();
      if (sim.value.err) { console.log(`     SIM FAILED: ${JSON.stringify(sim.value.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))} ${(sim.value.logs ?? []).filter((l: string) => /rror|insufficient/i.test(l)).slice(-2).join(" | ")}`); continue; }
      const accts: any[] = sim.value.accounts;
      let rentSum = 0;
      for (let i = 0; i < created.length; i++) {
        const a = accts[i + 1];
        const space = a?.data ? Buffer.from(a.data[0], "base64").length : 0;
        rentSum += Number(a?.lamports ?? 0);
        const min = space ? await rpc.getMinimumBalanceForRentExemption(BigInt(space)).send() : "n/a";
        console.log(`     CREATED ${created[i].slice(0, 8)}… owner ${(a?.owner ?? "?").slice(0, 8)}…  ${space} bytes  ${a?.lamports} lamports  (getMinimumBalanceForRentExemption(${space}) = ${min})`);
      }
      const delta = Number(before.value) - Number(accts[0].lamports);
      const rest = delta - rentSum;
      console.log(`     measured fee-payer delta ${delta} = rent ${rentSum} + ${rest}  (network fee ${fee.value}, priority ${prio}) -> ${rest === Number(fee.value) + prio ? "MATCHES fee+priority" : rest === Number(fee.value) ? "matches the network fee only (simulation does not charge the priority fee)" : "DOES NOT MATCH"}`);
      buys[asset] = { rentSum, created: created.length, fee: Number(fee.value), prio, delta };
    } else buys[asset + ":user"] = { created: created.length, fee: Number(fee.value), prio };
  }
}
console.log("\nJSON " + JSON.stringify({ solUsd, quotes, buys }));
