/**
 * `npm run snapshot:landing`
 *
 * Measures every figure the landing page shows, live, and writes them to
 * dashboard/lib/market-snapshot.json (imported by the page, which states they are "as last
 * verified" and shows when). Rerun this to refresh them — never hand-edit the numbers.
 *
 *   - Kamino xStocks market (mainnet reads): USDC borrow/supply APY, per-asset (AAPLx, SPYx,
 *     TSLAx) LTV and liquidation threshold, live Multiply positions + average leverage per asset,
 *     live xStock reserve count.
 *   - Strategy-check compute cost: the agent's own StrategyValidator simulating three real
 *     strategies (borrow, borrow_and_earn, multiply) against mainnet for the test wallets in
 *     TESTPLAN.md — simulation only, sigVerify off, nothing signed or sent.
 *   - Real fee paid: the devnet proof transaction's fee (getTransaction), converted to USD at
 *     Pyth's live SOL/USD price.
 *   - The market table: every xStock reserve in the market — Kamino's oracle price, LTV /
 *     liquidation threshold, deposits (tokens + USD), live Multiply positions — plus each mint's
 *     own on-chain facts: issuer token name, token program, Token-2022 extensions and the
 *     scaled-UI-amount multiplier (with when it took effect).
 *
 * Fails loudly instead of writing a partial or invented snapshot.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { address, createSolanaRpc, devnet, type Signature } from "@solana/kit";
import { KaminoClient } from "../src/kamino/client.js";
import { withRpcRetry } from "../src/kamino/rpc-retry.js";
import { StrategyValidator, type StrategyInput } from "../src/agent/validate.js";

const OUT = fileURLToPath(new URL("../dashboard/lib/market-snapshot.json", import.meta.url));

const DEVNET_PROOF_SIGNATURE =
  "njdQBENCWCmY47bMTmHYyX9XxQLBAzoNMpWqrmo5K2r5iowDFucEY2vWUrPaeCDcrVqjQosYE6SfK38BtWzHsh6";
// Crypto.SOL/USD — resolved from Hermes /v2/price_feeds?query=SOL on 2026-09-24.
const PYTH_SOL_USD = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

// Representative strategies for the compute-cost range; wallets from TESTPLAN.md.
const STRATEGY_CHECKS: { name: string; wallet: string; strategy: StrategyInput }[] = [
  {
    name: "AAPLx borrow",
    wallet: "A3iPNQiG7sCAmL4dsAVr9RFmjh9EJEbh4jHprpk4DxdP",
    strategy: { strategyType: "borrow", newDepositSymbol: "AAPLx", newDepositAmount: 0.005, borrowSymbol: "USDC", borrowAmount: 0.5 },
  },
  {
    name: "AAPLx borrow + earn",
    wallet: "A3iPNQiG7sCAmL4dsAVr9RFmjh9EJEbh4jHprpk4DxdP",
    strategy: {
      strategyType: "borrow_and_earn",
      newDepositSymbol: "AAPLx",
      newDepositAmount: 0.005,
      borrowSymbol: "USDC",
      borrowAmount: 0.5,
      earnSymbol: "USDC",
      earnAmount: 0.5,
    },
  },
  {
    name: "SPYx Multiply",
    wallet: "BWEJgsSutAxMEWNXTUKSnBaWHHMpQikcHmbmFz8nqEnZ",
    strategy: { strategyType: "multiply", newDepositSymbol: "SPYx", newDepositAmount: 0.0005, targetLeverage: 1.5 },
  },
  {
    // Backs the Strategies card's claim that Multiply runs for TSLAx too (first simulated 2026-09-24).
    name: "TSLAx Multiply",
    wallet: "A3iPNQiG7sCAmL4dsAVr9RFmjh9EJEbh4jHprpk4DxdP",
    strategy: { strategyType: "multiply", newDepositSymbol: "TSLAx", newDepositAmount: 0.01, targetLeverage: 1.5 },
  },
];

async function main() {
  const { SOLANA_RPC_URL, KAMINO_MAIN_MARKET, PYTH_HERMES_URL, PYTH_API_KEY } = process.env;
  if (!SOLANA_RPC_URL || !KAMINO_MAIN_MARKET) throw new Error("Set SOLANA_RPC_URL and KAMINO_MAIN_MARKET in .env.");

  const client = new KaminoClient(SOLANA_RPC_URL, KAMINO_MAIN_MARKET);
  await client.init();
  const slot = await client.getRpc().getSlot().send();

  // ---- Market figures ----
  const usdc = client.getReserve("USDC");
  const borrowApyPct = usdc.totalBorrowAPY(slot) * 100;
  const supplyApyPct = usdc.totalSupplyAPY(slot) * 100;

  // All Multiply rows for the asset (one per debt pairing): positions summed, leverage weighted by
  // position count. Today each asset has at most one row (→USDC), but this can't undercount if not.
  const multiply = async (symbol: string) => {
    const rows = (await client.getMultiplyMetrics(symbol)).filter((m) => Number(m.totalObligations) > 0);
    const obligations = rows.reduce((n, m) => n + Number(m.totalObligations), 0);
    const avgLeverage = obligations
      ? rows.reduce((sum, m) => sum + Number(m.avgLeverage) * Number(m.totalObligations), 0) / obligations
      : null;
    return { obligations, avgLeverage, rows: rows.length };
  };
  const asset = async (symbol: string) => {
    const r = client.getReserve(symbol);
    return {
      loanToValuePct: r.stats.loanToValue * 100,
      liquidationThresholdPct: r.stats.liquidationThreshold * 100,
      multiply: await withRpcRetry(() => multiply(symbol)),
    };
  };
  const assets = { AAPLx: await asset("AAPLx"), SPYx: await asset("SPYx"), TSLAx: await asset("TSLAx") };

  const spyxMultiply = (await client.getMultiplyMetrics("SPYx")).find((m) => Number(m.totalObligations) > 0);
  if (!spyxMultiply) throw new Error("No live SPYx Multiply row — refusing to write a snapshot claiming one.");

  // ---- Market table: every xStock reserve, plus each mint's on-chain facts ----
  const rpc = client.getRpc();
  const xstocks = [];
  for (const r of client.listXStockReserves()) {
    const reserve = client.getReserve(r.symbol);
    const mintInfo: any = await withRpcRetry(() =>
      rpc.getAccountInfo(address(r.mintAddress), { encoding: "jsonParsed" }).send()
    );
    const owner = String(mintInfo.value?.owner ?? "");
    const extensions: { extension: string; state?: any }[] = mintInfo.value?.data?.parsed?.info?.extensions ?? [];
    const meta = extensions.find((e) => e.extension === "tokenMetadata")?.state;
    const scaled = extensions.find((e) => e.extension === "scaledUiAmountConfig")?.state;
    // The multiplier in force now: newMultiplier once its effective timestamp has passed.
    let uiMultiplier = null;
    if (scaled) {
      const effectiveAt = Number(scaled.newMultiplierEffectiveTimestamp);
      const switched = Date.now() / 1000 >= effectiveAt;
      uiMultiplier = {
        current: Number(switched ? scaled.newMultiplier : scaled.multiplier),
        // Timestamp 0 means the multiplier has never been changed since the mint was created.
        effectiveSince: switched && effectiveAt > 0 ? new Date(effectiveAt * 1000).toISOString() : null,
        pending: switched ? null : { multiplier: Number(scaled.newMultiplier), effectiveAt: new Date(effectiveAt * 1000).toISOString() },
      };
    }
    const m = await withRpcRetry(() => multiply(r.symbol));
    xstocks.push({
      symbol: r.symbol,
      name: meta?.name ?? null,
      mint: r.mintAddress,
      tokenProgram:
        owner === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" ? "Token-2022" : owner === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" ? "SPL Token" : owner,
      extensions: extensions.map((e) => e.extension),
      uiMultiplier,
      priceUsd: Number(reserve.getOracleMarketPrice()),
      loanToValuePct: reserve.stats.loanToValue * 100,
      liquidationThresholdPct: reserve.stats.liquidationThreshold * 100,
      depositedTokens: Number(reserve.getTotalSupply().div(reserve.getMintFactor())),
      depositedUsd: Number(reserve.getDepositTvl()),
      multiply: m,
    });
    console.log(`${r.symbol}: ${meta?.name} · $${Number(reserve.getOracleMarketPrice()).toFixed(2)} · deposits $${Number(reserve.getDepositTvl()).toFixed(0)} · multiplier ${uiMultiplier?.current} · multiply ${m.obligations}`);
  }

  // ---- Strategy-check compute cost (real mainnet simulations) ----
  const validator = new StrategyValidator(client);
  const checks = [];
  for (const c of STRATEGY_CHECKS) {
    const r = await withRpcRetry(() => validator.validate(c.wallet, c.strategy));
    if (!r.simulation.ran || !r.valid || !r.simulation.unitsConsumed) {
      throw new Error(`${c.name} did not simulate successfully (${r.problems.join("; ")}) — not writing a CU range from it.`);
    }
    checks.push({ name: c.name, unitsConsumed: Number(r.simulation.unitsConsumed), slot: r.simulation.slot });
    console.log(`${c.name}: ${r.simulation.unitsConsumed} CU at slot ${r.simulation.slot}`);
  }
  const cus = checks.map((c) => c.unitsConsumed);

  // ---- Real fee paid (devnet proof tx) + USD at Pyth's live SOL price ----
  const devnetRpc = createSolanaRpc(devnet("https://api.devnet.solana.com"));
  const tx = await withRpcRetry(() =>
    devnetRpc.getTransaction(DEVNET_PROOF_SIGNATURE as Signature, { encoding: "json", maxSupportedTransactionVersion: 0 }).send()
  );
  if (!tx?.meta || tx.meta.err !== null) throw new Error("Devnet proof transaction not found or failed.");
  const feeLamports = Number(tx.meta.fee);

  const hermes = PYTH_HERMES_URL ?? "https://hermes.pyth.network";
  const res = await withRpcRetry(() =>
    fetch(`${hermes}/v2/updates/price/latest?ids[]=${PYTH_SOL_USD}`, {
      headers: PYTH_API_KEY ? { Authorization: `Bearer ${PYTH_API_KEY}` } : undefined,
    })
  );
  if (!res.ok) throw new Error(`Pyth SOL/USD request failed (${res.status}).`);
  const p = ((await res.json()) as any).parsed[0].price;
  const solUsd = Number(p.price) * 10 ** p.expo;

  const snapshot = {
    checkedAt: new Date().toISOString(),
    slot: slot.toString(),
    market: KAMINO_MAIN_MARKET,
    usdc: {
      borrowApyPct,
      supplyApyPct,
      // What a borrow-USDC-then-supply-it loop earns per year, before fees: supply − borrow.
      netCarryPct: supplyApyPct - borrowApyPct,
    },
    assets,
    spyxMultiply: {
      obligations: Number(spyxMultiply.totalObligations),
      avgLeverage: Number(spyxMultiply.avgLeverage),
      kaminoUpdatedOn: spyxMultiply.updatedOn,
    },
    xstocks,
    solana: {
      xStockReservesLive: client.listXStockReserves().length,
      strategyChecks: checks,
      computeUnitsMin: Math.min(...cus),
      computeUnitsMax: Math.max(...cus),
      proofFeeLamports: feeLamports,
      solUsd,
      proofFeeUsd: (feeLamports / 1e9) * solUsd,
    },
  };

  writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`Wrote ${OUT}\n${JSON.stringify(snapshot, null, 2)}`);
}

main().catch((err) => {
  console.error("Snapshot failed:", err);
  process.exit(1);
});
