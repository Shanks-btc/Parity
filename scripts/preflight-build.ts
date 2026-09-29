/** READ-ONLY: build (never sign) the real transactions for the USER's address and decode every instruction. */
import { boot, USER, address, createNoopSigner, Decimal, describeIx, withRpcRetry, PROG } from "./preflight-lib";
import { getInstructionsFromAction, buildUnsignedTransactionFromInstructions } from "../src/kamino/execute";

const { client, rpc } = await boot();
const owner = createNoopSigner(address(USER));
const usdc = client.getReserve("USDC").getLiquidityMint();
const show = async (label: string, ixs: any[], lookupTables: any[] = []) => {
  console.log(`\n=== ${label}: ${ixs.length} instructions, ${lookupTables.length} lookup tables`);
  ixs.forEach((ix, i) => { const d = describeIx(ix); console.log(`  ${String(i).padStart(2)} ${d.program.padEnd(11)} ${d.name}  (${d.accounts} accounts)`); });
  // accounts these instructions would CREATE = writable non-signer accounts that do not exist yet
  const writable = new Map<string, string>();
  for (const ix of ixs) for (const a of ix.accounts ?? []) if ((Number(a.role) & 1) && !(Number(a.role) & 2) && String(ix.programAddress) !== PROG.computeBudget) writable.set(String(a.address), String(ix.programAddress));
  const addrs = [...writable.keys()];
  const infos = await withRpcRetry(() => rpc.getMultipleAccounts(addrs.map((a) => address(a)), { encoding: "base64" }).send(), 3, 2000);
  console.log("  writable accounts that DO NOT EXIST on chain today (=> would be created):");
  addrs.forEach((a, i) => { if (!infos.value[i]) console.log(`    ${a}  (touched by ${writable.get(a)!.slice(0, 8)}…)`); });
};
// Borrow: 0.0016 SPYx deposit, 0.5 USDC borrow (sizes only matter for shape here)
const action = await client.buildDepositAndBorrowTx(owner, client.getReserve("SPYx").getLiquidityMint(), new Decimal("0.002"), usdc, new Decimal("0.5"));
await show("BORROW (SPYx collateral, borrow USDC) built for the USER", getInstructionsFromAction(action));
