import { ScrollReveal } from "@/components/ScrollReveal";
import { SiteNav } from "@/components/SiteNav";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { Capabilities } from "@/components/landing/Capabilities";
import { ClosingCTA } from "@/components/landing/ClosingCTA";
import { FAQ } from "@/components/landing/FAQ";
import { Footer } from "@/components/landing/Footer";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { MarketSection } from "@/components/landing/MarketSection";
import { Problem } from "@/components/landing/Problem";
import { Proof } from "@/components/landing/Proof";
import { Strategies } from "@/components/landing/Strategies";
import { WhySolanaPyth } from "@/components/landing/WhySolanaPyth";

/** Landing page — the light "financial paper" front door (source: Main.dc.html). */
export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <SiteNav tone="light" action={<ConnectWalletButton />} />
      <main>
        <Hero />
        <Problem />
        <Strategies />
        <HowItWorks />
        <Capabilities />
        <WhySolanaPyth />
        <MarketSection />
        <Proof />
        <FAQ />
        <ClosingCTA />
      </main>
      <Footer />
      <ScrollReveal />
    </div>
  );
}
