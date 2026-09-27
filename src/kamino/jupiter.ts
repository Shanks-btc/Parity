/**
 * Real Jupiter integration for Kamino's Multiply builder.
 *
 * INVESTIGATION FINDING (Phase 4): klend-sdk's `getDepositWithLeverageIxs` is a genuine,
 * dedicated Multiply-open builder — it composes the flash-borrow, Kamino deposit+borrow,
 * and flash-repay instructions internally. But it does NOT ship a swap implementation: it
 * takes a caller-supplied `quoter` (SwapQuoteProvider) and `swapper` (SwapIxsProvider) and
 * calls them itself. There is no default/example Jupiter wiring anywhere in the installed
 * package (checked both dist/*.d.ts and the shipped src/, including the CLI at
 * src/client/client.ts) — every real Multiply build requires a real swap-aggregator
 * integration, same shape as xPrime's LeveragedVault.sol composing a flash loan + swap by
 * hand, just against Kamino's own flash-loan/leverage instructions instead of writing them
 * from scratch. This file is that integration, using Jupiter (already verified live and
 * liquid for xStocks in Phase 4's own earlier investigation).
 */

import { address, createSolanaRpc, type Instruction } from "@solana/kit";
import { AccountRole } from "@solana/instructions";
import { fetchAllAddressLookupTable } from "@solana-program/address-lookup-table";
import Decimal from "decimal.js";
import type { SwapInputs, SwapIxsProvider, SwapQuote, SwapQuoteProvider } from "@kamino-finance/klend-sdk";

type RpcConnection = ReturnType<typeof createSolanaRpc>;

const JUPITER_BASE = "https://lite-api.jup.ag/swap/v1";

export interface JupiterIx {
  programId: string;
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  data: string; // base64
}

export interface JupiterQuoteResponse {
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  [key: string]: unknown;
}

interface JupiterSwapInstructionsResponse {
  computeBudgetInstructions: JupiterIx[];
  setupInstructions: JupiterIx[];
  swapInstruction: JupiterIx;
  cleanupInstruction: JupiterIx | null;
  addressLookupTableAddresses: string[];
}

/** Converts Jupiter's legacy-style REST instruction shape into a real @solana/kit Instruction. */
function toKitInstruction(ix: JupiterIx): Instruction {
  return {
    programAddress: address(ix.programId),
    accounts: ix.accounts.map((a) => ({
      address: address(a.pubkey),
      role: a.isSigner
        ? a.isWritable
          ? AccountRole.WRITABLE_SIGNER
          : AccountRole.READONLY_SIGNER
        : a.isWritable
          ? AccountRole.WRITABLE
          : AccountRole.READONLY,
    })),
    data: Uint8Array.from(Buffer.from(ix.data, "base64")),
  };
}

async function fetchJupiterQuote(inputs: SwapInputs): Promise<JupiterQuoteResponse> {
  const amount = inputs.inputAmountLamports.toFixed(0);
  // maxAccounts caps route complexity so the composed Kamino+swap transaction has a chance of
  // fitting Solana's 1232-byte tx limit — VERIFIED LIVE 2026-09-23: without this, Jupiter can
  // return multi-hop routes needing 60 total accounts, well beyond what our ALTs can compress.
  const url =
    `${JUPITER_BASE}/quote?inputMint=${inputs.inputMint}&outputMint=${inputs.outputMint}` +
    `&amount=${amount}&slippageBps=100&maxAccounts=20`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Jupiter quote failed (${res.status}) for ${inputs.inputMint} -> ${inputs.outputMint}`);
  }
  return (await res.json()) as JupiterQuoteResponse;
}

/**
 * Real Jupiter quoter. `getMintDecimals` is caller-supplied so this module doesn't need its
 * own market/RPC dependency — the caller already has a loaded KaminoMarket with decimals
 * cached per reserve.
 */
export function createJupiterQuoter(
  getMintDecimals: (mint: string) => number
): SwapQuoteProvider<JupiterQuoteResponse> {
  return async (inputs: SwapInputs): Promise<SwapQuote<JupiterQuoteResponse>> => {
    const quoteResponse = await fetchJupiterQuote(inputs);

    const inDecimals = getMintDecimals(inputs.inputMint);
    const outDecimals = getMintDecimals(inputs.outputMint);
    const inAmountHuman = new Decimal(quoteResponse.inAmount).div(new Decimal(10).pow(inDecimals));
    const outAmountHuman = new Decimal(quoteResponse.outAmount).div(new Decimal(10).pow(outDecimals));

    // priceAInB = price of 1 input token, expressed in output-token units.
    const priceAInB = outAmountHuman.div(inAmountHuman);

    return { priceAInB, quoteResponse };
  };
}

/**
 * Real Jupiter swapper — re-quotes for the exact final amount, calls /swap-instructions, and
 * converts the result to @solana/kit form.
 *
 * VERIFIED LIVE 2026-09-24: klend-sdk calls the quoter with a *buffered* input amount
 * (swapInputAmount * (1 + quoteBufferBps), operations.ts) only to derive a price, then calls the
 * swapper with the recomputed final amount that matches the borrow. Reusing the quoter's
 * quoteResponse here made Jupiter try to spend ~193154 USDC lamports against a 191841 borrow
 * and fail with 6024 (InsufficientFunds). So the swap must be built from `inputs`, not `quote`.
 */
export function createJupiterSwapper(
  rpc: RpcConnection,
  ownerAddress: string
): SwapIxsProvider<JupiterQuoteResponse> {
  return async (inputs, _klendAccounts, quote) => {
    const quoteResponse = await fetchJupiterQuote(inputs);

    const res = await fetch(`${JUPITER_BASE}/swap-instructions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quoteResponse, userPublicKey: ownerAddress }),
    });
    if (!res.ok) {
      throw new Error(`Jupiter swap-instructions failed (${res.status})`);
    }
    const swapResp = (await res.json()) as JupiterSwapInstructionsResponse;

    const swapIxs: Instruction[] = [
      ...swapResp.computeBudgetInstructions.map(toKitInstruction),
      ...swapResp.setupInstructions.map(toKitInstruction),
      toKitInstruction(swapResp.swapInstruction),
      ...(swapResp.cleanupInstruction ? [toKitInstruction(swapResp.cleanupInstruction)] : []),
    ];

    const lookupTables =
      swapResp.addressLookupTableAddresses.length > 0
        ? await fetchAllAddressLookupTable(
            rpc,
            swapResp.addressLookupTableAddresses.map((a) => address(a))
          )
        : [];

    return [
      {
        preActionIxs: [],
        swapIxs,
        lookupTables,
        quote: { priceAInB: quote.priceAInB, quoteResponse },
      },
    ];
  };
}

// ---------------------------------------------------------------------------------------------
// Standalone swap (user-facing "buy an xStock with USDC"), separate from the Multiply-internal
// quoter/swapper above: one plain Jupiter swap as its OWN transaction, not nested in a flash loan.
// ---------------------------------------------------------------------------------------------

export interface PlainSwapQuote {
  inputMint: string;
  outputMint: string;
  /** Raw base units of the input / expected output / guaranteed minimum output. */
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: string;
  routeLabels: string[];
}

export interface PlainSwapTransaction {
  /** Unsigned base64 v0 transaction, fee payer = the owner, ready for the wallet to sign. */
  transactionBase64: string;
  lastValidBlockHeight: string;
  quote: PlainSwapQuote;
}

/**
 * Builds (does NOT sign or send) a plain Jupiter swap of `amountRaw` base units of `inputMint` into
 * `outputMint` for `ownerAddress`, via Jupiter's /quote + /swap. Jupiter creates the owner's output
 * token account if missing. Unlike fetchJupiterQuote above, there is no maxAccounts cap — that only
 * exists to keep a swap small enough to nest inside a Kamino flash-loan transaction.
 */
export async function buildPlainSwapTransaction(params: {
  ownerAddress: string;
  inputMint: string;
  outputMint: string;
  amountRaw: string;
  slippageBps?: number;
}): Promise<PlainSwapTransaction> {
  const slippageBps = params.slippageBps ?? 100;
  const quoteRes = await fetch(
    `${JUPITER_BASE}/quote?inputMint=${params.inputMint}&outputMint=${params.outputMint}` +
      `&amount=${params.amountRaw}&slippageBps=${slippageBps}`
  );
  if (!quoteRes.ok) {
    throw new Error(`Jupiter quote failed (${quoteRes.status}): ${(await quoteRes.text()).slice(0, 200)}`);
  }
  const quoteResponse = (await quoteRes.json()) as JupiterQuoteResponse & {
    otherAmountThreshold: string;
    routePlan?: Array<{ swapInfo?: { label?: string } }>;
  };

  const swapRes = await fetch(`${JUPITER_BASE}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: params.ownerAddress,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 100_000, priorityLevel: "medium" } },
    }),
  });
  if (!swapRes.ok) {
    throw new Error(`Jupiter swap build failed (${swapRes.status}): ${(await swapRes.text()).slice(0, 200)}`);
  }
  const swap = (await swapRes.json()) as { swapTransaction: string; lastValidBlockHeight: number };

  return {
    transactionBase64: swap.swapTransaction,
    lastValidBlockHeight: String(swap.lastValidBlockHeight),
    quote: {
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      inAmount: quoteResponse.inAmount,
      outAmount: quoteResponse.outAmount,
      otherAmountThreshold: quoteResponse.otherAmountThreshold,
      slippageBps,
      priceImpactPct: quoteResponse.priceImpactPct,
      routeLabels: [...new Set((quoteResponse.routePlan ?? []).map((r) => r.swapInfo?.label).filter((l): l is string => !!l))],
    },
  };
}
