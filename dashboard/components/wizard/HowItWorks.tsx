"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Mono } from "../Mono";
import { tokenAmount } from "../app/fields";
import type { Proposal } from "./AgentResult";

const XSTOCKS = ["AAPLx", "SPYx", "TSLAx"];

/** How much of the xStock this strategy needs in the wallet, from the agent's own proposal. Null when it needs none. */
export function requiredStock(p: Proposal): { symbol: string; amount: number } | null {
  const symbol = p.newDepositSymbol;
  if ((p.strategyType === "borrow" || p.strategyType === "multiply") && symbol && XSTOCKS.includes(symbol) && p.newDepositAmount && p.newDepositAmount > 0) return { symbol, amount: p.newDepositAmount };
  return null;
}

/** Pay amount (USDC) to prefill on the Trade swap: the shortfall at Kamino's oracle price, rounded up slightly to cover the spread. */
export const payForShortfall = (shortfall: number, oraclePrice: number) => Math.max(0.1, Math.ceil(shortfall * oraclePrice * 1.02 * 100) / 100);

/**
 * The "How it works" list on the wizard's result screen. Everything here is derived from real data: the agent's own
 * proposal, the wallet's real MOVABLE balance, and Kamino's oracle price. Nothing is an example or a placeholder.
 *   1. Buy {asset}      completed when the wallet already holds the proposal's supply amount, otherwise a link to the
 *                       Trade swap with the shortfall (at the oracle price, rounded up slightly) prefilled.
 *   2. Deposit / Borrow the existing prefilled hand-off to /borrow or /earn/multiply.
 */
export function HowItWorks({
  proposal,
  dest,
  held,
  price,
  onNavigate,
  onRestart,
  onComplete,
}: {
  proposal: Proposal;
  dest: { href: string; label: string; executes: boolean };
  held: { symbol: string; amount: string }[] | null;
  price: number | null;
  onNavigate?: () => void;
  onRestart: () => void;
  onComplete?: () => void;
}) {
  const need = requiredStock(proposal);
  const have = need && held ? Number(held.find((b) => b.symbol === need.symbol)?.amount ?? "0") : null;
  // A tiny tolerance so a balance equal to the proposal amount is not "short" by float noise.
  const shortfall = need && have !== null ? Math.max(0, need.amount - have) : null;
  const buyDone = need !== null && shortfall !== null && shortfall <= need.amount * 1e-9;
  const checking = need !== null && (have === null || price === null);
  const buyHref =
    need && shortfall && price
      ? `/trade?${new URLSearchParams({ asset: need.symbol, mode: "spot", from: "wizard", pay: String(payForShortfall(shortfall, price)) }).toString()}`
      : null;
  const stepTitle2 = proposal.strategyType === "multiply" ? "Open Multiply on Kamino" : proposal.strategyType === "borrow" ? "Deposit and borrow on Kamino" : "Read how this works";
  const primaryToBuy = need !== null && !buyDone;
  const startsEarning = proposal.strategyType === "multiply" || proposal.strategyType === "earn" || proposal.strategyType === "borrow_and_earn";
  const finish = () => {
    onComplete?.();
    onNavigate?.();
  };

  const card = (n: number, title: string, done: boolean, body: ReactNode, testid: string) => (
    <li data-testid={testid} data-done={done} className={`flex gap-4 rounded-[10px] border p-5 ${done ? "border-positive/40 bg-positive-tint/40" : "border-line bg-surface"}`}>
      <span aria-hidden="true" className={`flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-[13px] ${done ? "bg-positive text-paper" : "border border-line-strong text-ink"}`}>
        {done ? "✓" : n}
      </span>
      <div className="min-w-0">
        <div className="font-serif text-[18px] font-semibold text-ink">{title}</div>
        <div className="mt-1 font-serif text-[14px] leading-normal text-ink-muted">{body}</div>
      </div>
    </li>
  );
  const btn = "rounded-lg bg-gold-deep px-6 py-3 font-mono text-[14px] font-medium text-gold-ink hover:bg-gold-text";

  return (
    <section aria-labelledby="how-title" data-testid="how-it-works" className="flex flex-col gap-4">
      <h3 id="how-title" className="m-0 font-serif text-[20px] font-semibold text-ink">
        How it works
      </h3>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {need &&
          card(
            1,
            `Buy ${need.symbol}`,
            buyDone,
            checking ? (
              "Checking what your wallet holds…"
            ) : buyDone ? (
              <>You hold enough {need.symbol}.</>
            ) : (
              <>
                Get about <Mono>{tokenAmount(shortfall ?? 0, 8)}</Mono> {need.symbol}.{" "}
                {buyHref && (
                  <Link href={buyHref} onClick={onNavigate} data-testid="how-buy-link" className="text-gold-strong underline underline-offset-2">
                    Buy it in the app →
                  </Link>
                )}
              </>
            ),
            "how-step-buy"
          )}
        {card(
          need ? 2 : 1,
          stepTitle2,
          false,
          dest.executes ? (
            <>
              <Link href={dest.href} onClick={finish} data-testid="how-deposit-link" className="text-gold-strong underline underline-offset-2">
                {dest.label} →
              </Link>
              <span className="mt-1 block">It re-simulates the exact transaction and asks you to confirm before your wallet is ever asked to sign, the wizard signs nothing itself.</span>
            </>
          ) : (
            "The redeposit leg has no in-app execution, that page explains the strategy and its current net carry. Nothing is signed from here."
          ),
          "how-step-deposit"
        )}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        {checking ? (
          <button type="button" disabled data-testid="proposal-action" className={`${btn} cursor-not-allowed opacity-60`}>
            Checking your wallet…
          </button>
        ) : primaryToBuy && buyHref ? (
          <Link href={buyHref} onClick={onNavigate} data-testid="proposal-action" className={btn}>
            Continue →
          </Link>
        ) : (
          <Link href={dest.href} onClick={finish} data-testid="proposal-action" className={btn}>
            {startsEarning ? "Start Earning" : "Continue"} →
          </Link>
        )}
        <button type="button" onClick={onRestart} className="cursor-pointer rounded-lg border border-line-strong bg-surface px-5 py-3 font-mono text-[14px] text-ink hover:border-gold-deep">
          Start over
        </button>
      </div>
    </section>
  );
}
