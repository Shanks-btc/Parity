/**
 * Guards propose_strategy against capability claims the agent never checked.
 *
 * WHY (Phase 5 review): the first accepted AAPLx proposal listed "USDC — Borrow: not supported"
 * without ever calling get_asset_capabilities("USDC"). The claim was invented, not looked up.
 *
 * Two checks:
 *  1. Structured: every assetCapabilities entry must be for a symbol queried in this conversation,
 *     and its supported/notSupported lists must match what get_asset_capabilities returned.
 *  2. Text (summary + risks): a line that makes a capability claim (a capability word — borrow,
 *     earn, multiply, leverage, … — plus a claim marker — supported, available, ✅/❌, "does not
 *     support", …) and names an asset that was never queried is rejected, unless the line's
 *     subject is a queried asset named on the same line (e.g. "AAPLx: Earn ✅ — supply USDC for
 *     yield" is a claim about AAPLx; "✅ Earn: USDC can be supplied" alone is not attributable).
 *     Deliberately strict: a false positive costs the agent one get_asset_capabilities call or a
 *     rephrase; a false negative is exactly the ungrounded claim this exists to stop.
 */

import type { AssetCapabilities } from "../kamino/client.js";

type Capability = "Borrow" | "Earn" | "Multiply";

const CAPABILITY_WORD = /\b(borrow\w*|earn\w*|multiply|leverag\w*|loop\w*|collateral)\b/i;
const CLAIM_MARKER =
  /\b(supported|unsupported|available|unavailable|capabilit\w*)\b|✅|❌|✓|✗|does(?:n['’]t| not) (?:support|offer|allow)|can(?:not|['’]t) be (?:used|borrowed|levered|looped|supplied)|\bno (?:live )?(?:kamino )?(?:multiply|leverage)\b/i;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function actualCapabilities(caps: AssetCapabilities): { supported: Capability[]; notSupported: Capability[] } {
  const all: [Capability, boolean][] = [
    ["Borrow", caps.borrow.supported],
    ["Earn", caps.earn.supported],
    ["Multiply", caps.multiply.supported],
  ];
  return {
    supported: all.filter(([, ok]) => ok).map(([c]) => c),
    notSupported: all.filter(([, ok]) => !ok).map(([c]) => c),
  };
}

export function findUngroundedCapabilityClaims(
  proposal: { summary?: string; risks?: string[]; assetCapabilities?: { symbol: string; supported?: string[]; notSupported?: string[] }[] },
  checked: Map<string, AssetCapabilities>,
  marketSymbols: string[]
): string[] {
  const problems: string[] = [];

  // 1. Structured assetCapabilities entries.
  for (const entry of proposal.assetCapabilities ?? []) {
    const caps = checked.get(entry.symbol);
    if (!caps) {
      problems.push(
        `assetCapabilities lists "${entry.symbol}", but get_asset_capabilities("${entry.symbol}") was never called in this conversation.`
      );
      continue;
    }
    const actual = actualCapabilities(caps);
    const same = (a: string[] = [], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
    if (!same(entry.supported, actual.supported) || !same(entry.notSupported, actual.notSupported)) {
      problems.push(
        `assetCapabilities for ${entry.symbol} (supported ${JSON.stringify(entry.supported ?? [])}, notSupported ` +
          `${JSON.stringify(entry.notSupported ?? [])}) does not match get_asset_capabilities (supported ` +
          `${JSON.stringify(actual.supported)}, notSupported ${JSON.stringify(actual.notSupported)}).`
      );
    }
  }

  // 2. Free-text claims in summary and risks, line by line.
  const symbolRes = marketSymbols.map((sym) => ({ sym, re: new RegExp(`(^|[^A-Za-z0-9])${escapeRe(sym)}(?![A-Za-z0-9])`) }));
  const lines = [...(proposal.summary ?? "").split(/\n+/), ...(proposal.risks ?? [])]
    .flatMap((block) => block.split(/(?<=[.!?])\s+(?=[A-Z*✅❌-])/))
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (!CAPABILITY_WORD.test(line) || !CLAIM_MARKER.test(line)) continue;
    const mentioned = symbolRes.filter(({ re }) => re.test(line)).map(({ sym }) => sym);
    const unqueried = mentioned.filter((s) => !checked.has(s));
    if (unqueried.length === 0) continue;
    const hasQueriedSubject = mentioned.some((s) => checked.has(s));
    if (!hasQueriedSubject) {
      problems.push(
        `Capability claim mentions ${unqueried.join(", ")} without get_asset_capabilities for it: "${line.slice(0, 200)}". ` +
          `Query it first, or rephrase so the claim is explicitly about an asset you did query.`
      );
    }
  }

  return problems;
}
