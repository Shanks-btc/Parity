/**
 * `npm run check:execute` (add the script if not already in package.json)
 *
 * Verification script for the Phase 2 build+simulate layer. Builds a real (unsigned) small
 * AAPLx deposit transaction against the live xStocks market and runs it through
 * simulateTransaction — no signing, no sending, no private key, no funds moved.
 */
import "dotenv/config";
import { address } from "@solana/kit";
import { createNoopSigner } from "@solana/signers";
import Decimal from "decimal.js";
import { KaminoClient } from "./client";
import { buildUnsignedTransaction, simulate } from "./execute";

const CANDIDATE_WALLET = "Gm1mMs1Bs5imsbSMPoAFFCAcQHuBsZPmTeEE3uKRNLG2"; // known Vanilla obligor — its collateral is MSTRx, not AAPLx (per-reserve data, Phase 3/5)

async function findAaplxHolder(client: KaminoClient, aaplxMint: string): Promise<string | null> {
  const rpc = client.getRpc();

  // 1. Check the candidate wallet first — do they hold spot AAPLx (not just Kamino collateral)?
  const candidateAccounts = await rpc
    .getTokenAccountsByOwner(address(CANDIDATE_WALLET), { mint: address(aaplxMint) }, { encoding: "jsonParsed" })
    .send();

  for (const acc of candidateAccounts.value) {
    const parsed: any = acc.account.data;
    const amount = parsed?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
    if (amount > 0) {
      console.log(`Candidate wallet ${CANDIDATE_WALLET} holds ${amount} AAPLx directly — using it.`);
      return CANDIDATE_WALLET;
    }
  }
  console.log(`Candidate wallet ${CANDIDATE_WALLET} holds no spot AAPLx (likely all deposited as Kamino collateral already).`);

  // 2. getTokenLargestAccounts is hard-blocked on this free RPC tier (x-ratelimit-method-limit: 0,
  // confirmed across retries — not a transient throttle). Fall back to getProgramAccounts on
  // whichever token program actually owns this mint, filtered by mint via memcmp. AAPLx turned out
  // to be a Token-2022 mint, not classic SPL Token — resolved dynamically here rather than assumed.
  const mintInfo = await rpc.getAccountInfo(address(aaplxMint), { encoding: "base64" }).send();
  const tokenProgramId = mintInfo.value?.owner;
  if (!tokenProgramId) {
    throw new Error(`Could not resolve the owning token program for mint ${aaplxMint}.`);
  }
  console.log(`Scanning ${tokenProgramId} token accounts for real AAPLx balances (this is a broad scan, may take a bit)...`);

  const accounts = await rpc
    .getProgramAccounts(tokenProgramId, {
      encoding: "jsonParsed",
      filters: [{ memcmp: { offset: 0n, bytes: aaplxMint as any, encoding: "base58" } }],
    })
    .send();

  for (const acc of accounts) {
    const parsed: any = acc.account.data;
    const owner = parsed?.parsed?.info?.owner;
    const amount = parsed?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
    if (owner && amount > 0) {
      console.log(`Found real AAPLx holder: ${owner} (${amount} AAPLx)`);
      return owner;
    }
  }

  return null;
}

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const marketAddress = process.env.KAMINO_MAIN_MARKET;
  if (!rpcUrl || !marketAddress) {
    throw new Error("Set SOLANA_RPC_URL and KAMINO_MAIN_MARKET in .env first.");
  }

  console.log(`Loading Kamino market ${marketAddress} via ${rpcUrl}...`);
  const client = new KaminoClient(rpcUrl, marketAddress);
  await client.init();

  const aaplxReserve = client.getReserve("AAPLx");
  const aaplxMint = aaplxReserve.getLiquidityMint();

  const wallet = await findAaplxHolder(client, aaplxMint);
  if (!wallet) {
    console.log("\nCould not find a real wallet holding spot AAPLx quickly — stopping here per instructions rather than digging further.");
    return;
  }

  const depositAmount = "0.005"; // small on purpose — must be well under whatever real balance we found
  console.log(`\nBuilding a small (${depositAmount} AAPLx) unsigned deposit transaction for ${wallet}...`);
  const owner = createNoopSigner(address(wallet));
  const action = await client.buildDepositTx(owner, aaplxMint, new Decimal(depositAmount));

  console.log("Attaching recent blockhash + fee payer...");
  const tx = await buildUnsignedTransaction(client.getRpc(), action, wallet);
  console.log(`Unsigned transaction constructed. Signature slots: ${Object.keys(tx.signatures).length}`);

  console.log("\nSimulating against live mainnet state (no signing, no sending, costs nothing)...");
  const result = await simulate(client.getRpc(), tx);

  console.log("\n=== SIMULATION RESULT ===");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Execute/simulate check failed:", err);
  process.exit(1);
});
