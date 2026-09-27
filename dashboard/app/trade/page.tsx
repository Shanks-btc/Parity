import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { RealQuote } from "@/components/trade/RealQuote";
import {
  ChartPanel,
  OrderPanel,
  Orderbook,
  TickerBar,
} from "@/components/trade/TradeConcept";

export const metadata: Metadata = {
  title: "Parity, Trade (Concept)",
  description: "Concept preview of Parity's Trade screen. No live equity-perp market exists on Solana yet.",
};

/**
 * Dark terminal-style concept page. Desktop (lg+): chart | orderbook | long/short, filling the
 * viewport (at least the mockup's 900px). Below lg the columns stack as chart → long/short →
 * orderbook: DOM order is the mobile order, and lg:order-* restores the desktop arrangement.
 */
export default function TradeConceptPage() {
  return (
    <div className="flex min-h-screen flex-col bg-charcoal font-serif lg:h-screen lg:min-h-[900px] lg:overflow-hidden">
      <SiteNav tone="dark" active="trade" action={<ConnectWalletButton tone="dark" />} />
      <TickerBar />
      {/* The only real number on this page — its own band, labelled REAL DATA; everything else here is simulated. */}
      <RealQuote symbol="AAPL" />
      <main className="mx-auto flex w-full max-w-[1440px] flex-col lg:flex-1 lg:flex-row lg:overflow-hidden">
        <ChartPanel />
        <OrderPanel className="lg:order-3" />
        <Orderbook className="lg:order-2" />
      </main>
    </div>
  );
}
