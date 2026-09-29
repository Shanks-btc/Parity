"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SwapPanel } from "../swap/SwapPanel";
import { OrderPanel } from "./TradeControls";

/**
 * The Trade page's right-hand column. Default is the existing Long/Short panel, untouched. `?mode=spot` swaps in the
 * real swap panel in the same column; a compact Perp | Spot switch sits above it so the swap is reachable from the
 * Trade nav link too. Nothing else on the page (ticker, chart, orderbook, order flow) reads this mode.
 */
export function TradeSidePanel({ className = "" }: { className?: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const spot = params.get("mode") === "spot";

  const setMode = (mode: "perp" | "spot") => {
    const next = new URLSearchParams(params.toString());
    if (mode === "spot") next.set("mode", "spot");
    else {
      next.delete("mode");
      next.delete("from");
      next.delete("pay");
      next.delete("next");
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const tab = (m: "perp" | "spot", label: string) => {
    const on = (m === "spot") === spot;
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
      </div>
      {spot ? (
        <SwapPanel key={params.get("asset") ?? "default"} initialAsset={params.get("asset")} initialPay={params.get("pay")} from={params.get("from")} next={params.get("next")} className="lg:min-h-0 lg:flex-1" />
      ) : (
        <OrderPanel className="lg:min-h-0 lg:flex-1" />
      )}
    </div>
  );
}
