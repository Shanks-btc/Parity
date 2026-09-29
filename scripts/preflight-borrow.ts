/** READ-ONLY: smallest Borrow amounts that pass the EXISTING simulation, borrow ~$0.50 USDC, projected HF >= 2.0. */
import { boot, SUBJECT, Decimal } from "./preflight-lib";
import { KaminoObligation } from "@kamino-finance/klend-sdk";

const ASSET = process.argv[2] ?? "SPYx";
const { client, validator } = await boot();
const reserve = client.getReserve(ASSET), usdcRes = client.getReserve("USDC");
const price = reserve.getOracleMarketPrice(), dec = reserve.getMintDecimals();
const liq = reserve.stats.liquidationThreshold, ltv = reserve.stats.loanToValue;
const bf = KaminoObligation.getBorrowFactorForReserve(usdcRes, 0);
const subject = SUBJECT[ASSET];
console.log(`${ASSET}: oracle $${price.toFixed(4)}  decimals ${dec}  LTV ${ltv}  liquidation threshold ${liq}  USDC borrow factor ${bf}`);
console.log(`simulation subject (read-only, fresh-shaped real wallet): ${subject}\n`);

const BORROW = 0.5;
const tok = (usd: Decimal) => usd.div(price).toDecimalPlaces(dec, Decimal.ROUND_UP);
const summarize = (r: any) => r.valid ? "PASS" : "FAIL: " + (r.problems[0] ?? "?").replace(/\s+/g, " ").slice(0, 330);
async function probe(label: string, deposit: Decimal, borrow: number) {
  let r = await validator.validate(subject, { strategyType: "borrow", newDepositSymbol: ASSET, newDepositAmount: deposit.toNumber(), borrowSymbol: "USDC", borrowAmount: borrow }).catch((e) => ({ valid: false, problems: ["THROWN: " + e.message], simulation: { ran: false }, projectedHealthFactor: null } as any));
  if (!r.valid) { // retry once before reporting a failure
    const r2 = await validator.validate(subject, { strategyType: "borrow", newDepositSymbol: ASSET, newDepositAmount: deposit.toNumber(), borrowSymbol: "USDC", borrowAmount: borrow }).catch((e) => ({ valid: false, problems: ["THROWN: " + e.message], simulation: { ran: false }, projectedHealthFactor: null } as any));
    if (r2.valid) console.log("   (first attempt failed, retry passed)"); r = r2;
  }
  const sim = r.simulation.ran ? r.simulation : null;
  console.log(`${label.padEnd(34)} deposit ${deposit.toFixed(dec)} ${ASSET} (~$${deposit.mul(price).toFixed(3)})  borrow $${borrow}  → ${summarize(r)}${r.valid ? `  | HF ${r.projectedHealthFactor?.toFixed(3)}  CU ${sim?.unitsConsumed}  slot ${sim?.slot}` : ""}`);
  return r;
}
// analytic starting point for HF >= 2.0:  HF = (C * liq) / (borrow * bf)  =>  C >= 2 * borrow * bf / liq
const cMinUsd = new Decimal(2).mul(BORROW).mul(bf.toString()).div(liq);
console.log(`analytic: collateral needed for HF>=2.0 at $${BORROW} borrow = $${cMinUsd.toFixed(4)} (only a starting point; the simulation decides)\n`);
let d = tok(cMinUsd), best: Decimal | null = null;
for (let i = 0; i < 12; i++) { const r = await probe(`HF>=2.0 search #${i + 1}`, d, BORROW); if (r.valid && (r.projectedHealthFactor ?? 0) >= 2.0) { best = d; break; } d = d.add(new Decimal(10).pow(-dec).mul(Math.max(1, Math.round(Number(d.mul(0.01).mul(new Decimal(10).pow(dec))))))); }
console.log(`\n>>> smallest deposit found with sim PASS and HF>=2.0: ${best?.toFixed(dec)} ${ASSET} (~$${best?.mul(price).toFixed(3)})\n`);
console.log("--- what does Kamino reject? (borrow $0.50 against smaller collateral)");
for (const f of [0.8, 0.6, 0.4]) await probe(`collateral at ${f * 100}% of the HF2 amount`, (best ?? d).mul(f).toDecimalPlaces(dec, Decimal.ROUND_UP), BORROW);
console.log("\n--- minimum borrow / minimum deposit probes (collateral fixed at the HF2 amount unless stated)");
for (const b of [0.1, 0.01, 0.001]) await probe(`borrow only $${b}`, best ?? d, b);
for (const usd of [0.1, 0.01]) await probe(`tiny deposit ~$${usd}, borrow $${(usd * 0.3).toFixed(3)}`, tok(new Decimal(usd)), Number((usd * 0.3).toFixed(4)));
