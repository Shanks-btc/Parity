"use client";

import { useState, useSyncExternalStore } from "react";
import { Mono } from "../Mono";
import { ConnectWalletButton } from "../wallet/ConnectWalletButton";
import { getServerSnapshot, getSnapshot, setTimeframe, subscribe, TIMEFRAMES } from "./sim-store";

/*
 * Interactive controls for the Trade CONCEPT page. They are real UI with real state — clickable, editable, draggable —
 * and the numbers they produce are correct arithmetic, but the price they operate on is the SIMULATED one from
 * sim-store (generated in the browser, not real market data).
 *
 * THE HARD LINE: there is no order-submit action anywhere in this file — no "Place order" / "Buy" / "Confirm" button,
 * no submit handler, and no success/filled/opened message can be produced. The only buttons here change what is
 */

const ASSET = "AAPLx";
const MAX_LEVERAGE = 20;
const CHIPS = [10, 25, 50, 100];

const tabBase = "min-h-[36px] cursor-pointer border-none bg-transparent px-2.5 py-1.5 font-mono text-[11px] tracking-[0.04em] text-term-faint hover:text-term-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-gold";
const tabActive = "rounded-md !bg-term-raised !text-term-text";
const chipBase = "min-h-[40px] cursor-pointer rounded-md border bg-term-surface px-3.5 py-2 font-mono text-[13px] hover:border-gold focus-visible:outline focus-visible:outline-1 focus-visible:outline-gold";

const useSim = () => useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

/** 1m … 1D — switch which simulated series the chart draws. */
export function TimeframeTabs() {
  const { tf } = useSim();
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Chart timeframe">
      {TIMEFRAMES.map((t) => (
        <button key={t} type="button" data-tf-tab={t} aria-pressed={t === tf} onClick={() => setTimeframe(t)} className={`${tabBase} ${t === tf ? tabActive : ""}`}>
          {t}
        </button>
      ))}
    </div>
  );
}

type Side = "long" | "short";
type OrderType = "market" | "limit";

/** Digits and at most one dot, at most 2 decimals, bounded length — a plain amount, never an expression. */
const cleanAmount = (raw: string) => {
  const s = raw.replace(/[^0-9.]/g, "");
  const [head, ...rest] = s.split(".");
  const joined = rest.length ? `${head}.${rest.join("").slice(0, 2)}` : head;
  return joined.slice(0, 10);
};
const positive = (s: string) => {
  const n = Number(s);
  return s !== "" && Number.isFinite(n) && n > 0 ? n : null;
};
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function OrderPanel({ className = "" }: { className?: string }) {
  const sim = useSim();
  const [side, setSide] = useState<Side>("long");
  const [type, setType] = useState<OrderType>("market");
  const [size, setSize] = useState("10");
  const [leverage, setLeverage] = useState(1);
  const [limit, setLimit] = useState("");

  // Long buys at the best ask; Short sells at the best bid (both from the SIMULATED book).
  const bestAsk = sim.asks[2][0];
  const bestBid = sim.bids[0][0];
  const bookPrice = side === "long" ? bestAsk : bestBid;
  const limitPrice = positive(limit);
  const entry = type === "market" ? bookPrice : limitPrice;

  const sizeN = positive(size);
  const amount = sizeN !== null && entry !== null ? sizeN / entry : null;
  const orderValue = sizeN;
  const margin = sizeN !== null ? sizeN / leverage : null;

  const pickType = (t: OrderType) => {
    setType(t);
    // Start the limit field at the current simulated price of the side being traded, once.
    if (t === "limit" && limit === "") setLimit(bookPrice.toFixed(2));
  };

  const sideTab = (s: Side, label: string) => (
    <button
      type="button"
      data-side={s}
      aria-pressed={side === s}
      onClick={() => setSide(s)}
      className={`flex-1 cursor-pointer border-x-0 border-t-0 bg-transparent py-4 text-center font-serif text-base font-medium hover:text-term-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-gold ${
        side === s ? "border-b-2 border-gold text-gold" : "border-b-2 border-transparent text-term-faint"
      }`}
    >
      {label}
    </button>
  );
  const typeTab = (t: OrderType, label: string) => (
    <button type="button" data-order-type={t} aria-pressed={type === t} onClick={() => pickType(t)} className={`${tabBase} ${type === t ? tabActive : ""} flex-1 p-2.5 text-center`}>
      {label}
    </button>
  );

  return (
    <div className={`flex flex-col border-b border-term-line pb-5 lg:w-[300px] lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:pb-5 ${className}`}>
      <div className="flex border-b border-term-line">
        {sideTab("long", "Long")}
        {sideTab("short", "Short")}
      </div>
      <div className="flex flex-col gap-4 px-5 pt-5">
        <div className="flex gap-2.5">
          {typeTab("market", "MARKET")}
          {typeTab("limit", "LIMIT")}
        </div>

        {type === "limit" && (
          <div data-testid="limit-field">
            <label htmlFor="limit-price" className="font-mono text-[10px] text-term-faint">
              LIMIT PRICE
            </label>
            <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg border border-term-control px-3.5 py-3 focus-within:border-gold">
              <input
                id="limit-price"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={limit}
                onChange={(e) => setLimit(cleanAmount(e.target.value))}
                className="w-full min-w-0 border-none bg-transparent font-mono text-base text-term-text outline-none"
              />
              <span className="shrink-0 font-mono text-xs text-term-faint">USDC</span>
            </div>
            <div className="mt-1.5 font-mono text-[10px] leading-normal text-term-faint">
              Compared against the simulated book, nothing rests anywhere.
            </div>
          </div>
        )}

        <div>
          <label htmlFor="size" className="font-mono text-[10px] text-term-faint">
            SIZE
          </label>
          <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg border border-term-control px-3.5 py-3 focus-within:border-gold">
            <input
              id="size"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={size}
              onChange={(e) => setSize(cleanAmount(e.target.value))}
              className="w-full min-w-0 border-none bg-transparent font-mono text-base text-term-text outline-none"
            />
            <span className="shrink-0 font-mono text-xs text-term-faint">USDC</span>
          </div>
        </div>
        <div className="flex gap-2">
          {CHIPS.map((amt) => (
            <button
              key={amt}
              type="button"
              data-chip={amt}
              onClick={() => setSize(String(amt))}
              className={`${chipBase} min-w-0 flex-1 px-1 text-center ${sizeN === amt ? "border-gold text-gold" : "border-term-control text-term-text"}`}
            >
              ${amt}
            </button>
          ))}
        </div>

        <div>
          <div className="flex justify-between">
            <label htmlFor="leverage" className="font-mono text-[10px] text-term-faint">
              LEVERAGE
            </label>
            <Mono className="text-[10px] text-gold" data-testid="leverage-value">
              {leverage}x
            </Mono>
          </div>
          {/* A native range input: keyboard, touch and mouse all work; the 40px-tall hit area is a comfortable touch target. */}
          <input
            id="leverage"
            type="range"
            min={1}
            max={MAX_LEVERAGE}
            step={1}
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            aria-valuetext={`${leverage}x leverage`}
            className="mt-1 block h-10 w-full cursor-pointer accent-gold"
          />
          <div className="flex justify-between font-mono text-[10px] text-term-faint">
            <span>1x</span>
            <span>{MAX_LEVERAGE}x</span>
          </div>
        </div>

        <dl className="m-0 flex flex-col gap-2.5 border-t border-term-line pt-4 font-mono text-xs" data-testid="order-math">
          <div className="flex justify-between gap-3">
            <dt className="text-term-faint" data-testid="entry-label">
              {type === "limit" ? "Limit price" : side === "long" ? "Best Ask" : "Best Bid"}
            </dt>
            <dd className="m-0 text-term-text" data-testid="entry-price">{entry !== null ? `$${entry.toFixed(2)}` : ", "}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-term-faint">{side === "long" ? "You buy" : "You sell"} (≈ {ASSET})</dt>
            <dd className="m-0 text-term-text" data-testid="asset-amount">{amount !== null ? `${amount.toFixed(6)} ${ASSET}` : ", "}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-term-faint">Order Value</dt>
            <dd className="m-0 text-term-text" data-testid="order-value">{orderValue !== null ? usd(orderValue) : ", "}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-term-faint">Margin Required</dt>
            <dd className="m-0 text-term-text" data-testid="margin">{margin !== null ? usd(margin) : ", "}</dd>
          </div>
        </dl>
        {/* Secondary wallet button, as on xPrime's Trade page: the SAME ConnectWalletButton as the nav (same modal, same
            connected-state address chip) — not a separate implementation. It only connects; it places nothing. */}
        <ConnectWalletButton size="block" tone="dark" />
        <p className="m-0 font-mono text-[10px] leading-normal text-term-faint">
          {side === "long" ? "Long buys at the best ask" : "Short sells at the best bid"}
        </p>
      </div>
    </div>
  );
}
