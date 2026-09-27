import { HttpError } from "./parity";

export const GOALS = ["yield", "borrow"] as const;
export const ASSETS = ["AAPLx", "SPYx", "TSLAx"] as const;
export const OUTLOOKS = ["bullish", "bearish", "volatile", "neutral"] as const;
export const RISKS = ["extra-conservative", "low", "moderate", "high"] as const;

export type Goal = (typeof GOALS)[number];
export type Asset = (typeof ASSETS)[number];
export type Outlook = (typeof OUTLOOKS)[number];
export type Risk = (typeof RISKS)[number];

export interface WizardAnswers {
  goal: Goal;
  asset: Asset;
  outlook: Outlook;
  risk: Risk;
}

const pick = <T extends readonly string[]>(list: T, v: unknown, name: string): T[number] => {
  if (typeof v !== "string" || !list.includes(v)) throw new HttpError(400, `${name} must be one of ${list.join(", ")}.`);
  return v;
};

/** Only whitelisted enum values get through, so nothing user-typed ever reaches the agent's prompt. */
export function parseAnswers(raw: unknown): WizardAnswers {
  const b = (raw ?? {}) as Record<string, unknown>;
  return { goal: pick(GOALS, b.goal, "goal"), asset: pick(ASSETS, b.asset, "asset"), outlook: pick(OUTLOOKS, b.outlook, "outlook"), risk: pick(RISKS, b.risk, "risk") };
}

const RISK_LABEL: Record<Risk, string> = { "extra-conservative": "extra conservative", low: "low", moderate: "moderate", high: "high" };

/**
 * Sizing the agent should apply for each answer. These ride in the intent text (the agent's user message) — the
 * agent's own system prompt, tools and validation gate are unchanged — so the two answers genuinely change what it
 * proposes: the numbers it sizes to, and whether leverage is allowed at all. It still cannot exceed its own hard
 * rules (validation before proposal, grounded capabilities, health factor flags).
 */
const RISK_RULES: Record<Risk, string> = {
  "extra-conservative": "Keep the projected health factor at or above 2.5, borrow no more than about 25% of what the collateral would allow, and do not propose Multiply or any leverage.",
  low: "Keep the projected health factor at or above 2.0, borrow no more than about 40% of what the collateral would allow, and avoid Multiply (at most 1.25x leverage if you propose it at all).",
  moderate: "Keep the projected health factor at or above 1.7, borrow no more than about 60% of what the collateral would allow, and keep any Multiply leverage to 1.5x or less.",
  high: "A projected health factor down to 1.5 is acceptable, borrowing up to about 80% of what the collateral would allow is acceptable, and Multiply up to 2x is acceptable, but flag anything aggressive as high-risk in plain language.",
};

const OUTLOOK_RULES: Record<Outlook, string> = {
  bullish: "Being bullish means leverage can be considered, but only if my risk tolerance allows it.",
  bearish: "Being bearish means do not add leverage or extra stock exposure; prefer the smallest, safest use of my holdings and say how a fall in price would affect the position.",
  volatile: "Expecting volatility means leave extra buffer against liquidation, size smaller than you otherwise would, and avoid Multiply.",
  neutral: "I have no strong directional view, so do not tilt the sizing for or against the price moving.",
};

export function composeIntent(a: WizardAnswers): string {
  const goal =
    a.goal === "yield"
      ? `I want yield on my ${a.asset}. Consider the Earn options that genuinely apply to it (borrow-and-redeposit, or Multiply only if it is supported) and recommend whichever is actually best for me, or say plainly if none is worth doing.`
      : `I want to borrow USDC against my ${a.asset} without selling it.`;
  return [
    goal,
    `I'm ${a.outlook} on the market and have ${RISK_LABEL[a.risk]} risk tolerance.`,
    `How to apply that: ${RISK_RULES[a.risk]} ${OUTLOOK_RULES[a.outlook]}`,
    `Use only ${a.asset} that I actually hold in my wallet.`,
  ].join(" ");
}
