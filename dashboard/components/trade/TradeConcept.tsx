import { Mono } from "../Mono";
import { LockIcon } from "../icons";

/*
 * Trade — CONCEPT ONLY (source: Trade.dc.html). No live equity-perp market exists on Solana, so
 * nothing here is wired to data or execution: every figure is illustrative, inputs are disabled,
 * and no control has a click handler that pretends to do something. Every control that looks
 * interactive is `disabled` (which also removes it from the tab order) with a not-allowed cursor.
 * The notice banner and these disabled states are load-bearing for honesty — keep them.
 */

// Tabs keep their mockup look (the "1H"/"MARKET"/"Long" selection is part of the illustration)
// but are disabled like every other control here.
const tab =
  "cursor-not-allowed border-none bg-transparent px-2.5 py-1.5 font-mono text-[11px] tracking-[0.04em] text-term-faint";
const tabActive = "rounded-md bg-term-raised text-term-text";
const chipBase = "rounded-md border border-term-control bg-term-surface px-3.5 py-2 font-mono text-[13px] text-term-text";
const chip = `cursor-not-allowed ${chipBase}`;

export function ConceptNotice() {
  return (
    <div role="note" className="border-b border-term-line bg-term-surface">
      <div className="mx-auto flex max-w-[1440px] items-start gap-2 px-4 py-2.5 md:items-center md:px-10">
        <span className="mt-[5px] inline-block size-1.5 shrink-0 rounded-full bg-clay md:mt-0" />
        <span className="font-mono text-xs text-term-muted">
          Concept preview — no live equity-perp market exists on Solana yet. Not wired to real data or execution.
        </span>
      </div>
    </div>
  );
}

const TICKER_STATS = [
  { label: "MID", value: "$339.02", tone: "text-term-text" },
  { label: "MARK", value: "$339.10", tone: "text-term-text" },
  { label: "24H CHANGE", value: "-0.42%", tone: "text-clay" },
  { label: "24H VOL", value: "$18.20M", tone: "text-term-text" },
  { label: "FUNDING", value: "0.00041%", tone: "text-gold" },
];

export function TickerBar() {
  return (
    <div className="border-b border-term-line">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 md:px-10 lg:gap-x-12">
        <div className="flex w-full items-center gap-2.5 sm:w-auto">
          <div className="flex size-8 items-center justify-center rounded-full bg-term-raised font-serif font-semibold text-term-text">
            A
          </div>
          <div>
            <div className="font-serif text-base font-semibold text-term-text">AAPLx</div>
            <div className="font-mono text-[11px] text-term-faint">Apple Inc.</div>
          </div>
        </div>
        {TICKER_STATS.map((s) => (
          <div key={s.label}>
            <div className="font-mono text-[10px] text-term-faint">{s.label}</div>
            <Mono as="div" className={`text-[15px] ${s.tone}`}>
              {s.value}
            </Mono>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChartPanel() {
  return (
    <div className="flex flex-col border-b border-term-line px-4 py-5 md:px-6 lg:flex-[1.6] lg:border-b-0 lg:border-r">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Mono as="div" className="text-[13px] text-term-text">
          AAPLx/USDC
        </Mono>
        <div className="flex gap-1">
          {["1m", "5m", "1H", "4H", "1D"].map((tf) => (
            <button key={tf} type="button" disabled className={`${tab} ${tf === "1H" ? tabActive : ""}`}>
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Same 620×260 drawing as the mockup; height follows width on narrow screens instead of
          leaving a fixed 260px box mostly empty. */}
      <svg
        viewBox="0 0 620 260"
        className="h-auto max-h-[260px] w-full"
        role="img"
        aria-label="Illustrative price chart, not live data"
      >
        <line x1="0" y1="90" x2="620" y2="90" className="stroke-term-line" strokeDasharray="4 4" />
        <polyline
          points="0,180 60,190 120,175 180,140 240,150 300,110 360,95 420,88 480,92 540,80 600,86"
          fill="none"
          className="stroke-gold"
          strokeWidth="2"
        />
      </svg>

      <div className="mt-5 flex gap-6 border-b border-term-line pb-3">
        <span className={`px-1 py-1.5 font-mono text-[11px] tracking-[0.04em] ${tabActive}`}>POSITIONS</span>
        <span className="px-1 py-1.5 font-mono text-[11px] tracking-[0.04em] text-term-faint">ORDERS</span>
        <span className="px-1 py-1.5 font-mono text-[11px] tracking-[0.04em] text-term-faint">TRADE HISTORY</span>
      </div>
      <div className="flex flex-grow flex-col items-center justify-center gap-1.5 py-10 lg:py-0">
        <div className="font-serif text-[17px] text-term-text">No open positions</div>
        <div className="font-mono text-xs text-term-faint">This market isn&apos;t live yet</div>
      </div>
    </div>
  );
}

const ASKS = [
  ["339.14", "412", "412"],
  ["339.12", "870", "1,282"],
  ["339.10", "205", "1,487"],
];
const BIDS = [
  ["339.08", "560", "560"],
  ["339.06", "318", "878"],
  ["339.04", "944", "1,822"],
];

function BookRows({ rows }: { rows: string[][] }) {
  return (
    <>
      {rows.map(([price, size, total]) => (
        <div key={price} className="grid grid-cols-3">
          <span>{price}</span>
          <span className="text-right text-term-muted">{size}</span>
          <span className="text-right text-term-muted">{total}</span>
        </div>
      ))}
    </>
  );
}

export function Orderbook({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-col px-4 py-5 lg:w-[300px] lg:shrink-0 lg:border-r lg:border-term-line ${className}`}>
      <div className="mb-3 font-mono text-xs text-term-text">Orderbook</div>
      <div className="mb-1.5 grid grid-cols-3 font-mono text-[10px] text-term-faint">
        <span>PRICE</span>
        <span className="text-right">SIZE</span>
        <span className="text-right">TOTAL</span>
      </div>
      <Mono as="div" className="text-xs leading-[1.9] text-clay">
        <BookRows rows={ASKS} />
      </Mono>
      <div className="my-1.5 border-y border-term-line py-2 text-center font-mono text-[11px] text-term-faint">
        Spread 0.02 (0.006%)
      </div>
      <Mono as="div" className="text-xs leading-[1.9] text-gold">
        <BookRows rows={BIDS} />
      </Mono>
    </div>
  );
}

export function OrderPanel({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-col border-b border-term-line pb-5 lg:w-[300px] lg:shrink-0 lg:border-b-0 lg:pb-0 ${className}`}>
      <div className="flex border-b border-term-line">
        <button type="button" disabled className="flex-1 cursor-not-allowed border-b-2 border-gold bg-transparent py-4 text-center font-serif text-base font-medium text-gold">
          Long
        </button>
        <button type="button" disabled className="flex-1 cursor-not-allowed border-none bg-transparent py-4 text-center font-serif text-base font-medium text-term-faint">
          Short
        </button>
      </div>
      <div className="flex flex-col gap-4 px-5 pt-5">
        <div className="flex items-start gap-2.5 rounded-lg border border-term-line bg-term-surface p-3.5">
          <LockIcon className="mt-0.5 shrink-0 text-term-muted" />
          <div className="font-mono text-xs leading-normal text-term-muted">
            No live market to trade against yet. This screen shows the intended shape of Trade once equity-perp
            infrastructure exists on Solana.
          </div>
        </div>
        <div className="flex gap-2.5">
          <button type="button" disabled className={`${tab} ${tabActive} flex-1 p-2.5 text-center`}>
            MARKET
          </button>
          <button type="button" disabled className={`${tab} flex-1 p-2.5 text-center`}>
            LIMIT
          </button>
        </div>
        <div>
          <label htmlFor="size" className="font-mono text-[10px] text-term-faint">
            SIZE
          </label>
          <div className="mt-1.5 flex items-center justify-between rounded-lg border border-term-control px-3.5 py-3">
            <input
              id="size"
              type="text"
              defaultValue="10"
              disabled
              className="w-20 cursor-not-allowed border-none bg-transparent font-mono text-base text-term-text outline-none"
            />
            <span className="font-mono text-xs text-term-faint">USDC</span>
          </div>
        </div>
        <div className="flex gap-2">
          {["$10", "$25", "$50"].map((amt) => (
            <button key={amt} type="button" disabled className={`${chip} flex-1 text-center`}>
              {amt}
            </button>
          ))}
        </div>
        <div>
          <div className="flex justify-between">
            <span className="font-mono text-[10px] text-term-faint">LEVERAGE</span>
            <Mono className="text-[10px] text-gold">1x</Mono>
          </div>
          <div className="relative mt-2.5 h-1 rounded-sm bg-term-raised" aria-hidden="true">
            <div className="absolute -top-1 left-0 size-3 rounded-full bg-gold" />
          </div>
        </div>
      </div>
    </div>
  );
}
