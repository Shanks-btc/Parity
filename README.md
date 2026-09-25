# Parity

**Prime brokerage for tokenized stocks on Solana.** Parity is an intent-driven agent that helps a
holder of xStocks (tokenized equities such as AAPLx and SPYx) earn yield or borrow against them.
It is built on [Kamino Lend](https://kamino.finance)'s live xStocks market, with
[Pyth](https://pyth.network) as an independent price check. The agent verifies every step against
real on-chain data, and simulates the exact transaction on mainnet, before it proposes anything.
Nothing executes without the user's signature.

Built for Stocklana, 2026.

## Status at a glance

| Area | State | How it was verified |
|---|---|---|
| Kamino market reads (reserves, positions, capabilities) | ✅ Working, live mainnet | `check:market`, `check:agent` |
| Deposit / borrow / USDC-supply transaction building | ✅ Built, **simulated** on mainnet | `check:execute`, `check:yield` |
| SPYx Multiply (flash loan + Jupiter swap + deposit/borrow) | ✅ Built, **simulated** on mainnet | `check:multiply-deposit` |
| Agent loop (Claude + tools + on-chain validation gate) | ✅ Working end-to-end | `check:agent` |
| Send + confirm layer (sign in wallet → submit → confirm) | ✅ Verified on **devnet** only | `check:send-devnet` |
| Pyth divergence check | ⚠️ Code and feed IDs in place; Pyth returns **403** for equity and xStock feeds (API-key entitlement; crypto majors like BTC/SOL are reachable) | `check:feeds`, `check:agent` |
| Real mainnet transactions | ⏸ Deliberately not done yet — deferred until the frontend's wallet-signing flow exists | — |
| Frontend (`dashboard/`) | 🚧 Phase 1: landing page + Trade concept page. No wallet, no agent API, no live data fetching yet | Responsive checks at 375–1920px |

See [TESTPLAN.md](TESTPLAN.md) for every check, what it proves and its last verified result.

## How it works

1. **Connect:** Parity reads the wallet's real Kamino position, broken down per reserve: which
   asset is deposited, which is borrowed, the amounts, and the health factor.
2. **State an intent** in plain language ("I want yield without selling my AAPLx").
3. **Verify:** the agent (Claude, via tool calls) checks, in order:
   - what the asset actually supports on Kamino, live (`get_asset_capabilities`). For example,
     AAPLx supports Borrow and Earn; SPYx also supports Multiply.
   - the Pyth price against the xStock's on-chain price (`check_price_divergence`). If that check
     is unavailable, the agent sizes more conservatively and says so.
   - the exact transaction, simulated atomically against live mainnet state
     (`validate_strategy`). A failed simulation makes the agent revise its proposal.
4. **Review, then sign:** `propose_strategy` is only accepted if it matches a successful simulation
   exactly. It is also rejected if it makes a capability claim about any asset the agent didn't
   actually check.

## Repository layout

```
src/
  kamino/    Kamino client (klend-sdk v7 / @solana/kit), transaction building, simulation,
             transport/submit/confirm, Jupiter swap wiring, verification scripts (inspect-*.ts)
  pyth/      Pyth Hermes divergence check + feed registry
  agent/     Agent loop (core.ts), tools, on-chain strategy validator, capability-grounding guard,
             CLI and end-to-end check
scripts/     snapshot-landing-figures.ts: writes the landing page's market figures from live data
dashboard/   Next.js 16 + Tailwind v4 frontend (landing page, /trade concept)
```

## Setup

Requires Node 20+ (developed on Node 24).

```bash
npm install
cp .env.example .env   # then fill in the values below
```

| Variable | Needed for |
|---|---|
| `SOLANA_RPC_URL` | Everything. The public mainnet RPC works but rate-limits (HTTP 429); a dedicated provider is recommended. |
| `KAMINO_MAIN_MARKET` | The xStocks market: `5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua` (verified live). |
| `ANTHROPIC_API_KEY` | The agent (`dev:agent`, `check:agent`). |
| `PYTH_HERMES_URL`, `PYTH_API_KEY` | Pyth divergence checks. Since Pyth's 2026-08-26 upgrade, price reads need a key with equity-feed entitlement. |

### Commands

```bash
npm run check:market            # list the market's reserves and risk parameters (read-only)
npm run check:agent             # full agent loop for an AAPLx and a SPYx intent (simulation only)
npm run dev:agent               # interactive agent CLI (run it interactively; piped stdin exits early on Windows)
npm run snapshot:landing        # refresh dashboard/lib/market-snapshot.json from live Kamino data

cd dashboard && npm install && npm run dev   # frontend at http://localhost:3000
```

## Things worth knowing

- **xStocks live in their own Kamino market**, not Kamino's classic Main market.
- **Wallet displays inflate xStock balances.** xStocks use Token-2022's scaled-UI-amount
  extension, so a wallet's displayed balance (uiAmount) is slightly higher than the raw balance
  Kamino can actually move. Parity sizes from the raw amount.
- **Borrowing USDC to supply it back currently loses money.** As last checked, the USDC borrow
  APY is above the supply APY. The agent flags this negative carry, and the landing page shows it.
- **Nothing in this repo signs anything.** Transactions are built unsigned and simulated with
  signature verification off. The send path accepts only transactions already signed by the
  user's wallet, and has only been exercised on devnet.
