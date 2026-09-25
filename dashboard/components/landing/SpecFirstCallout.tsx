import { REPO_FILES } from "@/lib/repo";

/*
 * Copy notes vs. the mockup:
 *   - TESTPLAN.md was described as "the 6-step live verification sequence"; the real file lists 8
 *     backend checks plus the frontend checks, so it's described by what it actually contains.
 *   - The mockup's "documented in the repo — not summarized after the fact" line was replaced with
 *     a runnable-scripts line, then removed entirely on request; the file list carries the point.
 */
export function SpecFirstCallout() {
  return (
    <aside
      aria-labelledby="spec-first-title"
      className="mt-6 rounded-xl bg-[linear-gradient(135deg,#1a1b17_0%,#3d2e12_100%)] p-6 text-term-text md:p-8"
    >
      <div className="mb-3.5 font-mono text-[11px] tracking-[0.05em] text-gold">(Built phase by phase, verified before moving on)</div>
      {/* mb-6 carries the gap the removed description paragraph used to provide. */}
      <h3 id="spec-first-title" className="mb-6 mt-0 max-w-[480px] font-serif text-[22px] font-semibold leading-snug md:text-[26px]">
        Every phase was tested against real data before the next one started.
      </h3>
      <ul className="m-0 list-none border-t border-white/12 p-0">
        {REPO_FILES.map((f) => (
          <li
            key={f.name}
            className="flex flex-col gap-1 border-b border-white/12 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            {f.href ? (
              <a href={f.href} target="_blank" rel="noreferrer" className="font-mono text-[13px] text-term-text underline-offset-4 hover:text-gold hover:underline">
                {f.name} ↗
              </a>
            ) : (
              // Repo URL not confirmed yet — see lib/repo.ts (one `href` line per file).
              <span data-repo-link="pending" className="font-mono text-[13px] text-term-text">
                {f.name}
              </span>
            )}
            <span className="font-mono text-xs text-ink-faint">{f.description}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
