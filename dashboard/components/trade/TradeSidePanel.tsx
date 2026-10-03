"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MULTIPLY_ASSETS, type MultiplyAsset } from "@/lib/multiply";
import { SwapPanel } from "../swap/SwapPanel";
import { EtfPanel } from "./EtfPanel";
import { OrderPanel } from "./TradeControls";

type Mode = "perp" | "spot" | "etf";

/**
 * The Trade page's right-hand column. Default is the existing Long/Short panel, untouched. `?mode=spot` swaps in the
 * real swap panel and `?mode=etf` the Multiply ETF cards (SPYx / TSLAx) in the same column; a compact
 * Perp | Spot | ETF switch sits above it. Nothing else on the page (ticker, chart, orderbook, order flow) reads this mode.
 */
export function TradeSidePanel({ className = "" }: { className?: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const modeParam = params.get("mode");
  const mode: Mode = modeParam === "spot" ? "spot" : modeParam === "etf" ? "etf" : "perp";
  const assetParam = params.get("asset") ?? "";
  const etfAsset = (MULTIPLY_ASSETS as readonly string[]).includes(assetParam) ? (assetParam as MultiplyAsset) : null;

  const go = (next: URLSearchParams) => {
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const setMode = (m: Mode) => {
    const next = new URLSearchParams(params.toString());
    if (m === "perp") {
      next.delete("mode");
      next.delete("from");
      next.delete("pay");
      next.delete("next");
    } else {
      next.set("mode", m);
      if (m === "etf") {
        // The swap handoff params and a non-Multiply asset (AAPLx) mean nothing here.
        next.delete("from");
        next.delete("pay");
        next.delete("next");
        if (!MULTIPLY_ASSETS.includes(next.get("asset") as MultiplyAsset)) next.delete("asset");
      }
    }
    go(next);
  };
  const pickEtfAsset = (a: MultiplyAsset | null) => {
    const next = new URLSearchParams(params.toString());
    if (a) next.set("asset", a);
    else next.delete("asset");
    go(next);
  };
  const tab = (m: Mode, label: string) => {
    const on = m === mode;
    return (
      <button type="button" data-trade-mode={m} aria-pressed={on} onClick={() => setMode(m)} className={`min-h-[28px] cursor-pointer border-none px-3 py-1 font-mono text-[11px] tracking-[0.04em] focus-visible:outline focus-visible:outline-1 focus-visible:outline-gold ${on ? "rounded-md bg-term-raised text-term-text" : "bg-transparent text-term-faint hover:text-term-text"}`}>
        {label}
      </button>
    );
  };

  return (
    <div className={`flex flex-col lg:w-[300px] lg:min-h-0 lg:shrink-0 ${className}`}>
      <div className="flex gap-1 border-b border-term-line px-5 py-1.5" role="group" aria-label="Trade mode" data-testid="trade-mode-switch">
        {tab("perp", "Perp")}
        {tab("spot", "Spot")}
        {tab("etf", "ETF")}
      </div>
      {mode === "etf" ? (
        <EtfPanel asset={etfAsset} onPick={pickEtfAsset} className="lg:min-h-0 lg:flex-1" />
      ) : mode === "spot" ? (
        <SwapPanel key={params.get("asset") ?? "default"} initialAsset={params.get("asset")} initialPay={params.get("pay")} from={params.get("from")} next={params.get("next")} className="lg:min-h-0 lg:flex-1" />
      ) : (
        <OrderPanel className="lg:min-h-0 lg:flex-1" />
      )}
    </div>
  );
}
