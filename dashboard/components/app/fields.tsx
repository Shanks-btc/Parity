"use client";

import type { ReactNode } from "react";
import { Mono } from "../Mono";

/** Sanitises typed input to a plain decimal ("12", "0.5", ".5") — no signs, no exponents. */
export const cleanDecimal = (raw: string) => {
  const s = raw.replace(/[^0-9.]/g, "");
  const [head, ...rest] = s.split(".");
  return rest.length ? `${head}.${rest.join("")}` : head;
};

/** Parsed positive amount, or null when empty / zero / not a number. */
export const parseAmount = (s: string): number | null => {
  const n = Number(s);
  return s !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

export function AmountInput({
  id,
  label,
  value,
  onChange,
  token,
  hint,
  onMax,
  maxLabel = "MAX",
  disabled,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  token: ReactNode;
  hint?: ReactNode;
  onMax?: () => void;
  maxLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block font-mono text-[11px] tracking-[0.04em] text-ink-muted">
        {label}
      </label>
      <div className={`flex items-center gap-3 rounded-[10px] border bg-surface px-4 py-3 focus-within:border-gold-deep ${invalid ? "border-clay-text" : "border-line-strong"}`}>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(cleanDecimal(e.target.value))}
          className="min-w-0 flex-1 bg-transparent font-mono text-[20px] text-ink outline-none placeholder:text-ink-faint disabled:opacity-50"
        />
        {onMax && (
          <button type="button" onClick={onMax} disabled={disabled} className="shrink-0 cursor-pointer rounded-md border border-line-strong px-2 py-1 font-mono text-[11px] text-gold-strong hover:border-gold-deep disabled:cursor-not-allowed disabled:opacity-50">
            {maxLabel}
          </button>
        )}
        <span className="shrink-0 font-mono text-[14px] font-medium text-ink">{token}</span>
      </div>
      {hint && <div className="mt-2 font-mono text-[11px] leading-normal text-ink-muted">{hint}</div>}
    </div>
  );
}

export function StatRow({ label, value, tone = "ink", note }: { label: string; value: ReactNode; tone?: "ink" | "clay" | "positive" | "muted"; note?: string }) {
  const color = { ink: "text-ink", clay: "text-clay-text", positive: "text-positive", muted: "text-ink-faint" }[tone];
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-3.5 last:border-b-0">
      <div>
        <div className="font-serif text-[14px] text-ink-muted">{label}</div>
        {note && <div className="mt-0.5 font-mono text-[10px] text-ink-faint">{note}</div>}
      </div>
      <Mono as="div" className={`text-right text-[15px] ${color}`}>
        {value}
      </Mono>
    </div>
  );
}

export const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Token amount without float noise, trimmed. */
export const tokenAmount = (s: string | number, max = 6) => {
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: max }) : String(s);
};
