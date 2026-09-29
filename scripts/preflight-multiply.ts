/** READ-ONLY: smallest Multiply deposit (1.5x) that passes the EXISTING simulation, + the Jupiter route for its swap leg. */
import { boot, SUBJECT, Decimal } from "./preflight-lib";

const ASSET = process.argv[2] ?? "SPYx";
const LEV = 1.5;
const { client, validator } = await boot();
const reserve = client.getReserve(ASSET), usdcMint = client.getReserve("USDC").getLiquidityMint();
const price = reserve.getOracleMarketPrice(), dec = reserve.getMintDecimals();
const subject = process.env.SUBJ ?? SUBJECT[ASSET];
console.log(`${ASSET} Multiply @${LEV}x: oracle $${price.toFixed(4)}  subject (read-only, fresh-shaped real wallet) ${subject}\n`);
const tok = (usd: number) => new Decimal(usd).div(price).toDecimalPlaces(dec, Decimal.ROUND_UP);
const results = new Map<number, any>();
async function probe(usd: number) {
  const amount = tok(usd);
  const run = () => validator.validate(subject, { strategyType: "multiply", newDepositSymbol: ASSET, newDepositAmount: amount.toNumber(), targetLeverage: LEV }).catch((e) => ({ valid: false, problems: ["THROWN: " + (e as Error).message], simulation: { ran: false }, projectedHealthFactor: null } as any));
  const t0 = Date.now(); let r = await run(); let note = "";
  if (!r.valid) { const r2 = await run(); note = r2.valid ? " (1st attempt FAILED, retry PASSED)" : " (retried once, still failed)"; r = r2; }
  const sim = r.simulation.ran ? r.simulation : null;
  console.log(`  deposit ${amount.toFixed(dec)} ${ASSET} (~$${amount.mul(price).toFixed(3)})  → ${r.valid ? `PASS | HF ${r.projectedHealthFactor?.toFixed(3)}  CU ${sim?.unitsConsumed}  ixs ${sim?.instructionCount}  slot ${sim?.slot}` : "FAIL: " + (r.problems[0] ?? "?").replace(/\s+/g, " ").slice(0, 400)}${note}  [${((Date.now() - t0) / 1000).toFixed(1)}s]`);
  results.set(usd, r);
  return r.valid as boolean;
}
console.log("coarse search (USD value of the deposit):");
const ladder = process.env.LADDER ? process.env.LADDER.split(",").map(Number) : [0.1, 0.25, 0.5, 1, 2, 5, 10, 25];
let lo = 0, hi = 0;
for (const u of ladder) { if (await probe(u)) { hi = u; break; } lo = u; }
if (!hi) { console.log("\nNo passing size up to $25."); process.exit(0); }
if (lo) { console.log(`\nbisect between $${lo} (fail) and $${hi} (pass):`); for (let i = 0; i < 4; i++) { const mid = Math.round(((lo + hi) / 2) * 1000) / 1000; if (await probe(mid)) hi = mid; else lo = mid; } }
const best = tok(hi);
const r = results.get(hi);
console.log(`\n>>> smallest deposit that passed: ${best.toFixed(dec)} ${ASSET} (~$${best.mul(price).toFixed(3)}), HF ${r.projectedHealthFactor?.toFixed(3)}, CU ${r.simulation.unitsConsumed}`);
// Jupiter route for the swap leg: flash-borrowed USDC = deposit_usd * (L-1), swapped USDC -> collateral (same quote request as src/kamino/jupiter.ts)
const usdcRaw = new Decimal(best.mul(price)).mul(LEV - 1).mul(1e6).toFixed(0);
const q = await fetch(`https://lite-api.jup.ag/swap/v1/quote?inputMint=${usdcMint}&outputMint=${reserve.getLiquidityMint()}&amount=${usdcRaw}&slippageBps=100&maxAccounts=20`).then((x) => x.json()) as any;
console.log(`Jupiter quote for the swap leg (${(Number(usdcRaw) / 1e6).toFixed(4)} USDC -> ${ASSET}): out ${(Number(q.outAmount) / 10 ** dec).toFixed(dec)} ${ASSET}, priceImpact ${q.priceImpactPct}%, route: ${(q.routePlan ?? []).map((p: any) => `${p.swapInfo?.label} ${p.percent}%`).join(" + ") || "(none: " + JSON.stringify(q).slice(0, 150) + ")"}`);
