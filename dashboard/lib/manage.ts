/** Client-side types for /api/repay, /api/withdraw, /api/close-position — mirrors src/agent/manage.ts's ManageResult. */

export type ManageAction = "repay" | "withdraw" | "close";

export interface ManageSimulation {
  ran: true;
  success: boolean;
  slot: string;
  unitsConsumed: string | null;
  failureReason: string | null;
  keyLogs: string[];
}

export interface ManageResult {
  action: ManageAction;
  valid: boolean;
  problems: string[];
  simulation: { ran: false; reason: string } | ManageSimulation;
  projectedHealthFactor: number | null;
  /** True for a "max" amount: the exact on-chain figure (incl. interest accrued since this was read) differs slightly. */
  projectedHealthFactorIsEstimate: boolean;
}

export type ManagePreviewResponse = ManageResult;
export interface ManageBuildResponse {
  transaction: string;
  lastValidBlockHeight: string;
  manage: ManageResult;
}
