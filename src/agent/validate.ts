/**
 * validate_strategy: runs a proposed strategy through the real Phase 2–4 transaction builders
 * and simulates it against live mainnet state (simulateTransaction, sigVerify: false). Nothing
 * is signed or sent — the owner is a no-op signer.
 *
 * Every leg of a strategy is compiled into ONE transaction and simulated atomically, because
 * the legs depend on each other: a borrow needs the deposit before it, and an earn leg funded
 * by borrowed USDC needs the borrow before it. Simulating legs separately against current
 * state would fail (or, worse, pass) for the wrong reasons.
 */

import { address, type Instruction } from "@solana/kit";
import { createNoopSigner } from "@solana/signers";
import Decimal from "decimal.js";
import { KaminoAction as KaminoActionClass, KaminoObligation, type KaminoAction } from "@kamino-finance/klend-sdk";
import type { KaminoClient, WalletPosition } from "../kamino/client";
import { buildUnsignedTransactionFromInstructions, serializeForTransport, simulate, type SimulationResult } from "../kamino/execute";
import { isTransientNetworkError } from "../kamino/rpc-retry";

export type StrategyType = "borrow" | "borrow_and_earn" | "earn" | "multiply";

/** The economic content of a strategy — shared by validate_strategy and propose_strategy. */
export interface StrategyInput {
  strategyType: StrategyType;
  existingCollateralSymbol?: string;
  newDepositSymbol?: string;
  newDepositAmount?: number;
  borrowSymbol?: string;
  borrowAmount?: number;
  earnSymbol?: string;
  earnAmount?: number;
  targetLeverage?: number;
}

export interface ValidationResult {
  validationId: string;
  valid: boolean;
  strategy: StrategyInput;
  /** Problems found before any transaction was built (bad fields, unsupported capability, false claims). */
  problems: string[];
  simulation:
    | { ran: false; reason: string }
    | {
        ran: true;
        success: boolean;
        slot: string;
        unitsConsumed: string | null;
        instructionCount: number;
        failureReason: string | null;
        keyLogs: string[];
      };
  /** Liquidation at 1.0. Computed from live reserve prices + the wallet's real obligation. */
  projectedHealthFactor: number | null;
  walletFacts: {
    depositedSymbols: string[];
    walletBalances: WalletPosition["walletBalances"];
  };
  /**
   * The exact unsigned transaction that was simulated (base64 wire format), only when requested via
   * `validate(..., { includeTransaction: true })` AND the simulation succeeded. A wallet signs this one,
   * so what the user is shown and what they sign cannot differ.
   */
  transaction?: { base64: string; lastValidBlockHeight: string };
}

const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
const COMPUTE_UNIT_LIMIT = 1_400_000;

function setComputeUnitLimitIx(units: number): Instruction {
  const data = new Uint8Array(5);
  data[0] = 2; // SetComputeUnitLimit
  new DataView(data.buffer).setUint32(1, units, true);
  return { programAddress: address(COMPUTE_BUDGET_PROGRAM), accounts: [], data };
}

const ixKey = (ix: Instruction) =>
  [
    ix.programAddress,
    Buffer.from(ix.data ?? new Uint8Array()).toString("hex"),
    (ix.accounts ?? []).map((a) => `${a.address}:${a.role}`).join(","),
  ].join("|");

/**
 * Concatenates several KaminoActions into one transaction. Each action carries its own
 * compute-budget ix (the runtime rejects duplicates), so those are replaced by a single limit.
 * A later action's *setup* ixs (ATA creation, InitObligation/InitUserMetadata for a wallet with
 * no obligation yet) are dropped when byte-identical to an earlier action's setup — they would
 * fail as already-initialized. Nothing else is de-duplicated: an action legitimately repeats
 * identical RefreshReserve ixs (VERIFIED LIVE 2026-09-24: de-duplicating those broke
 * RefreshObligation with InvalidAccountInput, 6006).
 */
function mergeActions(actions: KaminoAction[]): Instruction[] {
  const earlierSetup = new Set<string>();
  const merged: Instruction[] = [setComputeUnitLimitIx(COMPUTE_UNIT_LIMIT)];
  for (const action of actions) {
    const setup = action.setupIxs.filter((ix) => !earlierSetup.has(ixKey(ix)));
    action.setupIxs.forEach((ix) => earlierSetup.add(ixKey(ix)));
    // actionToLendingIxs interleaves inBetweenIxs between lending ixs, as the SDK intends.
    for (const ix of [...setup, ...KaminoActionClass.actionToLendingIxs(action), ...action.cleanupIxs]) {
      if (String(ix.programAddress) !== COMPUTE_BUDGET_PROGRAM) merged.push(ix);
    }
  }
  return merged;
}

/** Normalized economic fields — a proposal must match a successful validation on exactly these. */
export function strategyFingerprint(s: StrategyInput): string {
  const num = (n: number | undefined) => (n === undefined || n === null ? null : new Decimal(n).toString());
  return JSON.stringify({
    strategyType: s.strategyType,
    existingCollateralSymbol: s.existingCollateralSymbol ?? null,
    newDepositSymbol: s.newDepositSymbol ?? null,
    newDepositAmount: num(s.newDepositAmount),
    borrowSymbol: s.borrowSymbol ?? null,
    borrowAmount: num(s.borrowAmount),
    earnSymbol: s.earnSymbol ?? null,
    earnAmount: num(s.earnAmount),
    targetLeverage: num(s.targetLeverage),
  });
}

function summarizeFailure(sim: SimulationResult): string | null {
  if (sim.success) return null;
  const errorLines = (sim.logs ?? []).filter((l) => /error|failed|insufficient/i.test(l));
  const err = JSON.stringify(sim.error, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return [err, ...errorLines.slice(-4)].join(" | ");
}

function keyLogs(sim: SimulationResult): string[] {
  return (sim.logs ?? [])
    .filter((l) => /Instruction: |Price: |Deposit: |Borrow: |error|failed|pnl:/i.test(l))
    .slice(0, 60);
}

export class StrategyValidator {
  private counter = 0;
  /**
   * Per-wallet getPosition() reuse, scoped to this class only — /api/position (Portfolio) and the agent's own
   * get_position tool still call KaminoClient.getPosition() directly and are always live, untouched by this.
   * VERIFIED 2026-10-02: a single getPosition() round-trip against the shared public RPC measured anywhere from
   * 0.3s to 14s, and the UI re-validates on every debounced keystroke while someone edits a Borrow/Multiply amount —
   * refetching the SAME wallet's balance several times within one typing burst added seconds for no reason, since
   * the balance cannot have changed between two edits a few seconds apart.
   */
  private positionCache = new Map<string, { position: WalletPosition; at: number }>();
  private static readonly POSITION_TTL_MS = 5_000;

  constructor(private kamino: KaminoClient) {}

  private async getPositionForValidation(walletAddress: string): Promise<WalletPosition> {
    const cached = this.positionCache.get(walletAddress);
    if (cached && Date.now() - cached.at < StrategyValidator.POSITION_TTL_MS) return cached.position;
    const position = await this.kamino.getPosition(walletAddress);
    this.positionCache.set(walletAddress, { position, at: Date.now() });
    return position;
  }

  async validate(
    walletAddress: string,
    strategy: StrategyInput,
    options: { includeTransaction?: boolean } = {}
  ): Promise<ValidationResult> {
    const validationId = `val-${Date.now().toString(36)}-${++this.counter}`;
    const position = await this.getPositionForValidation(walletAddress);

    const base = {
      validationId,
      strategy,
      walletFacts: { depositedSymbols: position.depositedSymbols, walletBalances: position.walletBalances },
    };
    const reject = (problems: string[]): ValidationResult => ({
      ...base,
      valid: false,
      problems,
      simulation: { ran: false, reason: "Rejected before building: " + problems.join("; ") },
      projectedHealthFactor: null,
    });

    const problems = await this.checkStructure(strategy, position);
    if (problems.length > 0) return reject(problems);

    // ---- Build every leg with the real Phase 2–4 builders ----
    let ixs: Instruction[];
    let lookupTables;
    try {
      ({ ixs, lookupTables } = await this.buildInstructions(walletAddress, strategy));
    } catch (err) {
      if (isTransientNetworkError(err)) throw err; // not a verdict on the strategy — let the caller retry
      return {
        ...base,
        valid: false,
        problems: [`Transaction could not be built: ${(err as Error).message}`],
        simulation: { ran: false, reason: `Build failed: ${(err as Error).message}` },
        projectedHealthFactor: null,
      };
    }

    // ---- Simulate the whole strategy atomically against live mainnet state ----
    let sim: SimulationResult;
    let transaction: ValidationResult["transaction"];
    try {
      const tx = await buildUnsignedTransactionFromInstructions(this.kamino.getRpc(), ixs, walletAddress, lookupTables);
      sim = await simulate(this.kamino.getRpc(), tx);
      if (options.includeTransaction && sim.success && "lifetimeConstraint" in tx) {
        transaction = {
          base64: serializeForTransport(tx),
          lastValidBlockHeight: String((tx.lifetimeConstraint as { lastValidBlockHeight: bigint }).lastValidBlockHeight),
        };
      }
    } catch (err) {
      if (isTransientNetworkError(err)) throw err;
      // e.g. the compiled transaction exceeds Solana's size limit — the RPC rejects it outright.
      return {
        ...base,
        valid: false,
        problems: [`Simulation request rejected: ${(err as Error).message}`],
        simulation: { ran: false, reason: `RPC rejected the transaction: ${(err as Error).message}` },
        projectedHealthFactor: null,
      };
    }

    const projectedHealthFactor = this.projectHealthFactor(strategy, position);
    return {
      ...base,
      valid: sim.success,
      problems: sim.success ? [] : [`On-chain simulation failed: ${summarizeFailure(sim)}`],
      simulation: {
        ran: true,
        success: sim.success,
        slot: sim.slot,
        unitsConsumed: sim.unitsConsumed,
        instructionCount: ixs.length,
        failureReason: summarizeFailure(sim),
        keyLogs: keyLogs(sim),
      },
      projectedHealthFactor,
      ...(transaction ? { transaction } : {}),
    };
  }

  /**
   * Compiles every leg of a (structurally valid) strategy into one ordered instruction list plus the
   * lookup tables it needs. Shared by validate() and by the dashboard's build-transaction route, so the
   * transaction a wallet is asked to sign is built by exactly the code that was simulated.
   */
  private async buildInstructions(walletAddress: string, strategy: StrategyInput) {
    const owner = createNoopSigner(address(walletAddress));
    if (strategy.strategyType === "multiply") {
      return this.kamino.buildMultiplyDepositTx(
        owner,
        strategy.newDepositSymbol!,
        new Decimal(strategy.newDepositAmount!),
        new Decimal(strategy.targetLeverage!)
      );
    }
    const actions: KaminoAction[] = [];
    if (strategy.strategyType !== "earn") {
      const borrowMint = this.kamino.getReserve(strategy.borrowSymbol!).getLiquidityMint();
      const action = strategy.newDepositSymbol
        ? await this.kamino.buildDepositAndBorrowTx(
            owner,
            this.kamino.getReserve(strategy.newDepositSymbol).getLiquidityMint(),
            new Decimal(strategy.newDepositAmount!),
            borrowMint,
            new Decimal(strategy.borrowAmount!)
          )
        : await this.kamino.buildBorrowTx(owner, borrowMint, new Decimal(strategy.borrowAmount!));
      actions.push(action);
    }
    if (strategy.strategyType === "earn" || strategy.strategyType === "borrow_and_earn") {
      const earnMint = this.kamino.getReserve(strategy.earnSymbol!).getLiquidityMint();
      actions.push(await this.kamino.buildSupplyTx(owner, earnMint, new Decimal(strategy.earnAmount!)));
    }
    const marketLut = await this.kamino.getMarketLookupTable();
    return { ixs: mergeActions(actions), lookupTables: marketLut ? [marketLut] : [] };
  }

  /** Field/capability/claim checks. These catch nonsense cheaply; the simulation is the real test. */
  private async checkStructure(s: StrategyInput, position: WalletPosition): Promise<string[]> {
    const problems: string[] = [];
    const positive = (n: number | undefined) => typeof n === "number" && n > 0;
    const listed = (sym: string | undefined) => {
      if (!sym) return false;
      try {
        this.kamino.getReserve(sym);
        return true;
      } catch {
        problems.push(`"${sym}" is not a reserve in this market.`);
        return false;
      }
    };

    if (s.newDepositSymbol !== undefined && !positive(s.newDepositAmount)) {
      problems.push("newDepositAmount must be > 0 when newDepositSymbol is set (omit both for no new deposit).");
    }
    if (s.newDepositSymbol && listed(s.newDepositSymbol) && positive(s.newDepositAmount)) {
      const held = position.walletBalances.find((b) => b.symbol === s.newDepositSymbol)?.amount ?? "0";
      if (new Decimal(s.newDepositAmount!).gt(held)) {
        problems.push(
          `newDepositAmount ${s.newDepositAmount} ${s.newDepositSymbol} exceeds the wallet's depositable spot balance ` +
            `(${held}, raw-unit based — not the scaled wallet display amount).`
        );
      }
    }

    // The Phase 3 mislabel: a claim about existing collateral must match real per-reserve data.
    if (s.existingCollateralSymbol) {
      const vanillaDeposits = position.obligations
        .filter((o) => o.type === "Vanilla")
        .flatMap((o) => o.deposits.map((d) => d.symbol));
      if (!vanillaDeposits.includes(s.existingCollateralSymbol)) {
        problems.push(
          `existingCollateralSymbol "${s.existingCollateralSymbol}" is not deposited in this wallet's Vanilla ` +
            `obligation. Real deposits: [${vanillaDeposits.join(", ") || "none"}].`
        );
      }
    }

    switch (s.strategyType) {
      case "borrow":
      case "borrow_and_earn": {
        if (!s.borrowSymbol || !positive(s.borrowAmount)) problems.push("borrowSymbol and borrowAmount > 0 are required.");
        else listed(s.borrowSymbol);
        if (!s.newDepositSymbol && !s.existingCollateralSymbol) {
          problems.push("A borrow needs collateral: set newDepositSymbol/newDepositAmount or existingCollateralSymbol.");
        }
        const collateral = s.newDepositSymbol ?? s.existingCollateralSymbol;
        if (collateral && problems.length === 0) {
          const caps = await this.kamino.getAssetCapabilities(collateral);
          if (!caps.borrow.supported) problems.push(`${collateral} does not support Borrow: ${caps.borrow.reason}`);
        }
        if (s.strategyType === "borrow_and_earn") {
          if (!s.earnSymbol || !positive(s.earnAmount)) problems.push("earnSymbol and earnAmount > 0 are required.");
          else if (s.earnSymbol !== s.borrowSymbol) problems.push("earnSymbol must be the borrowed asset.");
          else if (s.borrowAmount !== undefined && s.earnAmount! > s.borrowAmount) {
            problems.push("earnAmount cannot exceed borrowAmount.");
          }
        }
        if (s.targetLeverage !== undefined) problems.push("targetLeverage only applies to multiply.");
        break;
      }
      case "earn":
        if (!s.earnSymbol || !positive(s.earnAmount)) problems.push("earnSymbol and earnAmount > 0 are required.");
        else listed(s.earnSymbol);
        if (s.borrowSymbol || s.newDepositSymbol) problems.push("An earn-only strategy has no deposit-as-collateral or borrow legs.");
        break;
      case "multiply": {
        if (!s.newDepositSymbol || !positive(s.newDepositAmount)) {
          problems.push("multiply needs newDepositSymbol and newDepositAmount > 0 (the collateral to lever).");
        }
        if (!(typeof s.targetLeverage === "number" && s.targetLeverage > 1)) problems.push("targetLeverage must be > 1.");
        if (s.borrowSymbol || s.borrowAmount || s.earnSymbol || s.earnAmount) {
          problems.push("multiply sizes its own borrow — omit borrow/earn fields.");
        }
        if (s.newDepositSymbol && problems.length === 0) {
          const caps = await this.kamino.getAssetCapabilities(s.newDepositSymbol);
          if (!caps.multiply.supported) {
            problems.push(`${s.newDepositSymbol} does not support Multiply: ${caps.multiply.reason}`);
          }
        }
        break;
      }
      default:
        problems.push(`Unknown strategyType "${(s as StrategyInput).strategyType}".`);
    }
    return problems;
  }

  /**
   * Liquidation-limit / borrow-factor-adjusted debt after the strategy, using live oracle prices
   * and the wallet's real Vanilla obligation as the starting point. The earn leg is a plain
   * supply (not collateral) so it doesn't change this.
   */
  private projectHealthFactor(s: StrategyInput, position: WalletPosition): number | null {
    if (s.strategyType === "earn") {
      const vanilla = position.obligations.find((o) => o.type === "Vanilla");
      return vanilla?.healthFactor ? Number(vanilla.healthFactor) : null;
    }

    const startFrom = (o: WalletPosition["obligations"][number] | undefined) => {
      const limit = new Decimal(o?.liquidationLimitUsd ?? 0);
      return { limit, debt: o?.healthFactor ? limit.div(o.healthFactor) : new Decimal(0) };
    };

    if (s.strategyType === "multiply") {
      // A Multiply deposit adds to the wallet's existing Multiply obligation for this collateral
      // (same PDA) if there is one. New leg: collateral = L × deposit, debt = (L − 1) × deposit.
      const existing = position.obligations.find(
        (o) => o.type === "Multiply" && o.deposits.some((d) => d.symbol === s.newDepositSymbol)
      );
      let { limit, debt } = startFrom(existing);
      const reserve = this.kamino.getReserve(s.newDepositSymbol!);
      const depositUsd = reserve.getOracleMarketPrice().mul(s.newDepositAmount!);
      const L = new Decimal(s.targetLeverage!);
      limit = limit.add(depositUsd.mul(L).mul(reserve.stats.liquidationThreshold));
      debt = debt.add(depositUsd.mul(L.sub(1)));
      return debt.gt(0) ? limit.div(debt).toDecimalPlaces(4).toNumber() : null;
    }

    const vanilla = position.obligations.find((o) => o.type === "Vanilla");
    let { limit: liquidationLimit, debt: adjustedDebt } = startFrom(vanilla);

    if (s.newDepositSymbol) {
      const dep = this.kamino.getReserve(s.newDepositSymbol);
      liquidationLimit = liquidationLimit.add(
        dep.getOracleMarketPrice().mul(s.newDepositAmount!).mul(dep.stats.liquidationThreshold)
      );
    }
    const debt = this.kamino.getReserve(s.borrowSymbol!);
    adjustedDebt = adjustedDebt.add(
      debt.getOracleMarketPrice().mul(s.borrowAmount!).mul(KaminoObligation.getBorrowFactorForReserve(debt, 0))
    );
    return adjustedDebt.gt(0) ? liquidationLimit.div(adjustedDebt).toDecimalPlaces(4).toNumber() : null;
  }
}
