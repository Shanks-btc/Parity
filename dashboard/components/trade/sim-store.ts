/**
 * SIMULATED market for the Trade concept page. Every number here is generated in the visitor's browser by a random
 * walk — no request is made to anything, and none of it is real (no equity-perp market exists on Solana yet; the
 * page has no live market behind it). It exists only so the demo screen feels alive.
 *
 * The INITIAL state reproduces the page's original static figures exactly, so server-rendered HTML is unchanged;
 * ticking starts only after the component mounts in a browser, and not at all for visitors who prefer reduced motion.
 */

export interface Trade {
  id: number;
  time: string;
  price: number;
  size: number;
  side: "buy" | "sell";
}

export const TIMEFRAMES = ["1m", "5m", "15m", "1H", "4H", "1D"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/** One OHLC candle. */
export interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface SimState {
  mid: number;
  mark: number;
  /** vs. the fixed session-open reference below. */
  change: number;
  volM: number;
  funding: number;
  /** Selected chart timeframe (the page opens on 1H, as the original static mockup did). */
  tf: Timeframe;
  /** One simulated candle series per timeframe (oldest first); the chart shows candles[tf]. */
  candles: Record<Timeframe, Candle[]>;
  /** Display order: the far level first, best (inside) level last — as in the original static book. */
  asks: [number, number][];
  bids: [number, number][];
  trades: Trade[];
}

const OPEN_REF = 340.45; // makes the initial change round to -0.42%
const MID0 = 339.02;
const TICK_MS = 700;
const MAX_HISTORY = 41;
const MAX_TRADES = 9;

const round2 = (n: number) => Math.round(n * 100) / 100;

function build(mid: number, sizes: { asks: number[]; bids: number[] }): Pick<SimState, "mark" | "asks" | "bids"> {
  const mark = round2(mid + 0.08);
  // best ask = mark, best bid = mark - 0.02 (spread 0.02, as the original book), then 0.02 steps outward.
  const asks = [2, 1, 0].map((i, k) => [round2(mark + i * 0.02), sizes.asks[k]] as [number, number]);
  const bids = [0, 1, 2].map((i, k) => [round2(mark - 0.02 - i * 0.02), sizes.bids[k]] as [number, number]);
  return { mark, asks, bids };
}

/** Minutes per candle, and how many live ticks pass before a new candle opens (1H rolls every tick, as before). */
const TF_MINUTES: Record<Timeframe, number> = { "1m": 1, "5m": 5, "15m": 15, "1H": 60, "4H": 240, "1D": 1440 };
const ROLL_EVERY: Record<Timeframe, number> = { "1m": 2, "5m": 4, "15m": 7, "1H": 1, "4H": 12, "1D": 24 };

/** Small seeded PRNG so each timeframe's simulated history is stable (and identical on server and client). */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A simulated series of CLOSES for one timeframe: a random walk whose step size grows with the candle length, ending at MID0. */
function backfillCloses(tf: Timeframe): number[] {
  const rand = mulberry32(TF_MINUTES[tf] * 7919);
  const sigma = 0.05 * Math.sqrt(TF_MINUTES[tf]);
  let p = 0;
  const walk = Array.from({ length: MAX_HISTORY }, () => (p += (rand() + rand() + rand() - 1.5) * 1.6 * sigma - p * 0.03));
  const shift = MID0 - walk[walk.length - 1];
  return walk.map((v) => v + shift);
}

/**
 * Turns a series of closes into OHLC candles: each candle's open is the previous candle's close (a continuous chain,
 * as real bars are), and each gets a small random wick beyond its body so backfilled history doesn't look artificially
 * square. `rand` is seeded so the wick shape is stable across server and client renders of the same timeframe.
 */
function toCandles(closes: number[], rand: () => number): Candle[] {
  return closes.map((c, i) => {
    const o = i === 0 ? c + (rand() - 0.5) * 0.1 : closes[i - 1];
    const bodyHi = Math.max(o, c), bodyLo = Math.min(o, c);
    const wick = (bodyHi - bodyLo + 0.02) * (0.3 + rand() * 0.9);
    return { o, h: bodyHi + wick * rand(), l: bodyLo - wick * rand(), c };
  });
}

const INITIAL_CANDLES = Object.fromEntries(
  TIMEFRAMES.map((tf) => [tf, toCandles(backfillCloses(tf), mulberry32(TF_MINUTES[tf] * 104729))])
) as Record<Timeframe, Candle[]>;

const INITIAL: SimState = {
  mid: MID0,
  change: (MID0 - OPEN_REF) / OPEN_REF,
  volM: 18.2,
  funding: 0.00041,
  tf: "1H",
  candles: INITIAL_CANDLES,
  trades: [],
  ...build(MID0, { asks: [412, 870, 205], bids: [560, 318, 944] }),
};

let state = INITIAL;
let seq = 0;
let ticks = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.6;
const jitterSize = (n: number) => Math.max(60, Math.round(n * (1 + (Math.random() - 0.5) * 0.3)));

function clock(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function tick() {
  if (typeof document !== "undefined" && document.hidden) return;
  const s = state;
  const mid = Math.min(MID0 + 3, Math.max(MID0 - 3, s.mid + gauss() * 0.07 + (MID0 - s.mid) * 0.02));
  const b = build(mid, { asks: s.asks.map(([, n]) => jitterSize(n)), bids: s.bids.map(([, n]) => jitterSize(n)) });

  const trades = [...s.trades];
  let volAdd = 0;
  for (let i = 0, n = Math.random() < 0.3 ? 2 : 1; i < n; i++) {
    if (Math.random() < 0.85) {
      const side: Trade["side"] = Math.random() < 0.5 ? "buy" : "sell";
      const size = 5 + Math.floor(Math.random() * 300);
      const price = side === "buy" ? b.asks[2][0] : b.bids[0][0];
      trades.unshift({ id: ++seq, time: clock(), price, size, side });
      volAdd += (size * price * 0.15) / 1e6;
    }
  }

  ticks++;
  const candles = Object.fromEntries(
    TIMEFRAMES.map((tf) => {
      const prev = s.candles[tf];
      const last = prev[prev.length - 1];
      // Roll a new candle every ROLL_EVERY ticks (open = the previous candle's close); in between, the forming
      // candle's high/low/close follow the live simulated price while its open stays fixed.
      if (ticks % ROLL_EVERY[tf] === 0) {
        const next = [...prev, { o: last.c, h: Math.max(last.c, mid), l: Math.min(last.c, mid), c: mid }];
        if (next.length > MAX_HISTORY) next.shift();
        return [tf, next];
      }
      const updated: Candle = { o: last.o, h: Math.max(last.h, mid), l: Math.min(last.l, mid), c: mid };
      return [tf, [...prev.slice(0, -1), updated]];
    })
  ) as Record<Timeframe, Candle[]>;

  state = {
    mid,
    mark: b.mark,
    change: (mid - OPEN_REF) / OPEN_REF,
    volM: s.volM + volAdd,
    funding: 0.00041 + Math.sin(Date.now() / 9000) * 0.00003,
    tf: s.tf,
    candles,
    asks: b.asks,
    bids: b.bids,
    trades: trades.slice(0, MAX_TRADES),
  };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer && typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    timer = setInterval(tick, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Switches which simulated series the chart shows. Works with or without ticking (reduced motion included). */
export function setTimeframe(tf: Timeframe) {
  if (state.tf === tf) return;
  state = { ...state, tf };
  listeners.forEach((l) => l());
}

export const getSnapshot = () => state;
export const getServerSnapshot = () => INITIAL;

// ---- formatting (the initial values render to exactly the original static strings) ----
export const fmt = {
  mid: (s: SimState) => `$${s.mid.toFixed(2)}`,
  mark: (s: SimState) => `$${s.mark.toFixed(2)}`,
  change: (s: SimState) => `${s.change < 0 ? "-" : "+"}${Math.abs(s.change * 100).toFixed(2)}%`,
  vol: (s: SimState) => `$${s.volM.toFixed(2)}M`,
  funding: (s: SimState) => `${s.funding.toFixed(5)}%`,
};

// ---- candlestick geometry for the fixed 620×260 drawing (0..580 plotted, 580..620 reserved for axis labels) ----
const PLOT_W = 580;
const PAD_TOP = 6;
const PAD_BOTTOM = 6;
const PLOT_H = 260 - PAD_TOP - PAD_BOTTOM;
const GRID_LEVELS = 5;

export interface CandleGeom {
  x: number;
  width: number;
  up: boolean;
  bodyTop: number;
  bodyBottom: number;
  wickTop: number;
  wickBottom: number;
}
export interface GridLevel {
  y: number;
  price: number;
}
export interface ChartGeometry {
  candles: CandleGeom[];
  levels: GridLevel[];
  currentY: number;
}

/**
 * Lays out one timeframe's candles inside the fixed drawing: the domain (price range) is fit to that timeframe's own
 * high/low across its visible candles, so every timeframe fills the same box regardless of its price range. Also
 * returns a handful of evenly-spaced price gridlines across that same domain, for the axis labels on the right.
 */
export function chartGeometry(candles: Candle[]): ChartGeometry {
  const lo = Math.min(...candles.map((c) => c.l));
  const hi = Math.max(...candles.map((c) => c.h));
  const pad = Math.max(hi - lo, 0.05) * 0.08;
  const domainLo = lo - pad, domainHi = hi + pad, span = domainHi - domainLo;
  const yOf = (price: number) => PAD_TOP + (1 - (price - domainLo) / span) * PLOT_H;

  const slot = PLOT_W / candles.length;
  const width = Math.max(2, slot * 0.62);
  const geoCandles = candles.map((c, i) => ({
    x: i * slot + slot / 2,
    width,
    up: c.c >= c.o,
    bodyTop: yOf(Math.max(c.o, c.c)),
    bodyBottom: yOf(Math.min(c.o, c.c)),
    wickTop: yOf(c.h),
    wickBottom: yOf(c.l),
  }));

  const levels = Array.from({ length: GRID_LEVELS }, (_, i) => {
    const price = domainHi - (i / (GRID_LEVELS - 1)) * span;
    return { y: yOf(price), price };
  });

  return { candles: geoCandles, levels, currentY: yOf(candles[candles.length - 1].c) };
}
