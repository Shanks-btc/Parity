/**
 * `npm run check:yield`
 *
 * Verification script for the Phase 3 yield leg: depositing USDC into the xStocks market's
 * own USDC supply reserve. Same build+simulate approach as Phase 2 — no signing, no sending.
 *
 * Market choice (verified live, not assumed): the xStocks market's own USDC reserve
 * (97zoywd8mPZsGTg8q1wdD2Wgkdrs2tqusp1Qqcxbyj7E) carries a real 5.23% supply APY on ~$5.6M
 * in real deposits. Kamino's separate classic Main market's USDC reserve, by contrast, has
 * a 0.0000% supply APY and only ~$0.10 total deposited — not a real yield destination at
 * all. Staying in the xStocks market is both the more honest "yield" claim and the simpler
 * build (no second KaminoClient/market instance needed).
 */
import "dotenv/config";
import { address } from "@solana/kit";
import { createNoopSigner } from "@solana/signers";
import Decimal from "decimal.js";
import { KaminoClient } from "./client";
import { buildUnsignedTransaction, simulate } from "./execute";

// A few real wallets already confirmed to exist on this market from earlier verification —
// cheap to check via getTokenAccountsByOwner before falling back to an expensive full scan.
const KNOWN_WALLETS = [
  "A3iPNQiG7sCAmL4dsAVr9RFmjh9EJEbh4jHprpk4DxdP", // real AAPLx spot holder (Phase 2)
  "Gm1mMs1Bs5imsbSMPoAFFCAcQHuBsZPmTeEE3uKRNLG2", // Vanilla obligor — earlier turns mislabeled this as "AAPLx"; a real simulation log here showed its actual collateral is MSTRx
  "DQbNFD8gc8Fz9J1c2WGZ3QJ84P92kuc2pxajaErBBUDD", // SPYx Multiply obligor
  "BWEJgsSutAxMEWNXTUKSnBaWHHMpQikcHmbmFz8nqEnZ",
  "FspjskoENwNa6TaixoT3xsLsyLZBe2mX9NhchEYMMqwX",
  "2Bkb5X9G7GmTYhgSG1xFmPWJH7LE3CCBx5BQsrXMG1Y9",
  "4JJUhhqmpGvaujPMp4PuDLrLUxEuRuR57MuGHkUmtfj6",
];

async function findUsdcHolder(client: KaminoClient, usdcMint: string): Promise<string | null> {
  const rpc = client.getRpc();

  console.log("Checking already-known real wallets for a spot USDC balance first...");
  for (const wallet of KNOWN_WALLETS) {
    const accounts = await rpc
      .getTokenAccountsByOwner(address(wallet), { mint: address(usdcMint) }, { encoding: "jsonParsed" })
      .send();
    for (const acc of accounts.value) {
      const parsed: any = acc.account.data;
      const amount = parsed?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
      if (amount > 0) {
        console.log(`${wallet} holds ${amount} USDC directly — using it.`);
        return wallet;
      }
    }
  }
  console.log("None of the known wallets hold spot USDC. Falling back to a full program scan...");

  const mintInfo = await rpc.getAccountInfo(address(usdcMint), { encoding: "base64" }).send();
  const tokenProgramId = mintInfo.value?.owner;
  if (!tokenProgramId) {
    throw new Error(`Could not resolve the owning token program for mint ${usdcMint}.`);
  }
  console.log(`Scanning ${tokenProgramId} token accounts for real USDC balances (this may take a while — USDC has many holders)...`);

  const accounts = await rpc
    .getProgramAccounts(tokenProgramId, {
      encoding: "jsonParsed",
      filters: [{ memcmp: { offset: 0n, bytes: usdcMint as any, encoding: "base58" } }],
    })
    .send();

  for (const acc of accounts) {
    const parsed: any = acc.account.data;
    const owner = parsed?.parsed?.info?.owner;
    const amount = parsed?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
    if (owner && amount > 0) {
      console.log(`Found real USDC holder: ${owner} (${amount} USDC)`);
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

  const usdcReserve = client.getReserve("USDC");
  const usdcMint = usdcReserve.getLiquidityMint();
  console.log(`USDC reserve: ${usdcReserve.symbol}, mint: ${usdcMint}, decimals: ${usdcReserve.getMintDecimals()}`);

  const wallet = await findUsdcHolder(client, usdcMint);
  if (!wallet) {
    console.log("\nCould not find a real wallet holding spot USDC quickly — stopping here per instructions rather than digging further.");
    return;
  }

  const depositAmount = "1"; // small on purpose — must be well under whatever real balance we found
  console.log(`\nBuilding a small (${depositAmount} USDC) unsigned deposit transaction for ${wallet}...`);
  const owner = createNoopSigner(address(wallet));
  const action = await client.buildDepositTx(owner, usdcMint, new Decimal(depositAmount));

  console.log("Attaching recent blockhash + fee payer...");
  const tx = await buildUnsignedTransaction(client.getRpc(), action, wallet);
  console.log(`Unsigned transaction constructed. Signature slots: ${Object.keys(tx.signatures).length}`);

  console.log("\nSimulating against live mainnet state (no signing, no sending, costs nothing)...");
  const result = await simulate(client.getRpc(), tx);

  console.log("\n=== SIMULATION RESULT ===");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Yield-leg check failed:", err);
  process.exit(1);
});
