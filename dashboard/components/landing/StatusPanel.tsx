/** Bordered label/value table with a mono header strip ("PYTH INTEGRATION STATUS", …). */
export function StatusPanel({
  title,
  rows,
  className = "",
}: {
  title: string;
  rows: { label: string; value: string; tone: "positive" | "clay" }[];
  className?: string;
}) {
  return (
    <div className={`overflow-hidden rounded-[10px] border border-line ${className}`}>
      <div className="border-b border-line bg-paper-raised px-[18px] py-3 font-mono text-[10px] tracking-[0.04em] text-ink-faint">
        {title}
      </div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 border-b border-line-soft px-[18px] py-3 last:border-b-0">
          <span className="font-serif text-sm text-ink">{r.label}</span>
          <span className={`text-right font-mono text-[11px] ${r.tone === "positive" ? "text-positive" : "text-clay-text"}`}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}
