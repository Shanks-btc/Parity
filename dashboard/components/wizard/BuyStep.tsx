"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useRef, useState } from "react";
import { api, usePosition } from "@/lib/api";
import { useExecute } from "@/lib/execute";
import { Notice } from "../app/AppShell";
import { AmountInput, StatRow, parseAmount, tokenAmount, usd } from "../app/fields";
import { TxModal, type SummaryRow } from "../app/TxModal";
import { ConnectWalletButton } from "../wallet/ConnectWalletButton";

interface SwapPreview {
  quote: { spendUsdc: string; asset: string; expectedOut: string; minimumOut: string; slippageBps: number; priceImpactPct: string; routes: string[]; oraclePriceUsd: string };
  simulation: { ran: true; success: boolean; slot: string; unitsConsumed: string | null };
}
type Preview = { status: "idle" } | { status: "loading" } | { status: "ready"; data: SwapPreview } | { status: "error"; error: string };

/**
 * Real user-facing buy: USDC → the chosen xStock through Jupiter, as its OWN transaction (never folded into a Kamino
 * deposit). Live quote and an on-chain simulation before anything is signed, then the shared confirm → wallet →
 * submit → confirmed flow with its own receipt. `onBought` fires once the swap is confirmed on-chain.
 */
export function BuyStep({ asset, onBought, blurb }: { asset: string; onBought?: () => void; blurb?: string }) {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const position = usePosition(wallet);
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<Preview>({ status: "idle" });
  const [modal, setModal] = useState(false);
  const bought = useRef(onBought);
  bought.current = onBought;
  const exec = useExecute(position.reload);

  const usdcBalance = position.status === "ready" ? position.data.walletBalances.find((b) => b.symbol === "USDC")?.amount ?? "0" : null;
  const amountN = parseAmount(amount);
  const over = amountN !== null && usdcBalance !== null && amountN > Number(usdcBalance);
  const valid = wallet && amountN !== null && amountN >= 0.1 && !over;

  useEffect(() => {
    if (!valid) {
      const t = setTimeout(() => setPreview({ status: "idle" }), 0);
      return () => clearTimeout(t);
    }
    let live = true;
    const t = setTimeout(() => {
      setPreview({ status: "loading" });
      api<SwapPreview>("/api/build-swap", { json: { wallet, asset, usdcAmount: amountN, preview: true } })
        .then((data) => live && setPreview({ status: "ready", data }))
        .catch((e: Error) => live && setPreview({ status: "error", error: e.message }));
    }, 600);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [valid, wallet, asset, amountN]);

  const q = preview.status === "ready" ? preview.data : null;
  const simOk = !!q?.simulation.success;
  const busy = exec.state.step === "building" || exec.state.step === "signing" || exec.state.step === "submitting";
  const success = exec.state.step === "done" && exec.state.outcome.kind === "success";

  const closeModal = () => {
    if (busy) return;
    const wasSuccess = success;
    setModal(false);
    exec.reset();
    if (wasSuccess) {
      setAmount("");
      bought.current?.();
    }
  };

  const rows: SummaryRow[] = q
    ? [
        { label: "You spend", value: `${tokenAmount(q.quote.spendUsdc, 6)} USDC` },
        { label: `You receive (expected)`, value: `${tokenAmount(q.quote.expectedOut, 8)} ${asset}` },
        { label: `Minimum after ${q.quote.slippageBps / 100}% slippage`, value: `${tokenAmount(q.quote.minimumOut, 8)} ${asset}` },
        { label: "Route", value: q.quote.routes.join(" + ") || "Jupiter" },
        { label: "Price impact", value: `${Number(q.quote.priceImpactPct).toFixed(3)}%` },
      ]
    : [];

  const button = (text: string, enabled: boolean) => (
    <button type="button" disabled={!enabled} onClick={() => setModal(true)} className="w-full cursor-pointer rounded-lg border border-transparent bg-gold-deep px-7 py-[15px] font-mono text-[15px] font-medium text-gold-ink hover:bg-gold-text disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-ink-muted">
      {text}
    </button>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:gap-8" data-testid="buy-step">
      <div className="rounded-[10px] border border-line bg-surface p-5 md:p-7">
        {blurb && <p className="m-0 mb-5 font-serif text-[15px] leading-normal text-ink-muted">{blurb}</p>}
        <AmountInput
          id="buy-usdc"
          label={`SPEND USDC TO BUY ${asset.toUpperCase()}`}
          value={amount}
          onChange={setAmount}
          token="USDC"
          disabled={!wallet}
          invalid={over}
          onMax={usdcBalance !== null && Number(usdcBalance) >= 0.1 ? () => setAmount((Math.floor(Number(usdcBalance) * 100) / 100).toString()) : undefined}
          hint={!wallet ? "Connect a wallet to see your USDC balance." : usdcBalance === null ? "Reading your balance…" : over ? <span className="text-clay-text">More than your {tokenAmount(usdcBalance, 6)} USDC.</span> : <>USDC balance: {tokenAmount(usdcBalance, 6)}. Minimum 0.10 USDC.</>}
        />
        {wallet && usdcBalance !== null && Number(usdcBalance) < 0.1 && (
          <div className="mt-4"><Notice tone="gold">This wallet has no USDC to spend. Add USDC to it first, then come back, Parity only swaps what your wallet already holds.</Notice></div>
        )}
        <div className="mt-5" data-testid="swap-preview">
          {preview.status === "loading" && <Notice>Getting a live Jupiter quote and simulating the swap on mainnet…</Notice>}
          {preview.status === "error" && <Notice tone="clay">{preview.error}</Notice>}
          {q && (simOk ? (
            <div className="rounded-lg border border-positive/40 bg-positive-tint px-4 py-3">
              <div className="font-mono text-[11px] tracking-[0.04em] text-positive">QUOTE + SIMULATION PASSED</div>
              <p className="mb-0 mt-1 font-serif text-[14px] leading-normal text-ink">
                About <span className="font-mono">{tokenAmount(q.quote.expectedOut, 8)}</span> {asset} for <span className="font-mono">{tokenAmount(q.quote.spendUsdc, 6)}</span> USDC. Simulated on mainnet at slot <span className="font-mono">{q.simulation.slot}</span>.
              </p>
            </div>
          ) : (
            <Notice tone="clay">Simulation did not pass, nothing can be signed.</Notice>
          ))}
        </div>
        <div className="mt-6">
          {!wallet ? <ConnectWalletButton size="hero">Connect vault to buy</ConnectWalletButton> : !valid ? button(`Enter a USDC amount`, false) : preview.status !== "ready" ? button("Getting quote…", false) : !simOk ? button("Simulation failed, cannot proceed", false) : button(`Buy ${asset} with USDC`, true)}
        </div>
        <p className="mb-0 mt-3 font-mono text-[11px] leading-normal text-ink-faint">
          A separate, real transaction: a plain Jupiter swap in your own wallet, with its own receipt. It is not bundled into any Kamino deposit. Nothing is signed until you approve it.
        </p>
      </div>

      <aside aria-label="Swap summary" className="self-start overflow-hidden rounded-[10px] border border-line bg-surface">
        <div className="border-b border-line bg-paper-raised px-5 py-3 font-mono text-[10px] tracking-[0.04em] text-ink-faint">SWAP SUMMARY</div>
        <StatRow label="Pair" value={`USDC → ${asset}`} />
        <StatRow label="Expected" value={q ? `${tokenAmount(q.quote.expectedOut, 8)} ${asset}` : ", "} tone={q ? "ink" : "muted"} note={q ? `≈ ${usd(Number(q.quote.expectedOut) * Number(q.quote.oraclePriceUsd))} at Kamino's oracle` : undefined} />
        <StatRow label="Minimum" value={q ? `${tokenAmount(q.quote.minimumOut, 8)} ${asset}` : ", "} tone={q ? "ink" : "muted"} note="After slippage" />
        <StatRow label="Route" value={q ? q.quote.routes.join(" + ") || "Jupiter" : ", "} tone={q ? "ink" : "muted"} note="Jupiter aggregator" />
        <StatRow label="Network" value="Solana" />
      </aside>

      {q && (
        <TxModal open={modal} venue="Jupiter" title={`Swap ${tokenAmount(q.quote.spendUsdc, 6)} USDC for about ${tokenAmount(q.quote.expectedOut, 8)} ${asset}.`} rows={rows} simulation={{ projectedHealthFactor: null, simulation: { ran: true, slot: q.simulation.slot, unitsConsumed: q.simulation.unitsConsumed } }} state={exec.state} onConfirm={() => wallet && exec.execute(() => api("/api/build-swap", { json: { wallet, asset, usdcAmount: amountN } }))} onClose={closeModal} />
      )}
    </div>
  );
}
