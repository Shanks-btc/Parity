import { Mono } from "../Mono";
import { LiveBook, LiveChartShapes, LiveStat } from "./LiveParts";
import { TimeframeTabs } from "./TradeControls";

// The interactive order ticket (Long/Short, Market/Limit, size, chips, leverage) lives in TradeControls.tsx.
export { OrderPanel } from "./TradeControls";

/*
 * Trade — CONCEPT ONLY (source: Trade.dc.html). No live equity-perp market exists on Solana, so
 * nothing here is wired to data or execution: every figure is illustrative. The controls (timeframe tabs, Long/Short,
 * Market/Limit, size, chips, leverage) are now interactive and do correct arithmetic — but only on the SIMULATED price,
 * and there is deliberately no order-submit action of any kind (see TradeControls.tsx).
 *
 * The ticker figures, chart line and orderbook are animated with SIMULATED data generated in the browser
 * (LiveParts.tsx / sim-store.ts): motion only, no requests, and none of it is real. Controls stay disabled.
 */

const tabActive = "rounded-md bg-term-raised text-term-text";

const TICKER_STATS = [
  { label: "MID", key: "mid" },
  { label: "MARK", key: "mark" },
  { label: "24H CHANGE", key: "change" },
  { label: "24H VOL", key: "vol" },
  { label: "FUNDING", key: "funding" },
] as const;

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
            <LiveStat k={s.key} />
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
        <TimeframeTabs />
      </div>

      {/* Same 620×260 drawing as the mockup; height follows width on narrow screens instead of
          leaving a fixed 260px box mostly empty. */}
      <svg
        viewBox="0 0 620 260"
        className="h-auto max-h-[260px] w-full"
        role="img"
        aria-label="Illustrative price chart, not live data"
      >
        <LiveChartShapes />
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

export function Orderbook({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-col px-4 py-5 lg:w-[300px] lg:shrink-0 lg:border-r lg:border-term-line ${className}`}>
      <div className="mb-3 font-mono text-xs text-term-text">Orderbook</div>
      <div className="mb-1.5 grid grid-cols-3 font-mono text-[10px] text-term-faint">
        <span>PRICE</span>
        <span className="text-right">SIZE</span>
        <span className="text-right">TOTAL</span>
      </div>
      <LiveBook />
    </div>
  );
}
