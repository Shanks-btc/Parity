"use client";

import { useEffect, useState } from "react";
import { Mono } from "../Mono";

/**
 * The one REAL number on the Trade concept page: a live US stock price from Finnhub (via /api/trade/quote), shown in its
 * own band under the simulated ticker with its own "REAL DATA" label — never mixed into the simulated MID/MARK/… bar,
 * the chart, the orderbook or the order flow, which are all still simulated. It always says whether the market is open:
 * that comes from Finnhub's own market-status response, not from a guess about the clock.
 */
interface Quote {
  symbol: string;
  price: number;
  change: number | null;
  changePercent: number | null;
  quoteTime: number;
  market: { isOpen: boolean; session: string | null; holiday: string | null; timezone: string; exchange: string };
  fetchedAt: string;
  /** Set by the route when Finnhub couldn't answer and it served its last good quote instead. */
  stale?: boolean;
  staleSeconds?: number;
}
/**
 * `quote` is the last good quote and is KEPT when a later refresh fails (a slow Finnhub must not wipe a real price off
 * the page); `problem` then says why it could not be refreshed. Only with no quote at all does the band show an error.
 */
type State = { status: "loading" } | { status: "ready"; quote: Quote; problem: string | null } | { status: "error"; error: string };

const POLL_MS = 25_000; // free tier is 60 calls/min and the price only needs to feel current
const RETRY_MS = 6_000; // after a failed refresh, try again sooner than the normal cadence

/** What the price is, in Finnhub's own terms. Open ⇒ moving now; anything else ⇒ frozen at the last close. */
export function marketNote(m: Quote["market"]): { text: string; live: boolean } {
  if (m.isOpen) return { text: "market open", live: true };
  const why = m.holiday ? `market closed, ${m.holiday}` : m.session === "pre-market" ? "market closed, pre-market session" : m.session === "post-market" ? "market closed, after-hours session" : "market closed";
  return { text: `${why}, last close`, live: false };
}

export function RealQuote({ symbol = "AAPL" }: { symbol?: string }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let ok = false;
      if (!document.hidden) {
        // (a hidden tab skips the call — no quota spent in the background)
        try {
          const res = await fetch(`/api/trade/quote?symbol=${symbol}`, { cache: "no-store" });
          const body = await res.json().catch(() => null);
          if (!alive) return;
          if (res.ok) {
            ok = true;
            setState({ status: "ready", quote: body, problem: null });
          } else {
            const problem = res.status === 504 ? "Finnhub is slow to respond" : (body?.error ?? `request failed (${res.status})`);
            setState((prev) => (prev.status === "ready" ? { ...prev, problem } : { status: "error", error: problem }));
          }
        } catch {
          if (!alive) return;
          setState((prev) => (prev.status === "ready" ? { ...prev, problem: "could not reach the price service" } : { status: "error", error: "could not reach the price service" }));
        }
      } else ok = true;
      if (alive) timer = setTimeout(load, ok ? POLL_MS : RETRY_MS);
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [symbol]);

  const q = state.status === "ready" ? state.quote : null;
  const problem = state.status === "ready" ? state.problem : null;
  const note = q ? marketNote(q.market) : null;
  const up = q && q.change !== null ? q.change >= 0 : null;

  // No quote (still loading, or unavailable for any reason, e.g. no key configured): show nothing at all, not even a band.
  if (!q || !note) return null;

  return (
    <div className="border-b border-term-line bg-charcoal" data-testid="real-quote">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 md:px-10">
        <>
            <span className="font-mono text-xs text-term-muted" data-testid="real-quote-text">
              Live price:{" "}
              <Mono className="text-[15px] text-term-text" data-testid="real-quote-price">
                ${q.price.toFixed(2)}
              </Mono>{" "}
              <span data-testid="real-quote-market" className={note.live ? "text-positive" : "text-gold"}>
                ({note.text})
              </span>
            </span>
            {(q.stale || problem) && (
              <span className="font-mono text-[11px] text-gold" role="status" data-testid="real-quote-delayed">
                {q.stale && q.staleSeconds !== undefined ? `refresh delayed, showing the last quote from ${q.staleSeconds < 90 ? `${q.staleSeconds}s` : `${Math.round(q.staleSeconds / 60)} min`} ago` : `couldn't refresh (${problem}), showing the last quote`}
              </span>
            )}
            {q.change !== null && q.changePercent !== null && (
              <Mono className={`text-xs ${up ? "text-positive" : "text-clay"}`} data-testid="real-quote-change">
                {up ? "+" : "−"}${Math.abs(q.change).toFixed(2)} ({up ? "+" : "−"}{Math.abs(q.changePercent).toFixed(2)}%) on the day
              </Mono>
            )}
        </>
      </div>
    </div>
  );
}
