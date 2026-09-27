/**
 * `npm run check:send-devnet`
 *
 * Mechanical end-to-end check of the send/confirm layer in execute.ts — on DEVNET ONLY, with a
 * throwaway keypair and free devnet SOL. No mainnet, no Kamino, no real funds.
 *
 * Funding: the public devnet faucet (requestAirdrop) allows ONE airdrop per IP per day —
 * VERIFIED 2026-09-24 (x-ratelimit-airdrop-limit: 1, retry-after: 86400). So the keypair can
 * optionally persist: set DEVNET_THROWAWAY_KEYPAIR to a file path (keep it OUTSIDE the repo).
 * If the file doesn't exist it is created; fund the printed address once at
 * https://faucet.solana.com (devnet) and rerun. Without the env var, a fresh in-memory keypair
 * is generated and funded by requestAirdrop, as before. Devnet SOL has no value.
 *
 * Mirrors the real flow the frontend will use: build unsigned → serializeForTransport →
 * (wallet boundary: deserialize, sign, serialize) → deserializeFromTransport →
 * submitSignedTransaction → confirmTransaction. Also exercises the "failed" and "timeout" paths
 * of confirmTransaction so all three outcomes are proven against a real cluster.
 */
import {
  createSolanaRpc,
  devnet,
  generateKeyPairSigner,
  createKeyPairSignerFromPrivateKeyBytes,
  type KeyPairSigner,
  signTransaction,
  lamports,
  getSignatureFromTransaction,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  buildUnsignedTransactionFromInstructions,
  serializeForTransport,
  deserializeFromTransport,
  submitSignedTransaction,
  confirmTransaction,
} from "./execute";

const DEVNET_RPC = "https://api.devnet.solana.com";
const MIN_BALANCE_LAMPORTS = 1_000_000n; // 0.001 SOL — ~200 transaction fees

/** Throwaway devnet keypair: persisted 32-byte seed if DEVNET_THROWAWAY_KEYPAIR is set, else in memory. */
async function loadThrowawaySigner(): Promise<{ signer: KeyPairSigner; persistedAt: string | null }> {
  const path = process.env.DEVNET_THROWAWAY_KEYPAIR;
  if (!path) return { signer: await generateKeyPairSigner(), persistedAt: null };
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify([...randomBytes(32)]), { mode: 0o600 });
    console.log(`Created new throwaway devnet keypair seed at ${path}`);
  }
  const seed = Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]);
  return { signer: await createKeyPairSignerFromPrivateKeyBytes(seed), persistedAt: path };
}

async function airdrop(rpc: ReturnType<typeof createSolanaRpc<ReturnType<typeof devnet>>>, to: string) {
  // The public devnet faucet rate-limits; try a couple of sizes before giving up.
  for (const sol of [1n, 1n, 0.5, 0.5]) {
    const amount = typeof sol === "bigint" ? sol * 1_000_000_000n : BigInt(sol * 1_000_000_000);
    try {
      const sig = await rpc.requestAirdrop(to as any, lamports(amount)).send();
      console.log(`Airdrop requested (${Number(amount) / 1e9} SOL): ${sig}`);
      const result = await confirmTransaction(rpc, sig, "confirmed", { timeoutMs: 60_000 });
      console.log(`Airdrop confirmation: ${JSON.stringify(result)}`);
      if (result.status === "success") return;
    } catch (err) {
      console.log(`Airdrop attempt failed: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error("Devnet faucet did not fund the throwaway wallet (rate-limited?) — stopping.");
}

async function main() {
  const rpc = createSolanaRpc(devnet(DEVNET_RPC));
  const genesis = await rpc.getGenesisHash().send();
  // Devnet genesis hash — refuse to run against anything else.
  if (genesis !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") {
    throw new Error(`Not devnet (genesis ${genesis}) — refusing to send anything.`);
  }
  console.log(`Connected to devnet (${DEVNET_RPC}, genesis ${genesis}).`);

  const { signer, persistedAt } = await loadThrowawaySigner();
  console.log(`Throwaway keypair: ${signer.address} (${persistedAt ? `seed at ${persistedAt}` : "in memory only"})`);
  const existing = (await rpc.getBalance(signer.address, { commitment: "confirmed" }).send()).value;
  if (existing >= MIN_BALANCE_LAMPORTS) {
    console.log(`Already funded (${existing} lamports) — skipping airdrop.`);
  } else {
    try {
      await airdrop(rpc, signer.address);
    } catch (err) {
      if (persistedAt) {
        console.log(
          `
Fund ${signer.address} with devnet SOL at https://faucet.solana.com (select devnet), then rerun.`
        );
      }
      throw err;
    }
  }
  const balanceBefore = (await rpc.getBalance(signer.address, { commitment: "confirmed" }).send()).value;
  console.log(`Balance: ${balanceBefore} lamports`);

  // ---------- 1. Happy path: 1 lamport to itself ----------
  console.log("\n=== 1. Success path: transfer 1 lamport to self ===");
  const transferIx = getTransferSolInstruction({ source: signer, destination: signer.address, amount: 1n });
  const { value: latest } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const unsigned = await buildUnsignedTransactionFromInstructions(rpc, [transferIx], signer.address);

  const wire = serializeForTransport(unsigned);
  console.log(`serializeForTransport: ${wire.length} base64 chars, ${Buffer.from(wire, "base64").length} bytes`);

  // --- wallet boundary (what the browser wallet will do) ---
  const atWallet = deserializeFromTransport(wire);
  const signedAtWallet = await signTransaction([signer.keyPair], atWallet);
  const returned = serializeForTransport(signedAtWallet);
  // --- back on our side ---
  const signed = deserializeFromTransport(returned);

  const signature = await submitSignedTransaction(rpc, signed);
  console.log(`submitSignedTransaction -> ${signature}`);
  const confirmed = await confirmTransaction(rpc, signature, "confirmed", {
    timeoutMs: 90_000,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  });
  console.log(`confirmTransaction(confirmed) -> ${JSON.stringify(confirmed)}`);
  const finalized = await confirmTransaction(rpc, signature, "finalized", { timeoutMs: 90_000 });
  console.log(`confirmTransaction(finalized) -> ${JSON.stringify(finalized)}`);

  // Independent check: fetch the landed transaction itself.
  const landed = await rpc
    .getTransaction(signature, { commitment: "confirmed", encoding: "json", maxSupportedTransactionVersion: 0 })
    .send();
  console.log(
    `getTransaction: slot ${landed?.slot}, err ${JSON.stringify(landed?.meta?.err)}, fee ${landed?.meta?.fee} lamports`
  );
  console.log(`Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);

  // ---------- 2. Failure path: lands on-chain with an error ----------
  console.log("\n=== 2. Failed path: transfer more than the balance, preflight skipped so it lands ===");
  const tooMuch = getTransferSolInstruction({
    source: signer,
    destination: (await generateKeyPairSigner()).address,
    amount: balanceBefore * 10n,
  });
  const badUnsigned = await buildUnsignedTransactionFromInstructions(rpc, [tooMuch], signer.address);
  const badSigned = await signTransaction([signer.keyPair], badUnsigned);
  try {
    await submitSignedTransaction(rpc, badSigned);
    console.log("UNEXPECTED: preflight accepted an over-balance transfer.");
  } catch (err) {
    console.log(`With preflight (default): rejected before landing — ${(err as Error).message.slice(0, 160)}`);
  }
  const badSig = await submitSignedTransaction(rpc, badSigned, { skipPreflight: true });
  console.log(`submitSignedTransaction(skipPreflight) -> ${badSig}`);
  const failed = await confirmTransaction(rpc, badSig, "confirmed", { timeoutMs: 90_000 });
  console.log(`confirmTransaction -> ${JSON.stringify(failed, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);

  // ---------- 3. Timeout path: a signature that never lands ----------
  console.log("\n=== 3. Timeout path: signature of a transaction that was never sent ===");
  const neverSent = await signTransaction(
    [signer.keyPair],
    await buildUnsignedTransactionFromInstructions(
      rpc,
      [getTransferSolInstruction({ source: signer, destination: signer.address, amount: 2n })],
      signer.address
    )
  );
  const ghost = getSignatureFromTransaction(neverSent);
  const timedOut = await confirmTransaction(rpc, ghost, "confirmed", { timeoutMs: 5_000 });
  console.log(`confirmTransaction -> ${JSON.stringify(timedOut)}`);

  const ok = confirmed.status === "success" && finalized.status === "success" && failed.status === "failed" && timedOut.status === "timeout";
  console.log(`\nRESULT: ${ok ? "all three outcomes behaved as expected" : "UNEXPECTED OUTCOME — see above"}`);
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error("Devnet send/confirm check failed:", err);
  process.exit(1);
});
