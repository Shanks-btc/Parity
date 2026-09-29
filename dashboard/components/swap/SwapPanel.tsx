"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, explorerTxUrl, usePosition, type WalletPosition } from "@/lib/api";
import { useExecute } from "@/lib/execute";
import { ceilTo, floorTo, lamportsToSol, maxPay, MIN_PAY, PAY_TOKENS, SELL_CHIPS_PCT, SLIPPAGE_PCT, SOL_RESERVE, solText, SWAP_ASSETS, USD_CHIPS, type PayToken, type SwapPreview, type SwapQuote, type SwapQuoteOk, type SwapSide } from "@/lib/swap";
import { Mono } from "../Mono";
import { TxModal, type SummaryRow } from "../app/TxModal";
import { ConnectWalletButton } from "../wallet/ConnectWalletButton";
import { useWizard } from "../wizard/WizardModal";

/*
 * The in-app swap: USDC or SOL <-> AAPLx / SPYx / TSLAx through Jupiter, as its own transaction, both directions.
 *   Buy:  pay counterToken (USDC/SOL), receive the xStock.
 *   Sell: pay the xStock, receive counterToken (USDC/SOL).
 *
 * EXACT-INPUT ONLY. Jupiter returns NO_ROUTES_FOUND for exact-output quotes on every xStock pair, so the user edits
 * "You pay" and "You receive" is only an estimate. Do not add an editable receive field without a different route.
 *
 * Signing is not implemented here: it goes through the shared useExecute + TxModal flow (/api/build-swap builds and
 * simulates, the user's own wallet signs, /api/submit-transaction confirms).
 */

const term = {
  label: "font-mono text-[10px] text-term-faint",
  box: "rounded-lg border border-term-control px-3.5 py-3 focus-within:border-gold",
  tab: "min-h-[36px] cursor-pointer border-none bg-transparent px-2.5 py-1.5 font-mono text-[11px] tracking-[0.04em] text-term-faint hover:text-term-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-gold",
  tabOn: "rounded-md !bg-term-raised !text-term-text",
};
const cleanAmount = (raw: string) => {
  const s = raw.replace(/[^0-9.]/g, "");
  const [head, ...rest] = s.split(".");
  return (rest.length ? `${head}.${rest.join("").slice(0, 9)}` : head).slice(0, 14);
};
const positive = (s: string) => {
  const n = Number(s);
  return s !== "" && Number.isFinite(n) && n > 0 ? n : null;
};
const fmt = (s: string | number, max = 8) => {
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: max }) : String(s);
};
const usdText = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Probe = { status: "loading" } | { status: "ok"; counterUsd: number } | { status: "none" } | { status: "unknown" };
type QuoteState = { status: "idle" } | { status: "loading" } | { status: "ready"; key: string; data: SwapQuoteOk } | { status: "error"; error: string };
type PreviewState = { status: "idle" } | { status: "loading"; key: string } | { status: "ready"; key: string; at: number; data: SwapPreview } | { status: "error"; key: string; error: string };

export function SwapPanel({ initialAsset, initialPay, from, next, className = "" }: { initialAsset?: string | null; initialPay?: string | null; from?: string | null; next?: string | null; className?: string }) {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const position = usePosition(wallet);
  const wizard = useWizard();

  const [asset, setAsset] = useState<string>((SWAP_ASSETS as readonly string[]).includes(initialAsset ?? "") ? (initialAsset as string) : "AAPLx");
  const [side, setSide] = useState<SwapSide>("buy");
  const [pickedCounter, setCounter] = useState<PayToken>("USDC");
  const [amount, setAmount] = useState(() => (initialPay && /^\d*\.?\d+$/.test(initialPay) && Number(initialPay) > 0 ? initialPay : ""));
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [quote, setQuote] = useState<QuoteState>({ status: "idle" });
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [modal, setModal] = useState(false);
  // What the confirmation dialog shows. A snapshot, so the dialog (and its success screen) survives the form clearing.
  const [snap, setSnap] = useState<SwapPreview | null>(null);
  const [card, setCard] = useState<{ asset: string; side: SwapSide; counterToken: PayToken; signature: string } | null>(null);
  const [received, setReceived] = useState<{ amount: number; balance: string } | "unknown" | null>(null);
  const pending = useRef<{ asset: string; side: SwapSide; counterToken: PayToken; startBalance: number } | null>(null);
  const exec = useExecute(position.reload);

  const setAssetTab = (a: string) => {
    setAsset(a);
    setAmount("");
  };
  const setSideTab = (s: SwapSide) => {
    setSide(s);
    setAmount("");
  };

  const probeKey = `${asset}:${side}`;
  const offered = PAY_TOKENS.filter((t) => probes[`${probeKey}:${t}`]?.status !== "none");
  // The chosen counter token, unless it has no route for this asset/side, in which case the first offered one.
  const counterToken: PayToken = offered.length > 0 && !offered.includes(pickedCounter) ? offered[0] : pickedCounter;

  // ---- real balances (movable amounts, not the inflated on-screen amount) ----
  const pos = position.status === "ready" ? position.data : null;
  const assetBalance = pos ? Number(pos.walletBalances.find((b) => b.symbol === asset)?.amount ?? "0") : null;
  const counterBalance: number | null = pos ? (counterToken === "SOL" ? Number(pos.solBalance) : Number(pos.walletBalances.find((b) => b.symbol === "USDC")?.amount ?? "0")) : null;
  // The PAY leg's balance: counterToken for a buy, the asset itself for a sell.
  const balance = side === "buy" ? counterBalance : assetBalance;
  const payUnit = side === "buy" ? counterToken : asset;
  const receiveUnit = side === "buy" ? asset : counterToken;
  const amountN = positive(amount);

  // ---- which counter tokens have a route for this asset/side: a real quote per pair, hidden only on a definitive "no route" ----
  useEffect(() => {
    let live = true;
    for (const t of PAY_TOKENS) {
      const key = `${probeKey}:${t}`;
      const url = side === "buy" ? `/api/swap-quote?asset=${asset}&side=buy&counterToken=${t}&usd=1` : `/api/swap-quote?asset=${asset}&side=sell&counterToken=${t}&amount=0.000001`;
      api<SwapQuote>(url)
        .then((q) => live && setProbes((p) => ({ ...p, [key]: q.available ? { status: "ok", counterUsd: q.counterUsd } : { status: "none" } })))
        .catch(() => live && setProbes((p) => ({ ...p, [key]: { status: "unknown" } })));
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probeKey]);
  const rateOf = (t: PayToken) => {
    const p = probes[`${probeKey}:${t}`];
    return p?.status === "ok" ? p.counterUsd : t === "USDC" ? 1 : null;
  };
  const noRoutes = offered.length === 0;

  const min = side === "buy" ? MIN_PAY[counterToken] : 0;
  const tooSmall = amountN !== null && amountN < min;
  const over = amountN !== null && balance !== null && amountN > balance;
  const belowReserve = side === "buy" && counterToken === "SOL" && amountN !== null && balance !== null && !over && balance - amountN < SOL_RESERVE;
  const valid = amountN !== null && !tooSmall && !noRoutes;

  // ---- typing-time quote: GET /api/swap-quote (quote only), debounced ----
  const qKey = valid ? `${asset}|${side}|${counterToken}|${amountN}` : null;
  useEffect(() => {
    if (!qKey) {
      const t = setTimeout(() => setQuote({ status: "idle" }), 0);
      return () => clearTimeout(t);
    }
    let live = true;
    const t = setTimeout(() => {
      setQuote({ status: "loading" });
      api<SwapQuote>(`/api/swap-quote?asset=${asset}&side=${side}&counterToken=${counterToken}&amount=${amountN}`)
        .then((q) => live && setQuote(q.available ? { status: "ready", key: qKey, data: q } : { status: "error", error: "Jupiter has no route for this pair right now." }))
        .catch((e: Error) => live && setQuote({ status: "error", error: e.message }));
    }, 500);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [qKey, asset, side, counterToken, amountN]);
  const q = quote.status === "ready" && quote.key === qKey ? quote.data : null;

  // ---- simulation with measured fees and rent (POST /api/build-swap, preview) once a quote is in and a wallet is connected ----
  const pKey = wallet && q && !over ? `${wallet}|${qKey}` : null;
  const runPreview = (key: string) => {
    setPreview({ status: "loading", key });
    return api<SwapPreview>("/api/build-swap", { json: { wallet, asset, side, counterToken, amount: amountN, preview: true } }).then(
      (data) => {
        setPreview({ status: "ready", key, at: Date.now(), data });
        return data;
      },
      (e: Error) => {
        setPreview({ status: "error", key, error: e.message });
        return null;
      }
    );
  };
  // pKey already encodes wallet + asset + side + counterToken + amount, so it is the only real dependency.
  useEffect(() => {
    if (!pKey) return;
    const t = setTimeout(() => void runPreview(pKey), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pKey]);
  const pv = preview.status === "ready" && preview.key === pKey ? preview.data : null;
  const pvError = preview.status === "error" && preview.key === pKey ? preview.error : null;
  const pvLoading = preview.status === "loading" && preview.key === pKey;

  const busy = exec.state.step === "building" || exec.state.step === "signing" || exec.state.step === "submitting";
  const impact = q ? Number(q.priceImpactPct) : null;
  const highImpact = impact !== null && impact > 1;

  const onSwap = async () => {
    if (!pKey || !q) return;
    let data = pv && preview.status === "ready" && Date.now() - preview.at < 40_000 ? pv : null;
    if (!data) data = await runPreview(pKey);
    if (data?.simulation.success) {
      setSnap(data);
      setModal(true);
    }
  };

  const confirm = () => {
    if (!wallet || amountN === null) return;
    // The RECEIVE leg's balance before this tx lands, so the poll below can tell what actually arrived.
    const startBalance = side === "buy" ? (assetBalance ?? 0) : counterToken === "SOL" ? Number(pos?.solBalance ?? "0") : (counterBalance ?? 0);
    pending.current = { asset, side, counterToken, startBalance };
    void exec.execute(() => api("/api/build-swap", { json: { wallet, asset, side, counterToken, amount: amountN } }));
  };
  const closeModal = () => {
    if (busy) return;
    const ok = exec.state.step === "done" && exec.state.outcome.kind === "success";
    setModal(false);
    exec.reset();
    if (ok) setAmount("");
  };

  // ---- after success: the card + the amount actually received (movable for an xStock), read back from the wallet ----
  const signature = exec.state.step === "done" && exec.state.outcome.kind === "success" ? exec.state.outcome.signature : null;
  useEffect(() => {
    if (!signature || !pending.current) return;
    const { asset: tradedAsset, side: tradedSide, counterToken: tradedCounter, startBalance } = pending.current;
    setCard({ asset: tradedAsset, side: tradedSide, counterToken: tradedCounter, signature });
    setReceived(null);
    const receiveSymbol = tradedSide === "buy" ? tradedAsset : tradedCounter;
    let live = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      tries++;
      try {
        const p = await api<WalletPosition>(`/api/position?wallet=${wallet}`);
        const b = receiveSymbol === "SOL" ? p.solBalance : (p.walletBalances.find((x) => x.symbol === receiveSymbol)?.amount ?? "0");
        if (Number(b) > startBalance) {
          if (live) setReceived({ amount: Number(b) - startBalance, balance: b });
          position.reload();
          return;
        }
      } catch {
        /* retry below */
      }
      if (!live) return;
      if (tries < 8) timer = setTimeout(poll, 2500);
      else setReceived("unknown");
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const pickChip = (usd: number) => {
    const r = rateOf(counterToken);
    if (r) setAmount(counterToken === "USDC" ? String(usd) : ceilTo(usd / r, 6));
  };
  const pickSellChip = (pct: number) => {
    if (assetBalance === null) return;
    setAmount(floorTo((assetBalance * pct) / 100, 8));
  };
  const onMax = () => {
    if (balance === null) return;
    const m = side === "buy" ? maxPay(counterToken, balance) : balance;
    setAmount(m > 0 ? floorTo(m, 6) : "");
  };

  const costs = pv?.simulation.costs;
  const rows: SummaryRow[] = snap
    ? [
        { label: "You pay", value: `${fmt(snap.quote.spend, 9)} ${snap.quote.side === "buy" ? snap.quote.counterToken : snap.quote.asset}` },
        { label: "You receive (estimate)", value: `${fmt(snap.quote.expectedOut)} ${snap.quote.side === "buy" ? snap.quote.asset : snap.quote.counterToken}` },
        { label: `Minimum after ${SLIPPAGE_PCT}% slippage`, value: `${fmt(snap.quote.minimumOut)} ${snap.quote.side === "buy" ? snap.quote.asset : snap.quote.counterToken}` },
        { label: "Route", value: snap.quote.routes.join(" + ") || "Jupiter" },
        { label: "Price impact", value: `${Number(snap.quote.priceImpactPct).toFixed(3)}%`, tone: Number(snap.quote.priceImpactPct) > 1 ? "clay" : "ink" },
        { label: "Network + priority fee", value: solText(lamportsToSol(snap.simulation.costs.totalFeeLamports)) },
        ...(snap.simulation.costs.createsTokenAccount ? [{ label: `One-time ${snap.quote.side === "buy" ? snap.quote.asset : snap.quote.counterToken} account rent`, value: solText(lamportsToSol(snap.simulation.costs.tokenAccountRentLamports)) }] : []),
        ...(snap.simulation.costs.otherKeptRentLamports > 0 ? [{ label: "Extra route account (recoverable)", value: solText(lamportsToSol(snap.simulation.costs.otherKeptRentLamports)) }] : []),
      ]
    : [];

  // Shown only while `card` matches the CURRENT asset/side/counterToken — switching tabs after a swap must never
  // relabel a past confirmation as if it were about whatever is now selected (that would claim a balance you don't have).
  const cardMatches = card && card.asset === asset && card.side === side && card.counterToken === counterToken;
  const receivedNote = card && (
    received === null ? (
      <span>Reading your new {card.side === "buy" ? card.asset : card.counterToken} balance…</span>
    ) : received === "unknown" ? (
      <span>Confirmed. Your new balance has not shown up yet, check the Portfolio page in a moment.</span>
    ) : (
      <span>
        You received <Mono>{fmt(received.amount)}</Mono> {card.side === "buy" ? card.asset : card.counterToken}
        {card.side === "buy" && " (movable)"}. You now hold <Mono>{fmt(received.balance)}</Mono> {card.side === "buy" ? card.asset : card.counterToken}.
      </span>
    )
  );

  // ---- primary button ----
  let primary: React.ReactNode;
  const btn = "w-full cursor-pointer rounded-lg border border-transparent bg-gold px-5 py-3.5 font-mono text-[14px] font-medium text-gold-ink hover:bg-[#eec468] disabled:cursor-not-allowed disabled:bg-term-raised disabled:text-term-faint";
  const actionVerb = side === "buy" ? "Swap" : "Sell";
  if (!wallet) primary = <ConnectWalletButton size="block" tone="dark" />;
  else if (noRoutes) primary = <button type="button" disabled className={btn}>No route for {asset}</button>;
  else if (amountN === null) primary = <button type="button" disabled className={btn}>Enter an amount</button>;
  else if (tooSmall) primary = <button type="button" disabled className={btn}>Minimum {min} {payUnit}</button>;
  else if (over) primary = <button type="button" disabled className={btn}>Not enough {payUnit}</button>;
  else if (!q) primary = <button type="button" disabled className={btn}>Getting quote…</button>;
  else if (pvLoading) primary = <button type="button" disabled className={btn}>Swapping…</button>;
  else primary = <button type="button" onClick={onSwap} disabled={busy} data-testid="swap-submit" className={btn}>{actionVerb} {payUnit} for {receiveUnit}</button>;

  const card_ = cardMatches && card && (
    <div data-testid="swap-success-card" className="rounded-lg border border-positive/50 bg-positive-tint/10 px-3.5 py-3">
      <div className="font-mono text-[10px] tracking-[0.04em] text-positive">SWAP CONFIRMED</div>
      <p className="m-0 mt-1 font-serif text-[13px] leading-normal text-term-text">{receivedNote}</p>
      <a href={explorerTxUrl(card.signature)} target="_blank" rel="noreferrer" className="mt-1 inline-block font-mono text-[11px] text-gold underline underline-offset-2">
        View on Solana Explorer ↗
      </a>
      {card.side === "buy" && (
        <div className="mt-3">
          {from === "wizard" ? (
            <button type="button" data-testid="swap-cta" onClick={() => wizard.open({ resume: true })} className={btn}>
              Back to your strategy →
            </button>
          ) : (
            <Link
              data-testid="swap-cta"
              href={(() => {
                const b = received && received !== "unknown" ? floorTo(Number(received.balance), 8) : "";
                const toMultiply = next === "multiply" && card.asset !== "AAPLx";
                return toMultiply ? `/earn/multiply?asset=${card.asset}${b ? `&deposit=${b}` : ""}` : `/borrow?asset=${card.asset}${b ? `&supply=${b}` : ""}`;
              })()}
              className={`${btn} block text-center no-underline`}
            >
              Continue: deposit {card.asset} →
            </Link>
          )}
        </div>
      )}
    </div>
  );

  const line = (label: string, value: React.ReactNode, testid?: string) => (
    <div className="flex justify-between gap-3" data-testid={testid}>
      <dt className="shrink-0 text-term-faint">{label}</dt>
      <dd className="m-0 text-right text-term-text">{value}</dd>
    </div>
  );
  const implied = q && amountN !== null && side === "buy" && rateOf(counterToken) ? (amountN * (rateOf(counterToken) as number)) / Number(q.expectedOut) : null;

  // The USDC/SOL selector: shown next to "You pay" for a buy, next to "You receive" for a sell.
  const counterSelector = (
    <div className="flex gap-1" role="group" aria-label="Counter token">
      {(offered.length ? offered : PAY_TOKENS).map((t) => (
        <button key={t} type="button" data-counter-token={t} aria-pressed={t === counterToken} onClick={() => setCounter(t)} className={`${term.tab} !min-h-[28px] !py-0.5 ${t === counterToken ? term.tabOn : ""}`}>
          {t}
        </button>
      ))}
    </div>
  );

  return (
    <div data-testid="swap-panel" className={`flex flex-col border-b border-term-line pb-5 lg:w-[300px] lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:pb-5 ${className}`}>
      <div className="flex flex-col gap-2.5 border-b border-term-line px-5 py-3.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="m-0 font-serif text-base font-medium text-term-text">{side === "buy" ? "Buy" : "Sell"} {asset}</h2>
          <div className="flex gap-0.5" role="group" aria-label="Asset">
            {SWAP_ASSETS.map((a) => (
              <button key={a} type="button" data-swap-asset={a} aria-pressed={a === asset} onClick={() => setAssetTab(a)} className={`${term.tab} !px-2 ${a === asset ? term.tabOn : ""}`}>
                {a.replace("x", "")}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-1" role="group" aria-label="Buy or sell" data-testid="swap-side-switch">
          {(["buy", "sell"] as const).map((s) => (
            <button key={s} type="button" data-swap-side={s} aria-pressed={s === side} onClick={() => setSideTab(s)} className={`min-h-[30px] flex-1 cursor-pointer rounded-md border-none font-mono text-[11px] tracking-[0.04em] ${s === side ? "bg-term-raised text-term-text" : "bg-transparent text-term-faint hover:text-term-text"}`}>
              {s === "buy" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4 px-5 pt-5">
        {card_}

        <div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="swap-pay" className={term.label}>YOU PAY</label>
            {side === "buy" && counterSelector}
          </div>
          <div className={`mt-1.5 flex items-center justify-between gap-2 ${term.box}`}>
            <input id="swap-pay" data-testid="swap-pay" type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} onChange={(e) => setAmount(cleanAmount(e.target.value))} className="w-full min-w-0 border-none bg-transparent font-mono text-base text-term-text outline-none placeholder:text-term-faint" />
            <button type="button" data-testid="swap-max" onClick={onMax} disabled={balance === null} className="shrink-0 cursor-pointer rounded border border-term-control bg-transparent px-1.5 py-0.5 font-mono text-[10px] text-gold hover:border-gold disabled:cursor-not-allowed disabled:opacity-50">
              MAX
            </button>
            <span className="shrink-0 font-mono text-xs text-term-faint">{payUnit}</span>
          </div>
          <div className="mt-1.5 font-mono text-[10px] leading-normal text-term-faint" data-testid="swap-balance">
            {!wallet ? "Connect to see your balance." : balance === null ? "Reading your balance…" : <>Balance: {fmt(balance, 6)} {payUnit}</>}
            {over && <span className="text-clay-text"> · More than your balance.</span>}
            {tooSmall && <span className="text-clay-text"> · Minimum {min} {payUnit}.</span>}
          </div>
          {side === "buy" && counterToken === "SOL" && (
            <div className="mt-1 font-mono text-[10px] leading-normal text-term-muted" data-testid="swap-reserve-note">
              Keeping {SOL_RESERVE} SOL for your first Kamino position
              {belowReserve && <span className="text-clay-text"> · This amount dips into it.</span>}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          {side === "buy"
            ? USD_CHIPS.map((usd) => (
                <button key={usd} type="button" data-usd-chip={usd} disabled={!rateOf(counterToken)} onClick={() => pickChip(usd)} className="min-h-[40px] min-w-0 flex-1 cursor-pointer rounded-md border border-term-control bg-term-surface px-1 py-2 text-center font-mono text-[13px] text-term-text hover:border-gold disabled:cursor-not-allowed disabled:opacity-50">
                  ${usd}
                </button>
              ))
            : SELL_CHIPS_PCT.map((pct) => (
                <button key={pct} type="button" data-pct-chip={pct} disabled={!assetBalance} onClick={() => pickSellChip(pct)} className="min-h-[40px] min-w-0 flex-1 cursor-pointer rounded-md border border-term-control bg-term-surface px-1 py-2 text-center font-mono text-[13px] text-term-text hover:border-gold disabled:cursor-not-allowed disabled:opacity-50">
                  {pct === 100 ? "MAX" : `${pct}%`}
                </button>
              ))}
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <div className={term.label}>YOU RECEIVE ≈</div>
            {side === "sell" && counterSelector}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg border border-term-line bg-term-surface px-3.5 py-3">
            <span data-testid="swap-receive" className="min-w-0 truncate font-mono text-base text-term-text">{q ? fmt(q.expectedOut) : quote.status === "loading" ? "…" : "0.00"}</span>
            <span className="shrink-0 font-mono text-xs text-term-faint">{receiveUnit}</span>
          </div>
        </div>

        {(probes[`${probeKey}:USDC`]?.status === "none" || probes[`${probeKey}:SOL`]?.status === "none") && !noRoutes && (
          <div className="font-mono text-[10px] text-term-faint">{probes[`${probeKey}:USDC`]?.status === "none" ? "USDC" : "SOL"} has no route {side === "buy" ? "to" : "from"} {asset} right now, so it is not offered.</div>
        )}
        {noRoutes && <div className="font-mono text-[11px] text-clay-text">Neither USDC nor SOL has a route {side === "buy" ? "to" : "from"} {asset} right now.</div>}
        {quote.status === "error" && <div className="font-mono text-[11px] text-clay-text" data-testid="swap-quote-error">{quote.error}</div>}

        {q && (
          <dl className="m-0 flex flex-col gap-2 border-t border-term-line pt-4 font-mono text-[11px]" data-testid="swap-details">
            {line("Route", q.routes.join(" + ") || "Jupiter", "swap-route")}
            {line("Price impact", <span className={highImpact ? "text-clay-text" : ""}>{impact !== null ? `${impact.toFixed(3)}%` : ", "}{highImpact && " (high)"}</span>, "swap-impact")}
            {line(`Min received (${SLIPPAGE_PCT}%)`, `${fmt(q.minimumOut)} ${receiveUnit}`, "swap-min")}
            {pv && costs ? (
              <>
                {line("Network + priority fee", solText(lamportsToSol(costs.totalFeeLamports)), "swap-fee")}
                {costs.createsTokenAccount && line(`One-time ${receiveUnit} account rent`, solText(lamportsToSol(costs.tokenAccountRentLamports)), "swap-rent")}
                {costs.otherKeptRentLamports > 0 && line("Extra route account", <span>{solText(lamportsToSol(costs.otherKeptRentLamports))} <span className="text-term-faint">(recoverable by closing it)</span></span>, "swap-extra-rent")}
              </>
            ) : (
              line("Fees + rent", <span className="text-term-faint">{!wallet ? "shown once connected" : pvLoading ? "simulating…" : pvError ? "unavailable" : "…"}</span>, "swap-fee")
            )}
            {line("Kamino oracle", `${usdText(Number(q.oraclePriceUsd))}${implied ? ` · swap ${usdText(implied)}` : ""}`, "swap-oracle")}
          </dl>
        )}
        {highImpact && <div className="font-mono text-[10px] leading-normal text-clay-text" data-testid="swap-impact-warning">Price impact is above 1%. You can still swap, but you would get noticeably less than the oracle price.</div>}
        {pvError && <div className="font-mono text-[11px] leading-normal text-clay-text" data-testid="swap-preview-error">{pvError}</div>}

        {primary}
        <p className="m-0 font-mono text-[10px] leading-normal text-term-faint">
          Exact-input swap through Jupiter, {SLIPPAGE_PCT}% slippage. What you receive is an estimate. You approve it in your own wallet.
        </p>
      </div>

      {snap && (
        <TxModal
          open={modal}
          venue="Jupiter"
          title={`${snap.quote.side === "buy" ? "Swap" : "Sell"} ${fmt(snap.quote.spend, 9)} ${snap.quote.side === "buy" ? snap.quote.counterToken : snap.quote.asset} for about ${fmt(snap.quote.expectedOut)} ${snap.quote.side === "buy" ? snap.quote.asset : snap.quote.counterToken}.`}
          rows={rows}
          simulation={{ projectedHealthFactor: null, simulation: { ran: true, slot: snap.simulation.slot, unitsConsumed: snap.simulation.unitsConsumed } }}
          state={exec.state}
          onConfirm={confirm}
          onClose={closeModal}
          successNote={receivedNote}
        />
      )}
    </div>
  );
}
