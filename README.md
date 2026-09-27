Parity is an onchain prime brokerage for tokenized stocks. A user states a goal in plain language or picks it from a guided wizard, an agent checks their real Kamino position and cross-checks the asset's price against Pyth, and only after a real transaction  succeeds does it propose anything for the user to sign.

I built Parity around a simple question: what should an agent be allowed to tell a user before it's actually checked? A recommendation that sounds confident isn't the same as one that's been verified against real state, and a system that can't tell the difference will eventually propose something wrong with total conviction. Every proposal Parity makes has to survive contact with a real position, a real price check and if any of those can't be completed, the agent has to say so, not fill the gap with a guess.

Project stage: Backend fully live-verified against Solana mainnet, real Kamino market reads, real obligation reads, real transaction, real Jupiter swap construction. The sign to submit to confirm pipeline is proven end-to-end on devnet. Every mainnet transaction type has been built and successfully  against live mainnet state; a real signed mainnet transaction.

## Demo

Watch the walkthrough: https://vimeo.com/manage/videos/1230313058 

## Why Parity

Retail margin is expensive and manual. A major brokerage's own published small-balance margin rate is roughly 11.8%; Parity's live rate on Solana via Kamino is currently in the 7% range, checked directly against Kamino's market, not estimated. But cheaper access isn't the interesting part on its own. The interesting part is that most tools in this space will happily show you a recommendation built on stale data, an unavailable price feed, or an assumption about your position that was never actually checked. Parity is built so that can't happen quietly.

Real checks, not a form: every proposal is preceded by a live read of the user's actual position, not a number they typed in.
Causal grounding, not vibes: the agent doesn't just say "yield on SPYx"  it reads what that specific asset actually supports (Borrow, Earn, Multiply are asset-dependent, and the agent is not allowed to claim a capability it hasn't queried this turn).
Degradation is explicit, never silent: when Pyth's price check is unavailable, the agent says so and sizes conservatively, proven directly, not just described, by the account's real entitlement gap.

Non-custodial by construction: Parity never holds a user's keys or funds. Every transaction is built unsigned, and the user's own wallet signs it.

## How Parity works

A user reaches a proposal two ways, directly through the Borrow/Earn pages, or through a 4-step wizard (What do you want to do? → Which asset? → Market outlook? → Risk tolerance?) that composes the answers into the same real intent and runs the same real agent. Both paths call identical backend code; the wizard is a different way to reach the same real reasoning, not a separate simplified version of it.

The flow: state intent → agent checks position and capabilities → agent checks price → agent simulates the transaction → agent proposes → user signs.

1. The agent reads the user's real Kamino obligation — per-asset collateral, borrow, and health factor, not an aggregate.
2. It checks which capabilities (Borrow, Earn, Multiply) the specific asset actually supports right now, live.
3. It cross-checks the asset's price against Pyth's real feed, flagging a stale or unavailable check explicitly rather than proceeding as if it succeeded.
4. It simulates the exact transaction against live mainnet state and only proposes a strategy once that simulation passes.
5. The user reviews the real numbers and signs, or doesn't. Parity never signs on a user's behalf.

## Core components

| Component | What it does | Where it lives |
|---|---|---|
| Kamino client | Market/reserve/obligation reads, transaction construction, simulation | `src/kamino/` |
| Pyth client | Live price feed reads via Hermes | `src/pyth/` |
| Jupiter integration | Swap quoting and standalone swap construction | `src/kamino/jupiter.ts` |
| Agent core | Claude-driven reasoning loop, tool definitions, grounding checks, strategy validation | `src/agent/` |
| Dashboard | Landing, Borrow, Earn, Portfolio, Trade, the wizard | `dashboard/` |
| Wizard | Guided 4-step intent flow, feeds the same real agent | `dashboard/components/wizard/` |

## Current status

| Surface | Status | Meaning |
|---|---|---|
| Backend | Live-verified, mainnet | Real Kamino/Pyth reads, real transaction simulation, all against live mainnet state |
| Frontend | Deployed on Railway | Next.js, real API routes wrapping the backend |
| Wallet connection | Real, tested | Phantom/Solflare via wallet-adapter, verified against a real extension |
| Signing | Devnet proven, mainnet simulated | Sign→submit→confirm pipeline confirmed end-to-end on devnet; every mainnet transaction type built and simulated, not yet signed live |
| Pyth equity feed | Blocked | Current API key lacks equity-feed entitlement; the agent's degradation path is what's tested, not the successful check itself |
| Trade | Concept only | No live equity-perpetual market exists anywhere on Solana yet |

## What the runs have shown

A real deposit/borrow simulation against AAPLx returned Kamino's own live oracle price (339.02) captured mid-transaction, not a cached or assumed value.
A negative-carry strategy (borrowing to redeposit for yield) was correctly identified as unprofitable at current real rates, and the agent's own reasoning states it won't recommend the strategy until the math turns positive — proven on a real run, not asserted in copy.
A decimal-scaling bug (human-readable amounts passed where the SDK expected raw integer units) was caught by a real `bn.js` "Invalid character" error during simulation, not a code review.
A stale, inflated Jupiter quote reused for an actual swap was caught by Jupiter's own real `6024` error; the fix fetches a fresh quote for the exact amount actually being borrowed.
An instruction-ordering defect in a combined deposit+borrow transaction was caught by Kamino's real `InvalidAccountInput` rejection, not discovered by inspection.
When Pyth's equity feed returned a real 403 (confirmed: `no grant accepts this feed (asset type 'equity'...)`), the agent's grounding check correctly forced a fallback proposal rather than silently proceeding as if the check had passed.

## Verification

Parity's verification layer is load-bearing, not decorative: every proposal is checked against real position data, a real price feed, and a real transaction simulation, and the result changes what the agent is allowed to say. Remove any one of these checks and the agent cannot tell a safe proposal from an unsafe guess.

**What is verified.** Three things, every time, before a proposal is assembled: the user's real per-asset position (not an aggregate), the asset's real capabilities (Borrow/Earn/Multiply, live from Kamino, not assumed from the asset's name), and the transaction's real outcome under simulation (projected health factor, compute cost, whether it would actually succeed on mainnet).

**How a fresh request verifies it.** Every call to the agent is independent — there is no cached position or capability assumption carried between requests. The position is read fresh, the capability check runs fresh (with a short-lived cache only as a fallback if Kamino's own API is slow, never as a substitute for a real check), and the simulation is run fresh against current mainnet state.

**What changes because of it.** A proposal's size, its stated risks, and whether it's shown at all depend directly on these checks. A wallet with a lower health factor gets a more conservative proposal. A blocked Pyth check produces an explicit disclosure and a smaller position size, not a silently confident one. A failed simulation (confirmed directly: an oversized borrow rejected with Kamino's real `BorrowTooLarge` error) blocks the proposal from being shown at all.

**What breaks if verification is removed.** The agent would have no way to distinguish a real position from an assumed one, a live capability from a stale one, or a transaction that would succeed from one that would fail on-chain. It would still sound confident — it just wouldn't be trustworthy.

**Data sources.** Kamino Lend (positions, reserves, simulation), Pyth Network (price verification, currently entitlement-blocked for equities), Jupiter (swap quotes and construction), Solana mainnet (the ground truth all of the above reads against).

## Public endpoints

| Service | URL |
|---|---|
| Parity dashboard | `<insert current live Railway URL once redeploy is confirmed>` |
| Repository | https://github.com/Shanks-btc/Parity |

## Architecture

| Layer | Responsibility | Primary location |
|---|---|---|
| Backend | Kamino/Pyth/Jupiter integration, transaction construction and simulation | `src/` |
| Agent | Reasoning loop, tool definitions, grounding checks, strategy validation | `src/agent/` |
| API | Server-side routes wrapping the backend for the dashboard | `dashboard/app/api/` |
| Dashboard | Landing, Borrow, Earn, Portfolio, Trade, wizard | `dashboard/app/`, `dashboard/components/` |
| Wallet | Real Phantom/Solflare connection via wallet-adapter | `dashboard/components/wallet/` |

## Proposal sequence

1. The agent reads the user's real position (`get_position`) — per-reserve, not aggregate.
2. It checks the asset's live capabilities (`get_asset_capabilities`) — never asserted from memory or the asset's name alone.
3. It checks the asset's price against Pyth (`check_price_divergence`) — a blocked or stale check is disclosed, not hidden.
4. It builds and simulates the actual transaction (`validate_strategy`) against live mainnet state.
5. Only after all of the above succeed (or explicitly degrade with disclosure) does it produce a proposal (`propose_strategy`) for the user to review.
6. The user signs, or doesn't. Nothing is submitted without their signature.

## Trust and safety model

### Network separation

| Purpose | Network | Write policy |
|---|---|---|
| Position/reserve/price reads | Solana mainnet | Read-only |
| Transaction simulation | Solana mainnet | Simulated, never submitted without a user signature |
| Sign→submit→confirm pipeline proof | Solana devnet | Real, confirmed, no real-value funds involved |
| Trade page data | Simulated, client-side | No network calls, no real market to execute against |

### Rate limiting and fail-closed behavior

`/api/intent` (the agent's real reasoning loop) is rate-limited per IP, since every call is real, billed inference. `/api/submit-transaction` rejects malformed or unsigned input before it reaches the network. If a live capability check times out, the system falls back to the last successfully cached result rather than fabricating data, and logs that the fallback path was used.

### Secret handling

Local secrets live in a gitignored `.env` / `.env.local`. Production secrets are set directly on Railway, never committed. The dashboard's public-facing RPC key is domain-restricted separately from the backend's private key.

## Quick start

### Requirements

- Node.js 18+
- A Solana RPC provider (a dedicated one — the public endpoint reliably times out on real Kamino reads)
- API keys: Anthropic, Pyth, Finnhub (optional, for Trade's one real price element)

### Install

```
git clone https://github.com/Shanks-btc/Parity.git
cd Parity
npm install

cd dashboard
npm install
```

### Run locally

```
# Backend verification (run from repo root)
cp .env.example .env   # fill in ANTHROPIC_API_KEY, SOLANA_RPC_URL, PYTH_API_KEY, KAMINO_MAIN_MARKET
npm run check:market
npm run check:feeds

# Frontend
cd dashboard
cp .env.example .env.local
npm run dev
```

## Useful commands

| Command | Purpose | Network/write behavior |
|---|---|---|
| `npm run check:market` | Confirms Kamino market/reserve reads | Real mainnet reads |
| `npm run check:feeds` | Confirms Pyth connectivity | Real Hermes reads |
| `npm run check:agent` | Runs the full agent reasoning loop against a real wallet | Real mainnet reads, real Anthropic spend |
| `npm run snapshot:landing` | Refreshes the live figures shown on the landing page | Real mainnet + Kamino API reads |

## Repository layout

```
src/
  kamino/       market/reserve/obligation reads, transaction builders, simulation, Jupiter swap construction
  pyth/         Hermes price feed client
  agent/        reasoning loop, tool definitions, grounding checks, strategy validation
dashboard/
  app/          landing, borrow, earn, portfolio, trade, api routes
  components/   wizard, wallet connection, landing sections, trade UI
scripts/        live-data snapshot generation for the landing page
TESTPLAN.md     the full live verification sequence and its real, dated results
```

## How I approach the build

Make the agent's claim no stronger than what it actually checked.
Never let a proposal survive on an assumption a real read could have replaced.
Store the real reason a check failed, not just that it did.
Degrade explicitly when a dependency is unavailable, rather than filling the gap with a guess.
Verify a builder's real API surface against the installed source, not the README — documentation goes stale before code does.
Independently re-confirm every on-chain claim against a live RPC call, not just an SDK's own response.
Stop before signing anything real, and say exactly what's ready, rather than assuming authorization that was never given.

An onchain prime brokerage for tokenized stocks, built for Stocklana (Solana Foundation hackathon). Kamino for collateral and yield, Pyth for independent price verification, Claude for the reasoning loop.
