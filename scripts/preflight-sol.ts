/** READ-ONLY: measure SOL requirements per flow (rent of every created account, network fee, priority fee, transfers). */
import { boot, USER, address, Decimal, describeIx, withRpcRetry, PROG, createNoopSigner } from "./preflight-lib";
import { buildUnsignedTransactionFromInstructions } from "../src/kamino/execute";
import { getBase64EncodedWireTransaction } from "@solana/kit";

const { client, validator, rpc } = await boot();
const price = (s: string) => client.getReserve(s).getOracleMarketPrice();
const rent = async (space: number) => Number(await rpc.getMinimumBalanceForRentExemption(BigInt(space)).send());
const slotBal = async (a: string) => (await rpc.getBalance(address(a), { commitment: "confirmed" }).send());

interface Flow { name: string; strategy: any; subject: string }
const FLOWS: Flow[] = [
  { name: "Borrow SPYx", subject: "9A9dUreQvTNoqNrqQC2DN1onfZWBtCBsTiuA6oGXZwc6", strategy: { strategyType: "borrow", newDepositSymbol: "SPYx", newDepositAmount: 0.00171879, borrowSymbol: "USDC", borrowAmount: 0.5 } },
  { name: "Borrow AAPLx", subject: "C68a6RCGLiPskbPYtAcsCjhG8tfTWYcoB4JjCrXFdqyo", strategy: { strategyType: "borrow", newDepositSymbol: "AAPLx", newDepositAmount: 0.00584617, borrowSymbol: "USDC", borrowAmount: 0.5 } },
  { name: "Multiply SPYx", subject: "Hp7sb1L3XGtkb7PuptnoL4EGr56c1QwiYCcuPP7rHVDc", strategy: { strategyType: "multiply", newDepositSymbol: "SPYx", newDepositAmount: 0.00012891, targetLeverage: 1.5 } },
  { name: "Multiply TSLAx", subject: "7RkHqvgSekLwEPxprm9MC8dmtonZV2wmsrirpFwFXcGH", strategy: { strategyType: "multiply", newDepositSymbol: "TSLAx", newDepositAmount: 0.00026876, targetLeverage: 1.5 } },
];
const only = process.argv[2];
const out: any = {};
for (const f of FLOWS.filter((x) => !only || x.name === only)) {
  console.log(`\n################ ${f.name} ################`);
  const built = await withRpcRetry(() => (validator as any).buildInstructions(f.subject, f.strategy), 2, 3000);
  const ixs: any[] = built.ixs, luts = built.lookupTables;
  const describe = ixs.map(describeIx);
  // key each account by (ix name : position) of the FIRST instruction that lists it as writable & non-signer
  const first = new Map<string, { key: string; ix: string; idx: number }>();
  ixs.forEach((ix, i) => (ix.accounts ?? []).forEach((a: any, j: number) => { const r = Number(a.role); if ((r & 1) && !(r & 2) && !first.has(String(a.address))) first.set(String(a.address), { key: `${describe[i].program}:${describe[i].name}:${j}`, ix: describe[i].name, idx: j }); }));
  const addrs = [...first.keys()].filter((a) => String(ixs.find((ix) => (ix.accounts ?? []).some((x: any) => String(x.address) === a))!.programAddress) !== PROG.computeBudget);
  const pre = await withRpcRetry(() => rpc.getMultipleAccounts(addrs.map((a) => address(a)), { encoding: "base64" }).send(), 3, 2000);
  const created = addrs.filter((_, i) => !pre.value[i]);
  // system-program transfers / createAccount inside the instruction list
  const transfers = describe.filter((d) => /^transfer\(|^createAccount\(/.test(d.name)).map((d) => d.name);
  const cb = describe.filter((d) => d.program === "computeBudget").map((d) => d.name);
  console.log(`instructions ${ixs.length}, lookup tables ${luts.length}; compute-budget ixs: ${cb.join(", ") || "none"}; system transfer/createAccount ixs: ${transfers.join(", ") || "none"}`);
  console.log(`accounts this tx would CREATE for the subject (${created.length}):`);
  const tx = await buildUnsignedTransactionFromInstructions(rpc, ixs, f.subject, luts);
  const wire = getBase64EncodedWireTransaction(tx);
  // read fee payer balance, simulate asking for fee payer + created accounts back, then re-read balance at the same slot
  let before: any, sim: any, after: any, ok = false;
  for (let tries = 0; tries < 6 && !ok; tries++) {
    before = await slotBal(f.subject);
    sim = await rpc.simulateTransaction(wire, { encoding: "base64", sigVerify: false, commitment: "confirmed", accounts: { addresses: [address(f.subject), ...created.map((a) => address(a))], encoding: "base64" } }).send();
    after = await slotBal(f.subject);
    ok = before.value === after.value; // balance did not move on chain while we measured
  }
  if (sim.value.err) { console.log("SIMULATION FAILED:", JSON.stringify(sim.value.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), (sim.value.logs ?? []).filter((l: string) => /rror/.test(l)).slice(-3).join(" | ")); out[f.name] = { error: "sim failed" }; continue; }
  const accts = sim.value.accounts as any[];
  const postPayer = Number(accts[0].lamports), pre$ = Number(before.value);
  let rentSum = 0; const createdInfo: any[] = [];
  for (let i = 0; i < created.length; i++) {
    const a = accts[i + 1]; const space = a?.data ? Buffer.from(a.data[0], "base64").length : 0; const lam = a ? Number(a.lamports) : 0;
    const min = space ? await rent(space) : 0;
    rentSum += lam;
    createdInfo.push({ address: created[i], key: first.get(created[i])!.key, owner: a?.owner ?? "?", space, lamports: lam, rentExemptMin: min });
    console.log(`  ${created[i].slice(0, 8)}…  ${first.get(created[i])!.key.padEnd(58)} owner ${(a?.owner ?? "?").slice(0, 8)}…  ${String(space).padStart(5)} bytes  ${String(lam).padStart(8)} lamports  (getMinimumBalanceForRentExemption(${space}) = ${min})`);
  }
  const feeMsg = await rpc.getFeeForMessage(Buffer.from(tx.messageBytes).toString("base64") as any, { commitment: "confirmed" }).send();
  const delta = pre$ - postPayer;
  console.log(`network fee (getFeeForMessage): ${feeMsg.value} lamports | measured fee-payer delta in simulation: ${delta} lamports (${(delta / 1e9).toFixed(9)} SOL)`);
  console.log(`sum of created-account lamports (from simulation post-state): ${rentSum}`);
  console.log(`delta - rent sum = ${delta - rentSum}  (should equal the network fee if the simulation charges it and nothing else moves)`);
  out[f.name] = { created: createdInfo, fee: Number(feeMsg.value), simDelta: delta, rentSum, cb, transfers, ixCount: ixs.length, units: sim.value.unitsConsumed ? Number(sim.value.unitsConsumed) : null };
}
console.log("\nJSON " + JSON.stringify(out));
