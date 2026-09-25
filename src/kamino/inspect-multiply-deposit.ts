/**
 * `npm run check:multiply-deposit`
 *
 * Verification script for Phase 4: opening a real SPYx Multiply position. Same build+simulate
 * approach as Phases 2/3 — no signing, no sending — but the build itself is genuinely
 * different: see the INVESTIGATION NOTE on KaminoClient.buildMultiplyDepositTx and in
 * jupiter.ts. This is not a simple KaminoAction wrapper like buildDepositTx/buildBorrowTx —
 * it composes a flash loan + a real Jupiter swap + Kamino deposit/borrow, atomically.
 */
import "dotenv/config";
import { address } from "@solana/kit";
import { createNoopSigner } from "@solana/signers";
import Decimal from "decimal.js";
import { KaminoClient } from "./client.js";
import { buildUnsignedTransactionFromInstructions, simulate } from "./execute.js";

// Known SPYx Multiply obligors from earlier verification (their SPYx is likely already
// deposited as Kamino collateral, so spot balance is a long shot, but cheap to check first) —
// plus other known real wallets from earlier phases.
const KNOWN_WALLETS = [
  "A3iPNQiG7sCAmL4dsAVr9RFmjh9EJEbh4jHprpk4DxdP",
  "Gm1mMs1Bs5imsbSMPoAFFCAcQHuBsZPmTeEE3uKRNLG2",
  "DQbNFD8gc8Fz9J1c2WGZ3QJ84P92kuc2pxajaErBBUDD",
  "BWEJgsSutAxMEWNXTUKSnBaWHHMpQikcHmbmFz8nqEnZ",
  "FspjskoENwNa6TaixoT3xsLsyLZBe2mX9NhchEYMMqwX",
  "2Bkb5X9G7GmTYhgSG1xFmPWJH7LE3CCBx5BQsrXMG1Y9",
  "4JJUhhqmpGvaujPMp4PuDLrLUxEuRuR57MuGHkUmtfj6",
];

// Earlier run picked a wallet holding 0.00000108 SPYx and asked it to deposit 0.001 — the
// simulation correctly failed on insufficient funds. Require a balance that can actually cover
// a small test deposit, and size the deposit from the discovered balance (as Phases 2/3 did).
const MAX_TEST_DEPOSIT = new Decimal("0.001");
const MIN_HOLDER_BALANCE = new Decimal("0.0001");

type Holder = { wallet: string; balance: Decimal };

/** Raw-unit balance. xStocks' Token-2022 scaledUiAmount multiplier makes uiAmount larger than what can be moved. */
function rawUiAmount(parsed: any): Decimal {
  const t = parsed?.parsed?.info?.tokenAmount;
  return t ? new Decimal(t.amount).div(new Decimal(10).pow(t.decimals)) : new Decimal(0);
}

async function findSpyxHolder(client: KaminoClient, spyxMint: string): Promise<Holder | null> {
  const rpc = client.getRpc();

  console.log("Checking already-known real wallets for a spot SPYx balance first...");
  for (const wallet of KNOWN_WALLETS) {
    const accounts = await rpc
      .getTokenAccountsByOwner(address(wallet), { mint: address(spyxMint) }, { encoding: "jsonParsed" })
      .send();
    for (const acc of accounts.value) {
      const parsed: any = acc.account.data;
      const amount = rawUiAmount(parsed);
      if (amount.gte(MIN_HOLDER_BALANCE)) {
        console.log(`${wallet} holds ${amount} SPYx directly — using it.`);
        return { wallet, balance: amount };
      }
    }
  }
  console.log("None of the known wallets hold spot SPYx. Falling back to a full program scan...");

  const mintInfo = await rpc.getAccountInfo(address(spyxMint), { encoding: "base64" }).send();
  const tokenProgramId = mintInfo.value?.owner;
  if (!tokenProgramId) {
    throw new Error(`Could not resolve the owning token program for mint ${spyxMint}.`);
  }
  console.log(`SPYx is owned by ${tokenProgramId} — scanning its accounts for real SPYx balances...`);

  const accounts = await rpc
    .getProgramAccounts(tokenProgramId, {
      encoding: "jsonParsed",
      filters: [{ memcmp: { offset: 0n, bytes: spyxMint as any, encoding: "base58" } }],
    })
    .send();

  // Take the largest holder rather than the first non-zero one, so dust accounts are skipped.
  let best: Holder | null = null;
  for (const acc of accounts) {
    const parsed: any = acc.account.data;
    const owner = parsed?.parsed?.info?.owner;
    const amount = rawUiAmount(parsed);
    if (owner && amount.gte(MIN_HOLDER_BALANCE) && (!best || amount.gt(best.balance))) {
      best = { wallet: owner, balance: amount };
    }
  }
  if (best) {
    console.log(`Found real SPYx holder: ${best.wallet} (${best.balance} SPYx)`);
  }
  return best;
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

  const spyxReserve = client.getReserve("SPYx");
  const spyxMint = spyxReserve.getLiquidityMint();
  console.log(`SPYx reserve: mint ${spyxMint}, decimals ${spyxReserve.getMintDecimals()}`);

  const holder = await findSpyxHolder(client, spyxMint);
  if (!holder) {
    console.log("\nCould not find a real wallet holding spot SPYx quickly — stopping here per instructions rather than digging further.");
    return;
  }

  const wallet = holder.wallet;
  // Small on purpose, and never more than half the wallet's real balance.
  const depositAmount = Decimal.min(MAX_TEST_DEPOSIT, holder.balance.div(2)).toDecimalPlaces(
    spyxReserve.getMintDecimals(),
    Decimal.ROUND_DOWN
  );
  const targetLeverage = new Decimal("1.5"); // conservative, matches real observed avg leverage range
  console.log(
    `\nBuilding a small (${depositAmount} SPYx, ${targetLeverage}x target) unsigned Multiply deposit for ${wallet}...`
  );

  const owner = createNoopSigner(address(wallet));
  const { ixs, lookupTables } = await client.buildMultiplyDepositTx(owner, "SPYx", depositAmount, targetLeverage);
  console.log(`Composed ${ixs.length} instructions, ${lookupTables.length} lookup table(s).`);

  console.log("Attaching recent blockhash + fee payer...");
  const tx = await buildUnsignedTransactionFromInstructions(client.getRpc(), ixs, wallet, lookupTables);
  console.log(`Unsigned transaction constructed. Signature slots: ${Object.keys(tx.signatures).length}`);

  console.log("\nSimulating against live mainnet state (no signing, no sending, costs nothing)...");
  const result = await simulate(client.getRpc(), tx);

  console.log("\n=== SIMULATION RESULT ===");
  console.log(JSON.stringify(result, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2));
}

main().catch((err) => {
  console.error("Multiply deposit check failed:", err);
  process.exit(1);
});
