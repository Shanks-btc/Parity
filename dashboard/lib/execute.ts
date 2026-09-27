"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { useCallback, useState } from "react";
import { api, ApiError, type StrategyInput, type ValidationResult } from "./api";

/**
 * The real signing flow, shared by Borrow and Multiply:
 *
 *   /api/build-transaction  → the server re-simulates and returns the exact unsigned transaction
 *   wallet.signTransaction  → the user's own wallet signs (this app never sees a key)
 *   /api/submit-transaction → server submits and polls until the transaction is resolved
 *
 * Every path ends in one of the `Outcome`s below — there is no state that leaves the user guessing.
 */
export type Outcome =
  | { kind: "success"; signature: string; slot: string }
  | { kind: "failed"; signature: string; error: string; logs: string[] | null }
  | { kind: "timeout"; signature: string; blockhashExpired: boolean }
  | { kind: "rejected"; error: string } // never reached the chain — nothing was spent
  | { kind: "declined" } // the user closed / rejected the wallet prompt
  | { kind: "build-failed"; error: string; problems: string[] };

export type ExecuteState = { step: "idle" } | { step: "building" } | { step: "signing" } | { step: "submitting" } | { step: "done"; outcome: Outcome };

const toBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const stringify = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

export function useExecute(onSettled?: () => void) {
  const { publicKey, signTransaction } = useWallet();
  const [state, setState] = useState<ExecuteState>({ step: "idle" });

  /**
   * Runs the whole flow for any transaction source: `build` returns the exact unsigned transaction (base64) plus its
   * lastValidBlockHeight — /api/build-transaction for Kamino strategies, /api/build-swap for a Jupiter buy — and
   * everything after that (wallet signature, submit, confirm, outcome) is shared.
   */
  const execute = useCallback(
    async (build: () => Promise<{ transaction: string; lastValidBlockHeight: string }>) => {
      if (!publicKey) return;
      const done = (outcome: Outcome) => {
        setState({ step: "done", outcome });
        onSettled?.();
      };
      if (!signTransaction) return done({ kind: "rejected", error: "This wallet cannot sign transactions." });

      setState({ step: "building" });
      let built: { transaction: string; lastValidBlockHeight: string };
      try {
        built = await build();
      } catch (e) {
        const body = e instanceof ApiError ? (e.body as { validation?: ValidationResult; problems?: string[] } | null) : null;
        return done({ kind: "build-failed", error: (e as Error).message, problems: body?.validation?.problems ?? body?.problems ?? [] });
      }

      setState({ step: "signing" });
      let signedBase64: string;
      try {
        const signed = await signTransaction(VersionedTransaction.deserialize(fromBase64(built.transaction)));
        signedBase64 = toBase64(signed.serialize());
      } catch (e) {
        // Wallets word a dismissed prompt differently; anything thrown here means nothing was signed.
        const msg = (e as Error).message || "";
        return /reject|denied|declin|cancel|closed/i.test(msg) ? done({ kind: "declined" }) : done({ kind: "rejected", error: msg || "The wallet did not sign." });
      }

      setState({ step: "submitting" });
      try {
        const r = await api<
          | { status: "success"; signature: string; slot: string }
          | { status: "failed"; signature: string; error: unknown; logs: string[] | null }
          | { status: "timeout"; signature: string; blockhashExpired: boolean }
          | { status: "rejected"; error: string }
        >("/api/submit-transaction", { json: { signedTransaction: signedBase64, lastValidBlockHeight: built.lastValidBlockHeight } });
        if (r.status === "success") return done({ kind: "success", signature: r.signature, slot: r.slot });
        if (r.status === "failed") return done({ kind: "failed", signature: r.signature, error: stringify(r.error), logs: r.logs });
        if (r.status === "timeout") return done({ kind: "timeout", signature: r.signature, blockhashExpired: r.blockhashExpired });
        return done({ kind: "rejected", error: r.error });
      } catch (e) {
        // The request itself failed after signing: we cannot know whether it landed, so say so.
        return done({ kind: "rejected", error: `Could not reach the server to submit: ${(e as Error).message}. If your wallet shows a pending transaction, check it in Solana Explorer before retrying.` });
      }
    },
    [publicKey, signTransaction, onSettled]
  );

  const run = useCallback(
    (strategy: StrategyInput) =>
      execute(() => api("/api/build-transaction", { json: { wallet: publicKey?.toBase58(), strategy } })),
    [execute, publicKey]
  );

  return { state, run, execute, reset: () => setState({ step: "idle" }) };
}
