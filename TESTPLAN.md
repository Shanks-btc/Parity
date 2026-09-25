# Parity — Test plan

Every check below runs against **real infrastructure**: Solana mainnet (read and simulate only),
Solana devnet (the send/confirm check), Kamino's API, Jupiter, Pyth Hermes and the Anthropic API.
There are no mocks. Mainnet checks never sign or send; they use `simulateTransaction` with
signature verification disabled.

Run everything from the repo root with a filled-in `.env` (see [README.md](README.md)).

## Backend checks

| Command | What it proves | Last verified | Result |
|---|---|---|---|
| `npm run check:market` | The xStocks market loads; lists the 10 xStock reserves (AAPLx, TSLAx, SPYx, QQQx, NVDAx, GOOGLx, HOODx, MSTRx, METAx, CRCLx) with real LTV and liquidation thresholds (AAPLx 40%/50%, SPYx 73%/75%, TSLAx 55%/65%) | 2026-09-24 | ✅ |
| `npm run check:multiply` | Reads Kamino's live leverage metrics: which xStocks have live Multiply positions | 2026-09-22 | ✅ SPYx yes, AAPLx no |
| `npm run check:execute` | Builds a small AAPLx deposit for a real AAPLx holder and simulates it on mainnet | 2026-09-24 | ✅ simulation success |
| `npm run check:yield` | Builds a 1 USDC deposit into the xStocks market's USDC reserve and simulates it | 2026-09-24 | ✅ simulation success |
| `npm run check:multiply-deposit` | Builds a SPYx Multiply open (flash loan + Jupiter swap + deposit/borrow, fitted under the 1232-byte limit with lookup tables) and simulates it | 2026-09-24 | ✅ simulation success |
| `npm run check:agent` | Full agent loop for two intents (AAPLx borrow/earn; SPYx leverage). The trace must show a real mainnet simulation inside `validate_strategy` (slot + compute units) and a `propose_strategy` accepted by the validation and capability-grounding gates | 2026-09-24 | ✅ both proposed; AAPLx borrow-only (Multiply correctly unavailable), SPYx 1.5× Multiply |
| `npm run check:send-devnet` | Devnet only, throwaway keypair: serialize → wallet-side sign → submit → confirm, plus the "failed" (on-chain error with logs) and "timeout" outcomes | 2026-09-24 | ✅ tx `njdQBENC…Hsh6` confirmed and finalized at slot 503430923 |
| `npm run check:feeds` | Fetches AAPLx's real-equity and wrapper prices from Pyth Hermes and computes the spread (needs `PYTH_API_KEY` with equity-feed entitlement) | 2026-09-24 | ⚠️ 403 from Hermes (entitlement). A per-feed probe with the same key: BTC/SOL/USDC → 200 with live prices; Equity.US.AAPL/SPY → 403; Crypto.AAPLX/SPYX (the xStocks' own feeds) → 403 "Not entitled" |

### What to look for in `check:agent`

- `get_position` reports holdings per reserve. Wallet `Gm1m…` holds **MSTRx** collateral, not
  AAPLx. That exact mislabel happened once before the per-reserve fix.
- `get_asset_capabilities`: AAPLx `multiply=false`, SPYx `multiply=true`.
- `validate_strategy` returns `simulation.ran: true` with a real `slot`. A failure includes the
  on-chain reason (e.g. `BorrowTooLarge`) and the agent revises.
- The final proposal carries `validation.simulatedAtSlot`, and its `assetCapabilities` lists only
  assets that were queried.

### Test wallets (real mainnet wallets, read/simulate only)

| Wallet | Holdings (re-checked by `get_position` on every run) |
|---|---|
| `A3iPNQiG7sCAmL4dsAVr9RFmjh9EJEbh4jHprpk4DxdP` | Spot AAPLx and other xStocks; no Kamino obligation |
| `BWEJgsSutAxMEWNXTUKSnBaWHHMpQikcHmbmFz8nqEnZ` | Spot SPYx; a small SPYx Multiply obligation |
| `Gm1mMs1Bs5imsbSMPoAFFCAcQHuBsZPmTeEE3uKRNLG2` | Vanilla obligation: **MSTRx** collateral, USDC debt |

## Frontend checks (`dashboard/`)

| Check | How | Last verified | Result |
|---|---|---|---|
| Production build | `cd dashboard && npm run build` (also `npm run lint`) | 2026-09-24 | ✅ clean, no warnings |
| Responsive layout | Headless Chrome at 375, 390, 768, 1024, 1280, 1440 and 1920px on `/` and `/trade`. Checks: no horizontal overflow; nav inline at md+ and hamburger below; section layouts per breakpoint; headline sizes; Trade column order (chart → long/short → orderbook below lg) | 2026-09-24 | ✅ all 7 widths |
| New landing sections (Why Solana/Pyth, Proof, closing CTA, footer) | Same 7 widths: no overflow; 2-col → stacked below lg; CTA photo self-hosted (0 requests to unsplash), `object-fit: cover`, fills the section; CTA buttons stacked full-width below sm; footer stacked + centered below md, brand-above-columns md–lg, side by side lg+. CTA text contrast measured against the rendered photo's worst pixel under each text box | 2026-09-24 | ✅ all 7 widths; small text ≥ 5.41:1, headline ≥ 6.92:1 |
| Landing figures | Come from `dashboard/lib/market-snapshot.json`, written by `npm run snapshot:landing`: live Kamino reads (APYs, LTV/liquidation thresholds, Multiply positions per asset, xStock reserve count), the agent's validator simulating borrow / borrow+earn / SPYx Multiply on mainnet (compute-unit range), and the devnet proof tx's real fee priced at Pyth's live SOL/USD. The page shows the check time and slot | 2026-09-24 | ✅ borrow / borrow+earn / SPYx + TSLAx Multiply all simulate: 281k–432k CU; fee 5,000 lamports (~$0.0006); 10 reserves |

### Wallet connection (`dashboard/`, mainnet-only)

| Check | How | Last verified | Result |
|---|---|---|---|
| Connect / disconnect through the app's real wallet-adapter code | Headless Chrome with a spec-compliant **Wallet Standard test wallet** injected into the page (the protocol Phantom and Solflare register through): modal → connect → truncated key in nav/hero/CTA → menu (copy, disconnect) → disconnect → reload. 32 checks, on the dev server and a production build | 2026-09-25 | ✅ all pass |
| Connect/disconnect make no RPC calls | Recorded every request during the flow | 2026-09-25 | ✅ zero requests to any Solana RPC host |
| Real Phantom / Solflare extension | **Manual** — needs an unlocked wallet in a real browser profile | not yet run | ⏳ see checklist in the phase report |

## Deliberately not tested yet

- **Real mainnet transactions.** Deferred until the frontend's wallet-signing flow exists.
- **Pyth divergence math on live equity prices.** Blocked on the API-key entitlement (403).
- **Wallet connect, the agent API route, and the Portfolio/Earn/Borrow screens.** Later frontend
  phases.
