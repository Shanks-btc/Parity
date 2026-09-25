import { Section } from "./Section";
import { SpecFirstCallout } from "./SpecFirstCallout";
import { StatusPanel } from "./StatusPanel";
import { VerificationLog } from "./VerificationLog";

/*
 * Pyth status as VERIFIED 2026-09-24 against Hermes with our API key (per-feed probe):
 *   - Crypto majors — BTC/USD, SOL/USD, USDC/USD: HTTP 200, live prices.
 *   - Equity.US.AAPL/USD, Equity.US.SPY/USD: 403.
 *   - Crypto.AAPLX/USD, Crypto.SPYX/USD (the xStocks' own feeds): 403 — "Not entitled … asset
 *     type 'crypto'". Pyth classes these as crypto, yet they're blocked too, so the mockup's
 *     blanket "Crypto feeds — Reachable" would have overstated it. Rows name what was checked.
 * Re-probe before changing these rows.
 *
 * This is the one place on the page where the honest status is stated as a table. It used to sit
 * inside the Why Pyth card, which now only explains the mechanism (see WhySolanaPyth.tsx).
 */
const PYTH_STATUS = [
  { label: "Crypto majors (BTC, SOL, USDC)", value: "Reachable, confirmed", tone: "positive" },
  { label: "Equity + xStock feeds", value: "Blocked — entitlement pending", tone: "clay" },
  { label: "Degradation path", value: "Built and tested", tone: "positive" },
] as const;

/**
 * #proof — the closing CTA's "View the proof" target. Holds the Pyth integration status, the
 * Verification Log and the spec-first callout. (The "Verified, not asserted" heading, subtitle and
 * the devnet / mainnet cards were removed on request; the devnet proof link remains in the footer.)
 */
export function Proof() {
  return (
    <Section id="proof" labelledBy="verification-log-title" className="bg-surface">
      <StatusPanel title="PYTH INTEGRATION STATUS" rows={[...PYTH_STATUS]} className="mb-6" />
      <VerificationLog />
      <SpecFirstCallout />
    </Section>
  );
}
