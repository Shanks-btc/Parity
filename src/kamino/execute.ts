/**
 * Phase 2: real transaction construction, verified via simulation only.
 *
 * Deliberately stops short of signing/sending. Everything here either builds a transaction
 * (no private key involved — the "owner" is whatever TransactionSigner the caller passes in,
 * which can be a `createNoopSigner(address)` from @solana/kit when you don't have or need
 * signing capability yet) or simulates one against real mainnet state via the RPC's
 * `simulateTransaction`, which costs nothing and moves no funds.
 *
 * The transport/submit/confirm functions at the bottom never sign either: signing happens in the
 * user's wallet (browser), and submitSignedTransaction only accepts an already-signed transaction.
 * They are verified on devnet only; using them for real Kamino transactions on mainnet is a
 * deliberate later step, together with the frontend.
 */

import {
  address,
  createSolanaRpc,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  compileTransaction,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  getSignatureFromTransaction,
  assertIsFullySignedTransaction,
  type Account,
  type Base64EncodedWireTransaction,
  type Commitment,
  type Instruction,
  type Signature,
  type Transaction,
} from "@solana/kit";
import type { AddressLookupTable } from "@solana-program/address-lookup-table";
import { KaminoAction as KaminoActionClass, type KaminoAction } from "@kamino-finance/klend-sdk";

type RpcConnection = ReturnType<typeof createSolanaRpc>;

/**
 * Combines a KaminoAction's separate instruction groups in the order they must execute, via
 * the SDK's own KaminoAction.actionToIxs: compute budget → setup → lendingIxs[0] →
 * inBetweenIxs → lendingIxs[1] → … → cleanup.
 *
 * FIXED 2026-09-24 (Phase 5): this used to place inBetweenIxs *before* all lending ixs. That was
 * harmless for single-lending-ix actions (Phase 2/3 deposits), but for a two-leg action like
 * buildDepositAndBorrowTxns the in-between RefreshObligation — which already lists the new
 * deposit reserve — ran before the deposit existed and failed with InvalidAccountInput (6006).
 */
export function getInstructionsFromAction(action: KaminoAction): Instruction[] {
  return KaminoActionClass.actionToIxs(action);
}

/**
 * Attaches a recent blockhash and fee payer to a raw instruction array, returning a
 * fully-constructed but UNSIGNED transaction. Building this never requires a private key —
 * only an address for the fee payer. Optionally compresses accounts found in `lookupTables`
 * into address-lookup-table references — required for Multiply/leverage transactions, which
 * involve enough accounts (Kamino + swap route) that they can exceed the size limit without it.
 */
export async function buildUnsignedTransactionFromInstructions(
  rpc: RpcConnection,
  instructions: Instruction[],
  feePayerAddress: string,
  lookupTables: Account<AddressLookupTable>[] = []
): Promise<Transaction> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  let message = appendTransactionMessageInstructions(
    instructions,
    setTransactionMessageLifetimeUsingBlockhash(
      latestBlockhash,
      setTransactionMessageFeePayer(address(feePayerAddress), createTransactionMessage({ version: 0 }))
    )
  );

  if (lookupTables.length > 0) {
    const addressesByLookupTableAddress = Object.fromEntries(
      lookupTables.map((lut) => [lut.address, lut.data.addresses])
    );
    message = compressTransactionMessageUsingAddressLookupTables(message, addressesByLookupTableAddress) as typeof message;
  }

  return compileTransaction(message);
}

/**
 * Attaches a recent blockhash and fee payer to a KaminoAction's instructions, returning a
 * fully-constructed but UNSIGNED transaction. Thin wrapper over
 * buildUnsignedTransactionFromInstructions for the Phase 2/3 (non-leverage) call sites.
 */
export async function buildUnsignedTransaction(
  rpc: RpcConnection,
  action: KaminoAction,
  feePayerAddress: string
): Promise<Transaction> {
  return buildUnsignedTransactionFromInstructions(rpc, getInstructionsFromAction(action), feePayerAddress);
}

export interface SimulationResult {
  success: boolean;
  error: unknown | null;
  unitsConsumed: string | null;
  logs: string[] | null;
  /** The mainnet slot the RPC simulated against — proof the check ran on live state. */
  slot: string;
}

/**
 * Runs a constructed (unsigned) transaction through the RPC's simulateTransaction — a real
 * check against real on-chain state. `sigVerify: false` is what makes this work without any
 * signature at all, which is exactly what an unsigned transaction needs: Solana's simulate
 * endpoint supports skipping signature verification precisely for this "check before signing"
 * use case. Costs nothing, moves no funds, requires no private key.
 */
export async function simulate(rpc: RpcConnection, transaction: Transaction): Promise<SimulationResult> {
  const wireTransaction = getBase64EncodedWireTransaction(transaction);

  const result = await rpc
    .simulateTransaction(wireTransaction, {
      encoding: "base64",
      sigVerify: false,
      commitment: "confirmed",
    })
    .send();

  return {
    success: result.value.err === null,
    error: result.value.err,
    unitsConsumed: result.value.unitsConsumed != null ? result.value.unitsConsumed.toString() : null,
    logs: result.value.logs,
    slot: result.context.slot.toString(),
  };
}

// ---------------------------------------------------------------------------------------------
// Transport, submission and confirmation (verified mechanically on devnet only — see
// inspect-send-devnet.ts). Mainnet/Kamino use is deliberately deferred until the frontend's
// wallet-signing flow exists; nothing in this file signs anything.
// ---------------------------------------------------------------------------------------------

/**
 * Serializes an unsigned (or partially signed) transaction to base64 wire format — the same
 * bytes Solana's RPC accepts — so it can cross a network boundary to a browser wallet for signing.
 */
export function serializeForTransport(transaction: Transaction): Base64EncodedWireTransaction {
  return getBase64EncodedWireTransaction(transaction);
}

/** Inverse of serializeForTransport: decodes the (signed) base64 transaction a wallet sends back. */
export function deserializeFromTransport(base64: string): Transaction {
  return getTransactionDecoder().decode(getBase64Encoder().encode(base64));
}

/**
 * Submits an already fully-signed transaction via sendTransaction and returns its signature.
 * Throws before touching the network if any required signature is missing. Preflight
 * (a simulation by the RPC node) runs by default, so an obviously failing transaction is
 * rejected here instead of landing on-chain and paying a fee.
 */
export async function submitSignedTransaction(
  rpc: RpcConnection,
  signedTransaction: Transaction,
  options: { skipPreflight?: boolean; preflightCommitment?: Commitment } = {}
): Promise<Signature> {
  assertIsFullySignedTransaction(signedTransaction);
  const expected = getSignatureFromTransaction(signedTransaction);

  const signature = await rpc
    .sendTransaction(serializeForTransport(signedTransaction), {
      encoding: "base64",
      skipPreflight: options.skipPreflight ?? false,
      preflightCommitment: options.preflightCommitment ?? "confirmed",
    })
    .send();

  if (signature !== expected) {
    throw new Error(`RPC returned signature ${signature}, but the transaction's own signature is ${expected}.`);
  }
  return signature;
}

export type ConfirmationResult =
  | { status: "success"; signature: Signature; slot: string; confirmationStatus: Commitment }
  | { status: "failed"; signature: Signature; slot: string; error: unknown; logs: string[] | null }
  | { status: "timeout"; signature: Signature; lastSeen: Commitment | null; elapsedMs: number; blockhashExpired: boolean };

const COMMITMENT_RANK: Record<Commitment, number> = { processed: 0, confirmed: 1, finalized: 2 };

/**
 * Polls getSignatureStatuses until the transaction reaches `commitment`, fails, or times out.
 *
 * - success: landed without error and reached the requested commitment.
 * - failed: landed with an on-chain error; the error and program logs (from getTransaction) are
 *   returned, since the status alone ("InstructionError [0, Custom 1]") is rarely enough.
 * - timeout: not at the requested commitment in time. If `lastValidBlockHeight` (from the
 *   blockhash the transaction used) is given and the chain has passed it while the transaction
 *   was never seen, `blockhashExpired: true` — it can no longer land, so it is safe to rebuild.
 *   Without that, a timeout means "unknown", not "failed".
 */
export async function confirmTransaction(
  rpc: RpcConnection,
  signature: Signature,
  commitment: Commitment = "confirmed",
  options: { timeoutMs?: number; pollIntervalMs?: number; lastValidBlockHeight?: bigint } = {}
): Promise<ConfirmationResult> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const started = Date.now();
  let lastSeen: Commitment | null = null;
  let blockhashExpired = false;

  while (Date.now() - started < timeoutMs) {
    const { value } = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send();
    const status = value[0];

    if (status) {
      lastSeen = status.confirmationStatus;
      if (status.err) {
        const tx = await rpc
          .getTransaction(signature, { commitment: "confirmed", encoding: "json", maxSupportedTransactionVersion: 0 })
          .send();
        return {
          status: "failed",
          signature,
          slot: status.slot.toString(),
          error: status.err,
          logs: tx?.meta?.logMessages ? [...tx.meta.logMessages] : null,
        };
      }
      if (status.confirmationStatus && COMMITMENT_RANK[status.confirmationStatus] >= COMMITMENT_RANK[commitment]) {
        return { status: "success", signature, slot: status.slot.toString(), confirmationStatus: status.confirmationStatus };
      }
    } else if (options.lastValidBlockHeight !== undefined) {
      const height = await rpc.getBlockHeight({ commitment: "confirmed" }).send();
      if (height > options.lastValidBlockHeight) {
        blockhashExpired = true;
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { status: "timeout", signature, lastSeen, elapsedMs: Date.now() - started, blockhashExpired };
}
