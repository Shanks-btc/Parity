"use client";

import { useSyncExternalStore } from "react";
import { Mono } from "../Mono";
import { chartGeometry, fmt, getServerSnapshot, getSnapshot, subscribe, type SimState } from "./sim-store";

/*
 * Client-side leaves for the Trade concept page. They render the SIMULATED market from sim-store (random-walk data
 * generated in the browser — no network, nothing real). They are display-only: no handlers, no inputs. The page's
 * interactive-looking controls stay `disabled` in TradeConcept.tsx, exactly as before.
 */
const useSim = (): SimState => useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

export function LiveStat({ k }: { k: "mid" | "mark" | "change" | "vol" | "funding" }) {
  const s = useSim();
  const tone = k === "change" ? (s.change < 0 ? "text-clay" : "text-gold") : k === "funding" ? "text-gold" : "text-term-text";
  return (
    <Mono as="div" data-sim-stat={k} className={`text-[15px] ${tone}`}>
      {fmt[k](s)}
    </Mono>
  );
}

/**
 * Candlestick chart (the surrounding <svg> keeps its original attributes and aria-label): real OHLC bodies + wicks
 * drawn from the simulated data, up candles in gold and down candles in clay — this app's existing positive/negative
 * convention (the same colors the 24H-change figure and the order-flow tape already use), not literal green/red.
 * A handful of evenly-spaced price gridlines run along the right edge, plus a dashed line at the current price.
 */
export function LiveChartShapes() {
  const s = useSim();
  const g = chartGeometry(s.candles[s.tf]);
  return (
    <g data-sim-chart data-tf={s.tf}>
      {g.levels.map((lv) => (
        <g key={lv.y} data-testid="chart-grid-level">
          <line x1="0" y1={lv.y} x2={580} y2={lv.y} className="stroke-term-line" strokeDasharray="2 4" />
          <text x={586} y={lv.y + 3} className="fill-term-faint font-mono" fontSize="9">
            {lv.price.toFixed(2)}
          </text>
        </g>
      ))}
      <line x1="0" y1={g.currentY} x2={580} y2={g.currentY} className="stroke-gold/50" strokeDasharray="4 4" data-testid="chart-current-line" />
      {g.candles.map((c, i) => (
        <g key={i} data-testid="chart-candle" data-up={c.up} className={c.up ? "fill-gold stroke-gold" : "fill-clay stroke-clay"}>
          <line x1={c.x} y1={c.wickTop} x2={c.x} y2={c.wickBottom} strokeWidth="1" />
          <rect x={c.x - c.width / 2} y={c.bodyTop} width={c.width} height={Math.max(1, c.bodyBottom - c.bodyTop)} />
        </g>
      ))}
    </g>
  );
}

const n0 = (n: number) => n.toLocaleString("en-US");

function Rows({ rows }: { rows: [number, number][] }) {
  const totals = rows.reduce<number[]>((acc, [, size]) => [...acc, (acc.at(-1) ?? 0) + size], []);
  return (
    <>
      {rows.map(([price, size], i) => (
        <div key={price.toFixed(2)} className="grid grid-cols-3">
          <span>{price.toFixed(2)}</span>
          <span className="text-right text-term-muted">{n0(size)}</span>
          <span className="text-right text-term-muted">{n0(totals[i])}</span>
        </div>
      ))}
    </>
  );
}

/** Orderbook body: asks, spread, bids — then a scrolling tape of simulated fills. */
export function LiveBook() {
  const s = useSim();
  const spread = s.asks[2][0] - s.bids[0][0];
  return (
    <>
      <Mono as="div" data-sim-asks className="text-xs leading-[1.9] text-clay">
        <Rows rows={s.asks} />
      </Mono>
      <div className="my-1.5 border-y border-term-line py-2 text-center font-mono text-[11px] text-term-faint">
        Spread {spread.toFixed(2)} ({((spread / s.mark) * 100).toFixed(3)}%)
      </div>
      <Mono as="div" data-sim-bids className="text-xs leading-[1.9] text-gold">
        <Rows rows={s.bids} />
      </Mono>

      <div className="mt-5 border-t border-term-line pt-3">
        <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] text-term-faint">
          <span>SIMULATED ORDER FLOW</span>
          <span>generated in your browser</span>
        </div>
        <div className="grid grid-cols-3 font-mono text-[10px] text-term-faint">
          <span>PRICE</span>
          <span className="text-right">SIZE</span>
          <span className="text-right">TIME</span>
        </div>
        <Mono as="div" data-sim-tape className="min-h-[9lh] overflow-hidden text-xs leading-[1.9]" aria-hidden="true">
          {s.trades.map((t) => (
            <div key={t.id} className={`tape-row grid grid-cols-3 ${t.side === "buy" ? "text-gold" : "text-clay"}`}>
              <span>{t.price.toFixed(2)}</span>
              <span className="text-right text-term-muted">{t.size}</span>
              <span className="text-right text-term-muted">{t.time}</span>
            </div>
          ))}
        </Mono>
      </div>
    </>
  );
}
