/**
 * Repay and Withdraw for Vanilla Kamino obligations — the position-management counterpart to validate.ts's
 * open-a-position strategies. Scope is deliberately Vanilla only: Multiply unwind needs to reverse a flash loan
 * and a swap, not a plain repay/withdraw, and is separate work.
 *
 * Same discipline as validate.ts: build the REAL instructions with the REAL klend-sdk builders, simulate the
 * REAL transaction against live mainnet state, and only hand out a transaction to sign once that simulation has
 * actually passed. Nothing here signs or sends anything.
 */

import { createNoopSigner } from "@solana/signers";
import { address } from "@solana/kit";
import Decimal from "decimal.js";
import type { KaminoClient, WalletPosition } from "../kamino/client";
import { buildUnsignedTransaction, serializeForTransport, simulate, type SimulationResult } from "../kamino/execute";
import { isTransientNetworkError } from "../kamino/rpc-retry";

export type ManageAction = "repay" | "withdraw" | "close";

export interface ManageResult {
  action: ManageAction;
  valid: boolean;
  problems: string[];
  simulation:
    | { ran: false; reason: string }
    | {
        ran: true;
        success: boolean;
        slot: string;
        unitsConsumed: string | null;
        failureReason: string | null;
        keyLogs: string[];
      };
  /** Liquidation at 1.0, projected AFTER this action. Null if there would be no debt left (nothing to divide by). */
  projectedHealthFactor: number | null;
  /**
   * True when `amount` was "max": the real on-chain amount (debt including interest accrued since this wallet's
   * position was last read, or the exact deposited collateral) is resolved by the program at execution, not by
   * us — so the projection uses the wallet's last-read figures and can be off by a tiny amount of accrued
   * interest. False for an explicit partial amount, where the projection is exact.
   */
  projectedHealthFactorIsEstimate: boolean;
  transaction?: { base64: string; lastValidBlockHeight: string };
}

function summarizeFailure(sim: SimulationResult): string | null {
  if (sim.success) return null;
  const errorLines = (sim.logs ?? []).filter((l) => /error|failed|insufficient/i.test(l));
  const err = JSON.stringify(sim.error, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return [err, ...errorLines.slice(-4)].join(" | ");
}
function keyLogs(sim: SimulationResult): string[] {
  return (sim.logs ?? []).filter((l) => /Instruction: |Price: |Repay: |Withdraw: |error|failed|pnl:/i.test(l)).slice(0, 60);
}

/** The wallet's one real Vanilla obligation, or null. Multiply obligations are a different PDA/type and out of scope. */
function findVanilla(position: WalletPosition) {
  return position.obligations.find((o) => o.type === "Vanilla") ?? null;
}

/**
 * Projected health factor after repaying `repayUsd` of debt and/or withdrawing `withdrawUsd` of collateral from
 * the wallet's current Vanilla obligation — same liquidationLimit/adjustedDebt formula as
 * StrategyValidator.projectHealthFactor (validate.ts), run in reverse (subtracting instead of adding).
 */
function projectAfter(vanilla: NonNullable<ReturnType<typeof findVanilla>>, repayUsd: Decimal, withdrawLiqUsd: Decimal): number | null {
  const limit = new Decimal(vanilla.liquidationLimitUsd).sub(withdrawLiqUsd);
  const debt = new Decimal(vanilla.healthFactor ? new Decimal(vanilla.liquidationLimitUsd).div(vanilla.healthFactor) : 0).sub(repayUsd);
  return debt.gt(0) ? limit.div(debt).toDecimalPlaces(4).toNumber() : null;
}

export class PositionManager {
  constructor(private kamino: KaminoClient) {}

  /** `amount` is human-readable, or "max" to repay the full debt. */
  async repay(walletAddress: string, debtSymbol: string, amount: Decimal | "max", options: { includeTransaction?: boolean } = {}): Promise<ManageResult> {
    const position = await this.kamino.getPosition(walletAddress);
    const vanilla = findVanilla(position);
    const problems: string[] = [];
    if (!vanilla) problems.push("This wallet has no open Vanilla obligation to repay.");
    else if (!vanilla.borrows.some((b) => b.symbol === debtSymbol)) {
      problems.push(`This obligation has no ${debtSymbol} debt to repay. Real debt: [${vanilla.borrows.map((b) => b.symbol).join(", ") || "none"}].`);
    }
    if (amount !== "max" && !(amount.gt(0))) problems.push("amount must be > 0, or \"max\".");
    if (amount !== "max" && vanilla) {
      const held = new Decimal(position.walletBalances.find((b) => b.symbol === debtSymbol)?.amount ?? "0");
      if (amount.gt(held)) problems.push(`amount ${amount} ${debtSymbol} exceeds the wallet's real spot balance (${held}).`);
    }
    if (problems.length > 0) return { action: "repay", valid: false, problems, simulation: { ran: false, reason: problems.join("; ") }, projectedHealthFactor: null, projectedHealthFactorIsEstimate: amount === "max" };

    const debt = vanilla!.borrows.find((b) => b.symbol === debtSymbol)!;
    const reserve = this.kamino.getReserve(debtSymbol);
    const owner = createNoopSigner(address(walletAddress));
    let action;
    try {
      action = await this.kamino.buildRepayTx(owner, reserve.getLiquidityMint(), amount);
    } catch (err) {
      if (isTransientNetworkError(err)) throw err;
      return { action: "repay", valid: false, problems: [`Transaction could not be built: ${(err as Error).message}`], simulation: { ran: false, reason: `Build failed: ${(err as Error).message}` }, projectedHealthFactor: null, projectedHealthFactorIsEstimate: amount === "max" };
    }
    const repayUsd = amount === "max" ? new Decimal(debt.valueUsd) : reserve.getOracleMarketPrice().mul(amount);
    return this.simulateAndRespond("repay", action, walletAddress, { vanilla: vanilla!, repayUsd, withdrawLiqUsd: new Decimal(0), isEstimate: amount === "max" }, options);
  }

  /** `amount` is human-readable, or "max" to withdraw everything deposited for this collateral. */
  async withdraw(walletAddress: string, collateralSymbol: string, amount: Decimal | "max", options: { includeTransaction?: boolean } = {}): Promise<ManageResult> {
    const position = await this.kamino.getPosition(walletAddress);
    const vanilla = findVanilla(position);
    const problems: string[] = [];
    if (!vanilla) problems.push("This wallet has no open Vanilla obligation to withdraw from.");
    else if (!vanilla.deposits.some((d) => d.symbol === collateralSymbol)) {
      problems.push(`This obligation has no ${collateralSymbol} deposited. Real collateral: [${vanilla.deposits.map((d) => d.symbol).join(", ") || "none"}].`);
    }
    if (amount !== "max" && !(amount.gt(0))) problems.push("amount must be > 0, or \"max\".");
    if (amount !== "max" && vanilla) {
      const dep = vanilla.deposits.find((d) => d.symbol === collateralSymbol);
      if (dep && amount.gt(dep.amount)) problems.push(`amount ${amount} ${collateralSymbol} exceeds the real deposited amount (${dep.amount}).`);
    }
    if (problems.length > 0) return { action: "withdraw", valid: false, problems, simulation: { ran: false, reason: problems.join("; ") }, projectedHealthFactor: null, projectedHealthFactorIsEstimate: amount === "max" };

    const dep = vanilla!.deposits.find((d) => d.symbol === collateralSymbol)!;
    const reserve = this.kamino.getReserve(collateralSymbol);
    const owner = createNoopSigner(address(walletAddress));
    let action;
    try {
      action = await this.kamino.buildWithdrawTx(owner, reserve.getLiquidityMint(), amount);
    } catch (err) {
      if (isTransientNetworkError(err)) throw err;
      return { action: "withdraw", valid: false, problems: [`Transaction could not be built: ${(err as Error).message}`], simulation: { ran: false, reason: `Build failed: ${(err as Error).message}` }, projectedHealthFactor: null, projectedHealthFactorIsEstimate: amount === "max" };
    }
    const withdrawAmount = amount === "max" ? new Decimal(dep.amount) : amount;
    const withdrawLiqUsd = reserve.getOracleMarketPrice().mul(withdrawAmount).mul(reserve.stats.liquidationThreshold);
    return this.simulateAndRespond("withdraw", action, walletAddress, { vanilla: vanilla!, repayUsd: new Decimal(0), withdrawLiqUsd, isEstimate: amount === "max" }, options);
  }

  /** Repays the full debt and withdraws the full collateral, atomically, in one transaction. */
  async close(walletAddress: string, collateralSymbol: string, debtSymbol: string, options: { includeTransaction?: boolean } = {}): Promise<ManageResult> {
    const position = await this.kamino.getPosition(walletAddress);
    const vanilla = findVanilla(position);
    const problems: string[] = [];
    if (!vanilla) problems.push("This wallet has no open Vanilla obligation to close.");
    else {
      if (!vanilla.deposits.some((d) => d.symbol === collateralSymbol)) problems.push(`This obligation has no ${collateralSymbol} deposited.`);
      if (!vanilla.borrows.some((b) => b.symbol === debtSymbol)) problems.push(`This obligation has no ${debtSymbol} debt.`);
    }
    if (problems.length > 0) return { action: "close", valid: false, problems, simulation: { ran: false, reason: problems.join("; ") }, projectedHealthFactor: null, projectedHealthFactorIsEstimate: true };

    const collateralReserve = this.kamino.getReserve(collateralSymbol);
    const debtReserve = this.kamino.getReserve(debtSymbol);
    const owner = createNoopSigner(address(walletAddress));
    let action;
    try {
      action = await this.kamino.buildCloseVanillaPositionTx(owner, collateralReserve.getLiquidityMint(), debtReserve.getLiquidityMint());
    } catch (err) {
      if (isTransientNetworkError(err)) throw err;
      return { action: "close", valid: false, problems: [`Transaction could not be built: ${(err as Error).message}`], simulation: { ran: false, reason: `Build failed: ${(err as Error).message}` }, projectedHealthFactor: null, projectedHealthFactorIsEstimate: true };
    }
    // A full close leaves no debt and no collateral in this obligation — nothing meaningful to project, so null
    // rather than a formula result that happens to land on some number.
    return this.simulateAndRespond("close", action, walletAddress, null, options);
  }

  private async simulateAndRespond(
    actionName: ManageAction,
    action: Awaited<ReturnType<KaminoClient["buildRepayTx"]>>,
    walletAddress: string,
    projection: { vanilla: NonNullable<ReturnType<typeof findVanilla>>; repayUsd: Decimal; withdrawLiqUsd: Decimal; isEstimate: boolean } | null,
    options: { includeTransaction?: boolean }
  ): Promise<ManageResult> {
    const isEstimate = projection?.isEstimate ?? false;
    let sim: SimulationResult;
    let transaction: ManageResult["transaction"];
    try {
      const tx = await buildUnsignedTransaction(this.kamino.getRpc(), action, walletAddress);
      sim = await simulate(this.kamino.getRpc(), tx);
      if (options.includeTransaction && sim.success && "lifetimeConstraint" in tx) {
        transaction = {
          base64: serializeForTransport(tx),
          lastValidBlockHeight: String((tx.lifetimeConstraint as { lastValidBlockHeight: bigint }).lastValidBlockHeight),
        };
      }
    } catch (err) {
      if (isTransientNetworkError(err)) throw err;
      return { action: actionName, valid: false, problems: [`Simulation request rejected: ${(err as Error).message}`], simulation: { ran: false, reason: `RPC rejected the transaction: ${(err as Error).message}` }, projectedHealthFactor: null, projectedHealthFactorIsEstimate: isEstimate };
    }
    const projectedHealthFactor = projection ? projectAfter(projection.vanilla, projection.repayUsd, projection.withdrawLiqUsd) : null;
    return {
      action: actionName,
      valid: sim.success,
      problems: sim.success ? [] : [`On-chain simulation failed: ${summarizeFailure(sim)}`],
      simulation: {
        ran: true,
        success: sim.success,
        slot: sim.slot,
        unitsConsumed: sim.unitsConsumed,
        failureReason: summarizeFailure(sim),
        keyLogs: keyLogs(sim),
      },
      projectedHealthFactor,
      projectedHealthFactorIsEstimate: isEstimate,
      ...(transaction ? { transaction } : {}),
    };
  }
}

