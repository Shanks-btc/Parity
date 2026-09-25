/*
 * Real defects found by the backend's own verification runs, and how each was fixed. Deliberately
 * styled as an audit trail (dark header, ruled rows), not as another white feature card.
 *
 * Sources (all in this repo's history):
 *   02 — client.ts toRawAmount(): the SDK does `new BN(amount)`, and bn.js threw
 *        "Invalid character" on a human-readable decimal like "0.005".
 *   04 — jupiter.ts createJupiterSwapper(): klend-sdk quotes on a *buffered* amount to price the
 *        swap; reusing that quote made Jupiter spend more than was borrowed → error 6024. The
 *        mockup called it a "stale" quote; it was an oversized one, so the copy says so.
 *   05 — execute.ts getInstructionsFromAction(): in-between refreshes were placed before the
 *        lending ixs → RefreshObligation failed with InvalidAccountInput (6006); now uses the
 *        SDK's own KaminoAction.actionToIxs.
 */
const ENTRIES = [
  {
    phase: "02",
    before: "amount.toString() passed raw",
    after: "scaled to real on-chain decimals",
    caughtBy: '"Invalid character" (bn.js)',
  },
  {
    phase: "04",
    before: "buffered Jupiter quote reused",
    after: "fresh quote for the exact borrowed amount",
    caughtBy: "Jupiter error 6024",
  },
  {
    phase: "05",
    before: "refreshes ordered before lending ixs",
    after: "reordered via the SDK's own helper",
    caughtBy: "InvalidAccountInput",
  },
];

/**
 * Row layout (the mockup only defines the 1440px single line):
 *   - xl+: one line — tag · before → after · caught-by pushed right, as in the mockup.
 *   - md–xl: tag and before → after share the first line; "caught by" drops underneath.
 *   - below md: three lines — tag, then before → after at full width, then "caught by". Beside the
 *     tag, the change text only had ~220px on a phone and broke mid-phrase ("passed / raw").
 * Nothing truncates at any width; long text wraps.
 */
export function VerificationLog() {
  return (
    // A plain container: the enclosing #proof section is already the region labelled by this log's title.
    <div className="overflow-hidden rounded-xl border border-ink">
      <div className="flex items-center justify-between gap-3 bg-ink px-4 py-4 md:px-6">
        <h3 id="verification-log-title" className="m-0 font-mono text-[11px] font-normal tracking-[0.05em] text-term-text">
          VERIFICATION LOG — REAL DEFECTS, REAL FIXES
        </h3>
        <span className="shrink-0 font-mono text-[10px] text-ink-faint">
          {ENTRIES.length} OF {ENTRIES.length} RESOLVED
        </span>
      </div>

      <ol className="m-0 list-none p-0">
        {ENTRIES.map((e) => (
          <li
            key={e.phase}
            className="flex flex-wrap items-start gap-x-5 gap-y-2 border-b border-line px-4 py-4 last:border-b-0 md:px-6 md:py-[18px] xl:flex-nowrap xl:items-center"
          >
            {/* Dark gold-ink text on the gold tag: the mockup's white measured 3.69:1 at 10px. */}
            <span className="mt-0.5 shrink-0 rounded bg-gold-text px-2 py-[3px] font-mono text-[10px] text-gold-ink xl:mt-0">
              PHASE {e.phase}
            </span>
            <span className="min-w-0 basis-full font-serif text-sm md:basis-0 md:flex-1">
              <span className="sr-only">Before: </span>
              <del className="text-clay-text decoration-clay-text">{e.before}</del>
              <span aria-hidden="true" className="mx-2 text-ink-faint">
                →
              </span>
              <span className="sr-only">. After: </span>
              <ins className="text-ink no-underline">{e.after}</ins>
            </span>
            <span className="w-full font-mono text-[10px] text-ink-muted xl:w-auto xl:shrink-0">caught by: {e.caughtBy}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
