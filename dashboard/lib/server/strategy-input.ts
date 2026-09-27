import type { StrategyInput } from "../../../src/agent/validate";
import { HttpError } from "./parity";

const TYPES = ["borrow", "borrow_and_earn", "earn", "multiply"] as const;
const SYMBOL = /^[A-Za-z0-9.]{1,12}$/;

/** Copies only the known StrategyInput fields out of an untrusted request body. */
export function parseStrategy(raw: unknown): StrategyInput {
  const s = (raw ?? {}) as Record<string, unknown>;
  if (!TYPES.includes(s.strategyType as (typeof TYPES)[number])) throw new HttpError(400, `strategyType must be one of ${TYPES.join(", ")}.`);
  const out: Record<string, unknown> = { strategyType: s.strategyType };
  for (const k of ["existingCollateralSymbol", "newDepositSymbol", "borrowSymbol", "earnSymbol"] as const) {
    if (s[k] === undefined) continue;
    if (typeof s[k] !== "string" || !SYMBOL.test(s[k] as string)) throw new HttpError(400, `${k} must be a reserve symbol.`);
    out[k] = s[k];
  }
  for (const k of ["newDepositAmount", "borrowAmount", "earnAmount", "targetLeverage"] as const) {
    if (s[k] === undefined) continue;
    if (typeof s[k] !== "number" || !Number.isFinite(s[k]) || (s[k] as number) <= 0) throw new HttpError(400, `${k} must be a positive number.`);
    out[k] = s[k];
  }
  return out as unknown as StrategyInput;
}
