// Multiply constants shared by the dedicated /earn/multiply page and the Trade page's ETF tab, so the leverage a card
// advertises is the very constant the build request uses — one definition, nothing to drift.

// Multiply is only offered where Kamino runs a live Multiply market: SPYx and TSLAx. AAPLx has none, and the
// backend's capability check refuses it.
export const MULTIPLY_ASSETS = ["SPYx", "TSLAx"] as const;
export type MultiplyAsset = (typeof MULTIPLY_ASSETS)[number];
export const MIN_LEVERAGE = 1.1;
export const DEFAULT_LEVERAGE = 1.5; // the leverage the agent itself sizes to, and the one verified in simulation
export const HARD_CAP = 2.5;

/** Never offer more than 90% of the theoretical maximum leverage 1 / (1 − LTV), and never above the UI cap. */
export const maxLeverageFor = (ltvPct: number | null) => (ltvPct !== null ? Math.min(HARD_CAP, Math.floor((0.9 / (1 - ltvPct / 100)) * 10) / 10) : HARD_CAP);
