/** READ-ONLY: real quotes for every asset x pay-token, and simulated swap builds on a stand-in wallet (destination account missing). */
import { boot, address, Decimal } from "./preflight-lib";
import { buildPlainSwapTransaction, fetchPlainSwapQuote, JupiterNoRouteError } from "../src/kamino/jupiter";
import { simulateSwapWithCosts } from "../src/kamino/swap-cost";

const STAND_IN = process.env.STAND_IN ?? "Gm1mMs1Bs5imsbSMPoAFFCAcQHuBsZPmTeEE3uKRNLG2";
const SOL = "So11111111111111111111111111111111111111112";
const { client, rpc } = await boot();
const usdc = client.getReserve("USDC").getLiquidityMint();
const dec = (r: string, d: number) => new Decimal(r).div(new Decimal(10).pow(d)).toString();

console.log("=== A. quotes: every asset x pay token, $2 worth ===");
const sol = await fetchPlainSwapQuote({ inputMint: SOL, outputMint: usdc, amountRaw: "1000000000", slippageBps: 50 });
const solUsd = Number(sol.quote.outAmount) / 1e6;
console.log(`1 SOL = ${solUsd.toFixed(2)} USDC`);
for (const asset of ["AAPLx", "SPYx", "TSLAx"]) {
  const r = client.getReserve(asset); const od = r.getMintDecimals();
  for (const input of ["USDC", "SOL"] as const) {
    const raw = input === "USDC" ? "2000000" : String(Math.round((2 / solUsd) * 1e9));
    try {
      const { quote } = await fetchPlainSwapQuote({ inputMint: input === "USDC" ? usdc : SOL, outputMint: r.getLiquidityMint(), amountRaw: raw, slippageBps: 100 });
      console.log(`  ${input} -> ${asset}: pay ${dec(raw, input === "USDC" ? 6 : 9)} ${input} -> expect ${dec(quote.outAmount, od)}, min ${dec(quote.otherAmountThreshold, od)} @1%, impact ${quote.priceImpactPct}%, route ${quote.routeLabels.join(" + ")}`);
    } catch (e) { console.log(`  ${input} -> ${asset}: ${e instanceof JupiterNoRouteError ? "NO ROUTE" : "ERROR"}: ${(e as Error).message}`); }
  }
}

console.log(`\n=== B. simulated builds for stand-in ${STAND_IN} ===`);
const bal = await rpc.getBalance(address(STAND_IN)).send();
const tok = await client.getWalletBalances(STAND_IN);
console.log(`stand-in: ${Number(bal.value) / 1e9} SOL; movable balances: ${tok.map((t) => `${t.amount} ${t.symbol}`).join(", ") || "none"}`);
for (const asset of ["SPYx", "AAPLx", "TSLAx"]) {
  const r = client.getReserve(asset);
  for (const input of ["USDC", "SOL"] as const) {
    const amountRaw = input === "USDC" ? "1000000" : "12000000";
    try {
      const swap = await buildPlainSwapTransaction({ ownerAddress: STAND_IN, inputMint: input === "USDC" ? usdc : SOL, outputMint: r.getLiquidityMint(), amountRaw, slippageBps: 100 });
      const sim = await simulateSwapWithCosts(rpc, swap.transactionBase64, r.getLiquidityMint());
      console.log(`  ${input} -> ${asset} (${dec(amountRaw, input === "USDC" ? 6 : 9)} ${input}): success=${sim.success} CU=${sim.unitsConsumed} base=${sim.costs.networkFeeLamports} total(getFeeForMessage)=${sim.costs.totalFeeLamports} priority=${sim.costs.priorityFeeLamports} (limit ${sim.costs.computeUnitLimit} x ${sim.costs.computeUnitPriceMicroLamports} uLamports) createsTokenAccount=${sim.costs.createsTokenAccount} destRent=${sim.costs.tokenAccountRentLamports} otherKeptRent=${sim.costs.otherKeptRentLamports} temporary=${sim.costs.temporaryAccounts}${sim.success ? "" : " ERR " + sim.failureReason + " " + sim.keyLogs.join(" | ")}`);
    } catch (e) { console.log(`  ${input} -> ${asset}: BUILD ERROR ${(e as Error).message}`); }
  }
}
