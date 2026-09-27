/**
 * Pure helpers for the number count-up. The animation target is NEVER stored separately: it is parsed out of the
 * element's own rendered text — which comes from the same live-snapshot value (lib/market.ts) the page displays — so
 * the count-up can only ever land on exactly what the data says.
 *
 *   "7.43%"  → one token (7.43, 2 decimals)      "$100T+" → one token (100)
 *   "−1.41%" → the sign stays put, 1.41 counts   "2.04x / 1.52x" → two tokens, animated together
 */
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

export interface NumberToken {
  start: number;
  end: number;
  value: number;
  decimals: number;
  grouped: boolean;
}

export function parseTokens(text: string): NumberToken[] {
  return [...text.matchAll(NUMBER)].map((m) => {
    const raw = m[0];
    return {
      start: m.index!,
      end: m.index! + raw.length,
      value: parseFloat(raw.replace(/,/g, "")),
      decimals: raw.includes(".") ? raw.length - raw.indexOf(".") - 1 : 0,
      grouped: raw.includes(","),
    };
  });
}

/** The text with every number scaled to `progress` (0 → all zeros, 1 → the exact original). */
export function renderAt(text: string, tokens: NumberToken[], progress: number): string {
  if (progress >= 1) return text;
  let out = "";
  let cursor = 0;
  for (const t of tokens) {
    const v = t.value * progress;
    out += text.slice(cursor, t.start);
    out += t.grouped ? v.toLocaleString("en-US", { minimumFractionDigits: t.decimals, maximumFractionDigits: t.decimals }) : v.toFixed(t.decimals);
    cursor = t.end;
  }
  return out + text.slice(cursor);
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
