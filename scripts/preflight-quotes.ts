/** READ-ONLY: real Jupiter ExactIn quotes, converged so the OUTPUT covers the target xStock amount (ExactOut has no routes for xStocks). */
import { boot, USER, describeIx, withRpcRetry } from "./preflight-lib";
import { buildPlainSwapTransaction } from "../src/kamino/jupiter";
import { deserializeFromTransport } from "../src/kamino/execute";
import { getCompiledTransactionMessageDecoder, decompileTransactionMessageFetchingLookupTables, address } from "@solana/kit";

const { client, rpc } = await boot();
const SOL = "So11111111111111111111111111111111111111112";
const usdc = client.getReserve("USDC").getLiquidityMint();
const J = "https://lite-api.jup.ag/swap/v1";
const jget = async (u: string): Promise<any> => {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(u);
      const t = await r.text();
      const j = JSON.parse(t);
      if (r.ok) return j;
      if (i === 2) return { error: `${r.status} ${t.slice(0, 140)}` };
    } catch (e) {
      if (i === 2) return { error: (e as Error).message };
    }
  }
};
const routeOf = (q: any) => (q.routePlan ?? []).map((p: any) => `${p.swapInfo?.label} ${p.percent}%`).join(" + ");
const solQ = await jget(`${J}/quote?inputMint=${SOL}&outputMint=${usdc}&amount=1000000000&slippageBps=50`);
const solUsd = Number(solQ.outAmount) / 1e6;

const targets = [
  { asset: "SPYx", label: "Borrow SPYx deposit", raw: 171879 },
  { asset: "AAPLx", label: "Borrow AAPLx deposit", raw: 584617 },
  { asset: "SPYx", label: "Multiply SPYx floor", raw: 129 },
  { asset: "TSLAx", label: "Multiply TSLAx floor", raw: 269 },
  { asset: "SPYx", label: "SPYx $1.00 reference", raw: 128909 },
  { asset: "AAPLx", label: "AAPLx $1.00 reference", raw: 292309 },
  { asset: "TSLAx", label: "TSLAx $1.00 reference", raw: 268760 },
];
// converge: start from the oracle value +1%, requote until the quoted OUTPUT >= target raw amount
async function converge(input: string, mint: string, startIn: number, target: number) {
  let amt = Math.max(1, Math.ceil(startIn));
  let q: any;
  for (let i = 0; i < 5; i++) {
    q = await jget(`${J}/quote?inputMint=${input}&outputMint=${mint}&amount=${amt}&slippageBps=100`);
    if (q.error) return { error: q.error, tried: amt };
    const out = Number(q.outAmount);
    if (out >= target) return { inAmount: amt, q };
    amt = Math.max(amt + 1, Math.ceil((amt * target) / Math.max(out, 1) * 1.002));
  }
  return { inAmount: amt, q, short: true };
}
const out: any[] = [];
console.log(`Jupiter: 1 SOL -> ${solUsd.toFixed(2)} USDC (route ${routeOf(solQ)})\n`);
for (const t of targets) {
  const res = client.getReserve(t.asset);
  const mint = res.getLiquidityMint();
  const price = Number(res.getOracleMarketPrice());
  const usd = (t.raw / 1e8) * price;
  const u = await converge(usdc, mint, usd * 1.01 * 1e6, t.raw);
  const s = await converge(SOL, mint, ((usd * 1.01) / solUsd) * 1e9, t.raw);
  const row: any = { ...t, price, usd };
  if ("error" in u) row.usdcErr = u.error; else { row.usdc = u.inAmount / 1e6; row.usdcOut = Number(u.q.outAmount) / 1e8; row.usdcMin = Number(u.q.otherAmountThreshold) / 1e8; row.usdcImpact = u.q.priceImpactPct; row.usdcRoute = routeOf(u.q); row.usdcShort = !!u.short; }
  if ("error" in s) row.solErr = s.error; else { row.sol = s.inAmount / 1e9; row.solOut = Number(s.q.outAmount) / 1e8; row.solImpact = s.q.priceImpactPct; row.solRoute = routeOf(s.q); row.solShort = !!s.short; }
  out.push(row);
  console.log(`${t.label}: ${(t.raw / 1e8).toFixed(8)} ${t.asset} = $${usd.toFixed(4)} at Kamino oracle $${price.toFixed(2)}`);
  console.log(row.usdcErr ? `   USDC: ${row.usdcErr}` : `   USDC in ${row.usdc} -> out ${row.usdcOut.toFixed(8)} ${t.asset} (min after 1% slippage ${row.usdcMin.toFixed(8)})  impact ${row.usdcImpact}%  route ${row.usdcRoute}${row.usdcShort ? "  [did not converge]" : ""}`);
  console.log(row.solErr ? `   SOL:  ${row.solErr}` : `   SOL  in ${row.sol} (~$${(row.sol * solUsd).toFixed(4)}) -> out ${row.solOut.toFixed(8)} ${t.asset}  impact ${row.solImpact}%  route ${row.solRoute}${row.solShort ? "  [did not converge]" : ""}`);
}

// SOL-funded buy: decode the swap the USER would sign (is a temporary wSOL account needed?)
const mint = client.getReserve("SPYx").getLiquidityMint();
const swap: any = await withRpcRetry(() => buildPlainSwapTransaction({ ownerAddress: USER, inputMint: SOL, outputMint: mint, amountRaw: "12000000", slippageBps: 100 }), 2, 2000).catch((e) => ({ error: (e as Error).message }));
if (swap.error) console.log("\nSOL->SPYx swap build for USER failed:", swap.error);
else {
  const tx = deserializeFromTransport(swap.transactionBase64);
  const msg: any = await decompileTransactionMessageFetchingLookupTables(getCompiledTransactionMessageDecoder().decode(tx.messageBytes), rpc);
  const d = msg.instructions.map(describeIx);
  console.log(`\nSOL->SPYx swap built for the USER: ${d.map((x: any) => `${x.program}:${x.name}`).join(", ")}`);
  const sysTransfers = msg.instructions.filter((ix: any) => String(ix.programAddress) === "11111111111111111111111111111111").map((ix: any) => describeIx(ix).name);
  console.log(`   system-program instructions: ${sysTransfers.join(", ") || "none"}`);
}
console.log("\nrent-exempt minimum for a 0-byte wallet account (getMinimumBalanceForRentExemption(0)):", String(await rpc.getMinimumBalanceForRentExemption(0n).send()), "lamports");
console.log("JSON " + JSON.stringify({ solUsd, out }));
