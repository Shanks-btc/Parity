/** Shared helpers for the READ-ONLY preflight. Nothing here signs or sends. */
import "dotenv/config";
import crypto from "node:crypto";
import { address, type Address, type Instruction } from "@solana/kit";
import { createNoopSigner } from "@solana/signers";
import Decimal from "decimal.js";
import { KaminoClient } from "../src/kamino/client";
import { withRpcRetry } from "../src/kamino/rpc-retry";
import { StrategyValidator, type StrategyInput, type ValidationResult } from "../src/agent/validate";

export const USER = "BEDkFDUCGmzCrXgNmqrSEiF5vSnEARAhMPw83jMMKkyx";
// Fresh-shaped real wallets (no obligation, no user metadata, plenty of SOL) used ONLY as read-only simulation subjects.
export const SUBJECT: Record<string, string> = { SPYx: "9A9dUreQvTNoqNrqQC2DN1onfZWBtCBsTiuA6oGXZwc6", TSLAx: "92GYvf31937niBKJfeV6MHMCaMonVQS1Kv1ULZW2PBhr", AAPLx: "C68a6RCGLiPskbPYtAcsCjhG8tfTWYcoB4JjCrXFdqyo" };
export const PROG = {
  system: "11111111111111111111111111111111", token: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", token22: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  ata: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", computeBudget: "ComputeBudget111111111111111111111111111111", alt: "AddressLookupTab1e1111111111111111111111111",
  klend: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
};
const KLEND_NAMES = ["init_user_metadata", "init_obligation", "init_obligation_farms_for_reserve", "refresh_reserve", "refresh_obligation", "refresh_obligation_farms_for_reserve", "deposit_reserve_liquidity_and_obligation_collateral", "deposit_reserve_liquidity_and_obligation_collateral_v2", "borrow_obligation_liquidity", "borrow_obligation_liquidity_v2", "flash_borrow_reserve_liquidity", "flash_repay_reserve_liquidity", "request_elevation_group", "deposit_reserve_liquidity", "repay_obligation_liquidity", "withdraw_obligation_collateral", "init_referrer_token_state", "init_user_metadata_lookup_table"];
const disc = (n: string) => crypto.createHash("sha256").update("global:" + n).digest().subarray(0, 8).toString("hex");
const KLEND_BY_DISC = new Map(KLEND_NAMES.map((n) => [disc(n), n]));
export const progLabel = (p: string) => (Object.entries(PROG).find(([, v]) => v === p)?.[0] ?? p.slice(0, 8) + "…");

export function describeIx(ix: Instruction) {
  const p = String(ix.programAddress); const d = Buffer.from(ix.data ?? new Uint8Array());
  let name = "";
  if (p === PROG.klend) name = KLEND_BY_DISC.get(d.subarray(0, 8).toString("hex")) ?? `unknown(${d.subarray(0, 8).toString("hex")})`;
  else if (p === PROG.ata) name = d.length === 0 || d[0] === 0 ? "create_ata" : d[0] === 1 ? "create_ata_idempotent" : `ata_${d[0]}`;
  else if (p === PROG.computeBudget) name = d[0] === 2 ? `setComputeUnitLimit(${d.readUInt32LE(1)})` : d[0] === 3 ? `setComputeUnitPrice(${d.readBigUInt64LE(1)} µlamports/CU)` : d[0] === 1 ? "requestHeapFrame" : `cb_${d[0]}`;
  else if (p === PROG.system) name = d.readUInt32LE(0) === 0 ? `createAccount(lamports=${d.readBigUInt64LE(4)}, space=${d.readBigUInt64LE(12)})` : d.readUInt32LE(0) === 2 ? `transfer(${d.readBigUInt64LE(4)} lamports)` : `system_${d.readUInt32LE(0)}`;
  else if (p === PROG.token || p === PROG.token22) name = `token_ix_${d[0]}`;
  else if (p === PROG.alt) name = `alt_ix_${d.readUInt32LE(0)}`;
  else name = "(program-specific)";
  return { program: progLabel(p), programAddress: p, name, accounts: (ix.accounts ?? []).length, data: d };
}

export async function boot() {
  const client = new KaminoClient(process.env.SOLANA_RPC_URL!, process.env.KAMINO_MAIN_MARKET!);
  await withRpcRetry(() => client.init(), 3, 2000);
  return { client, validator: new StrategyValidator(client), rpc: client.getRpc() };
}
export { address, createNoopSigner, Decimal, withRpcRetry };
export type { Address, Instruction, StrategyInput, ValidationResult };
