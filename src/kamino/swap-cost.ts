/**
 * Simulates a built (unsigned) swap transaction AND measures what it costs in SOL, from the transaction itself:
 *
 *   network fee   getFeeForMessage on the exact message (5,000 lamports per signature)
 *   priority fee  read from the transaction's own compute-budget instructions:
 *                 ceil(compute-unit limit × price in µlamports per CU / 1e6). Solana charges it on the REQUESTED
 *                 limit, and simulateTransaction does not charge it, so it is computed, not simulated.
 *   token-account rent  every writable, non-signer account the message references that does not exist on chain yet is
 *                 requested in the simulation's `accounts` option. Accounts that still exist after the run were
 *                 created and are kept (the rent stays locked in them: the destination token account); accounts that
 *                 are gone again were temporary (the wrapped-SOL account of a SOL swap, closed by the same tx, so the
 *                 rent is returned and is not a cost).
 *
 * Nothing here signs or sends anything.
 */
import {
  address,
  createSolanaRpc,
  getBase64EncodedWireTransaction,
  getAddressDecoder,
  getCompiledTransactionMessageDecoder,
  decompileTransactionMessageFetchingLookupTables,
} from "@solana/kit";
import { deserializeFromTransport } from "./execute";

type RpcConnection = ReturnType<typeof createSolanaRpc>;

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const ROLE_WRITABLE = 1;
const ROLE_SIGNER = 2;

export interface SwapSimulation {
  success: boolean;
  slot: string;
  unitsConsumed: string | null;
  failureReason: string | null;
  keyLogs: string[];
  costs: {
    networkFeeLamports: number;
    priorityFeeLamports: number;
    /** Rent locked in the DESTINATION token account (holds the output mint), when this transaction creates it. 0 when it exists. */
    tokenAccountRentLamports: number;
    /** True when the destination token account did not exist and the transaction creates it. */
    createsTokenAccount: boolean;
    /**
     * Rent locked in any OTHER account the route creates and leaves open (e.g. a USDC account used as the
     * intermediate hop of a SOL route). Recoverable by closing that account, but it must be paid up front.
     */
    otherKeptRentLamports: number;
    /** Base network fee + priority fee, exactly as getFeeForMessage reports it. */
    totalFeeLamports: number;
    /** Accounts created and closed inside the same transaction (rent refunded), for information. */
    temporaryAccounts: number;
    computeUnitLimit: number;
    computeUnitPriceMicroLamports: number;
  };
}

const bigintSafe = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

export async function simulateSwapWithCosts(rpc: RpcConnection, transactionBase64: string, outputMint: string): Promise<SwapSimulation> {
  const tx = deserializeFromTransport(transactionBase64);
  const compiled = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  const message = await decompileTransactionMessageFetchingLookupTables(compiled, rpc);

  // Compute budget: setComputeUnitLimit = [2, u32 LE], setComputeUnitPrice = [3, u64 LE].
  let limit = 200_000 * message.instructions.length; // only used if the tx set no limit itself (Jupiter always does)
  let price = BigInt(0);
  let explicitLimit = false;
  for (const ix of message.instructions) {
    if (String(ix.programAddress) !== COMPUTE_BUDGET || !ix.data) continue;
    const d = Buffer.from(ix.data);
    if (d[0] === 2 && d.length >= 5) {
      limit = d.readUInt32LE(1);
      explicitLimit = true;
    } else if (d[0] === 3 && d.length >= 9) price = d.readBigUInt64LE(1);
  }
  const priorityFeeLamports = Number((BigInt(explicitLimit ? limit : 0) * price + BigInt(999_999)) / BigInt(1_000_000));

  // Candidate created accounts: writable, non-signer, referenced by an instruction, and not on chain yet.
  const writable = new Set<string>();
  for (const ix of message.instructions) {
    for (const a of ix.accounts ?? []) {
      const role = Number(a.role);
      if (role & ROLE_WRITABLE && !(role & ROLE_SIGNER)) writable.add(String(a.address));
    }
  }
  const candidates = [...writable];
  const before = candidates.length ? (await rpc.getMultipleAccounts(candidates.map((a) => address(a)), { encoding: "base64" }).send()).value : [];
  const missing = candidates.filter((_, i) => !before[i]);

  const wire = getBase64EncodedWireTransaction(tx);
  const sim = await rpc
    .simulateTransaction(wire, {
      encoding: "base64",
      sigVerify: false,
      commitment: "confirmed",
      accounts: { addresses: missing.map((a) => address(a)), encoding: "base64" },
    })
    .send();

  const fee = await rpc.getFeeForMessage(Buffer.from(tx.messageBytes).toString("base64") as Parameters<ReturnType<typeof createSolanaRpc>["getFeeForMessage"]>[0], { commitment: "confirmed" }).send();

  const post = (sim.value.accounts ?? []) as Array<{ lamports: bigint; data: [string, string] } | null>;
  let destRent = 0;
  let otherRent = 0;
  let temporary = 0;
  for (let i = 0; i < missing.length; i++) {
    const a = post[i];
    if (a && Number(a.lamports) > 0) {
      // A token account's data starts with its mint (bytes 0..32): that is how the destination is told apart.
      const mint = getAddressDecoder().decode(Buffer.from(a.data[0], "base64").subarray(0, 32));
      if (mint === outputMint) destRent += Number(a.lamports);
      else otherRent += Number(a.lamports);
    } else temporary++;
  }
  // getFeeForMessage returns base fee + priority fee together (verified: 5,003 = 5,000 + 3).
  const totalFee = Number(fee.value ?? 5000);

  const err = sim.value.err;
  return {
    success: err === null,
    slot: sim.context.slot.toString(),
    unitsConsumed: sim.value.unitsConsumed != null ? sim.value.unitsConsumed.toString() : null,
    failureReason: err === null ? null : bigintSafe(err),
    keyLogs: (sim.value.logs ?? []).filter((l) => /error|failed|insufficient/i.test(l)).slice(-4),
    costs: {
      networkFeeLamports: totalFee - priorityFeeLamports,
      priorityFeeLamports,
      tokenAccountRentLamports: destRent,
      createsTokenAccount: destRent > 0,
      otherKeptRentLamports: otherRent,
      totalFeeLamports: totalFee,
      temporaryAccounts: temporary,
      computeUnitLimit: explicitLimit ? limit : 0,
      computeUnitPriceMicroLamports: Number(price),
    },
  };
}
