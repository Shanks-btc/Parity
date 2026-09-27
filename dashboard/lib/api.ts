"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssetCapabilities, WalletPosition } from "../../src/kamino/client";
import type { StrategyInput, ValidationResult } from "../../src/agent/validate";

/** Client side of the /api routes (which wrap the verified backend). Types are the backend's own. */
export type { AssetCapabilities, StrategyInput, ValidationResult, WalletPosition };

export interface ReserveInfo {
  symbol: string;
  mintAddress: string;
  reserveAddress: string;
  loanToValuePct: number;
  liquidationThresholdPct: number;
  oraclePriceUsd: string;
}
export interface ReservesResponse {
  market: string;
  reserves: ReserveInfo[];
  usdc: ReserveInfo;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    method: init?.json !== undefined ? "POST" : init?.method,
    headers: init?.json !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`, res.status, body);
  return body as T;
}

export type Loadable<T> = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: T };

/** Fetches once (and again on `reload()`); `key` null means "don't fetch". */
export function useLoad<T>(key: string | null): Loadable<T> & { reload: () => void } {
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!key) return;
    let live = true;
    // Keep showing the previous data during a reload; only the first load shows "loading".
    api<T>(key)
      .then((data) => live && setState({ status: "ready", data }))
      .catch((e: Error) => live && setState({ status: "error", error: e.message }));
    return () => {
      live = false;
    };
  }, [key, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...(key ? state : ({ status: "loading" } as Loadable<T>)), reload };
}

export const useReserves = () => useLoad<ReservesResponse>("/api/reserves");
export const usePosition = (wallet: string | null) => useLoad<WalletPosition>(wallet ? `/api/position?wallet=${wallet}` : null);

export type SimState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: ValidationResult }
  | { status: "error"; error: string };

/**
 * Runs the real simulation (POST /api/simulate) whenever the strategy changes, debounced, and ignores
 * out-of-order replies. `strategy === null` means the inputs aren't complete yet.
 */
export function useSimulation(wallet: string | null, strategy: StrategyInput | null, debounceMs = 700): SimState & { rerun: () => void } {
  const [state, setState] = useState<SimState>({ status: "idle" });
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);
  const key = wallet && strategy ? JSON.stringify([wallet, strategy, nonce]) : null;

  useEffect(() => {
    const id = ++latest.current;
    if (!key || !wallet || !strategy) {
      // Inputs incomplete: clear any stale result (deferred so it isn't a synchronous setState in the effect body).
      const t = setTimeout(() => latest.current === id && setState({ status: "idle" }), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setState({ status: "running" });
      api<ValidationResult>("/api/simulate", { json: { wallet, strategy } })
        .then((result) => latest.current === id && setState({ status: "done", result }))
        .catch((e: Error) => latest.current === id && setState({ status: "error", error: e.message }));
    }, debounceMs);
    return () => clearTimeout(t);
    // `key` already encodes wallet + strategy + nonce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, debounceMs]);

  return { ...state, rerun: () => setNonce((n) => n + 1) };
}

export const explorerTxUrl = (signature: string) => `https://explorer.solana.com/tx/${signature}`;
export const explorerAddressUrl = (addr: string) => `https://explorer.solana.com/address/${addr}`;
