<p align="center">
  <img src="magmos.png" alt="Magmos" width="120" />
</p>

<h1 align="center">Magmos</h1>
<p align="center"><b>Real-time cross-border payroll & remittances on Arc.</b><br/>
Stream USDC to anyone in the world, settled per second. Claim anytime. Bridge home via Circle CCTP.<br/>
<i>Payroll that arrives the moment work happens.</i></p>

<p align="center">
Built for the <b>Stablecoin Commerce Stack Challenge</b> — Track 1: Best Cross-Border Payments & Remittances Experience (UAE → Global).<br/>
🟢 <a href="https://magmos.vercel.app"><b>Live app → magmos.vercel.app</b></a> · <b>Arc testnet</b> chain 5042002 · <a href="https://testnet.arcscan.app/address/0xaE5A8a7F57490ada1d530fE4E6b8074B1E7dB36B">arcscan</a>
</p>

---

## Why

SWIFT takes 3 days and ~6%. A UAE marketplace using Magmos streams USDC to a designer in Manila,
a developer in Lagos, and a writer in Karachi — they watch pay tick up **per second**, claim it
in one transaction, and bridge it to their home chain via **Circle CCTP**. Transparent
dollar-denominated fees, deterministic finality, no seed phrase required (passkey onboarding).

## What's here

```
magmos/
├── contracts/       Solidity (Foundry) — 8 contracts live on Arc testnet, 139 tests
├── app/             Org dashboard + landing (Next.js 16 + wagmi/viem + Mongo)  → :3100  ▲ Vercel
├── employee/        Recipient portal (live ticker, claim, vault, CCTP, passkey)   → :3001
├── sdk/             @magmos/sdk — drop-in Pay button + stream client (wagmi/viem)
├── docs/            Docusaurus developer docs
├── demo-recording/  Headless recorder → narrated 5-min demo (real on-chain txns)
└── scripts/         One-command demo seeder
```

| Feature | Status |
|---|---|
| Per-second streaming payroll (fund / pause / resume / stop / re-hire) | ✅ live on Arc |
| Recipient live ticker + one-tx claim | ✅ |
| **Earned Wage Access** — draw pay you've already streamed, before payday | ✅ live on Arc |
| Access fee covered by payroll-float yield (the worker pays nothing) | ✅ live |
| **CCTP v2 "Send home"** cross-chain USDC bridge + Circle attestation | ✅ |
| **Circle Wallets** passkey onboarding (gasless claim, no seed phrase) | ✅ |
| Treasury **yield vault** — idle payroll float earns while it waits | ✅ live |
| On-chain receipts & activity feed | ✅ |
| In-app test-USDC **faucet** | ✅ |
| Org/recipient metadata API (EIP-191 auth + MongoDB) | ✅ |
| **Confidential payroll** — one-transaction settlement, nobody named on-chain | ✅ live on Arc |
| **Stealth-address delivery** — salary to one-time addresses, no external service | ✅ live on Arc |

## Earned Wage Access — pay you've earned, before payday

Wage-advance products can't verify you'll actually get paid, so they underwrite off credit
bureaus, charge payday-loan rates, or make your employer sign as guarantor. Magmos removes the
question entirely: because payroll **streams on-chain every second**, your earned-but-unclaimed
balance isn't a prediction — it's contract state, already escrowed by your employer.

So the accrued balance *is* the collateral, and a draw is not a loan:

- A draw can **never exceed wages already accrued** — enforced on-chain, in the same
  `_accrued`/`_effectiveEnd` math `claim()` uses, so the two can never disagree.
- Repayment is **structural, not promised**: the draw crystallizes accrual and subtracts from
  `pendingBalance`, so your next `claim()` is automatically smaller. There is no debt record to
  default on and nothing to collect.
- **No credit check, no bureau, no employer guarantor, no KYC beyond the wallet you already have.**
- The 0.5% access fee is **paid out of yield on the idle payroll float** — the employer's money
  works while it waits, and covers the worker's fee. Every draw's fee/subsidy split is on-chain.

Employers don't approve individual draws (that would reintroduce the guarantor model). They set
an exposure envelope once — `maxDrawBps`, a minimum draw, or off entirely — via `setPoolPolicy`.

> **Honest limitation.** A pool's balance is shared across its recipients and Magmos does *not*
> enforce that a pool is funded to cover every stream's full accrual — `claim()` already reverts
> with `InsufficientPoolBalance` when a pool runs dry, first-come-first-served. Advances don't
> create new insolvency risk, but they do **pull the timing of withdrawals forward**, which can
> surface an underfunded pool sooner. `drawableAmount` is therefore capped by the pool's actual
> balance, and the per-pool cap exists so an employer can bound this deliberately.

## Contracts (Arc testnet, chain `5042002`)

| Contract | Address |
|---|---|
| MagmosPayroll | `0xaE5A8a7F57490ada1d530fE4E6b8074B1E7dB36B` |
| MagmosStealthPayout (confidential delivery) | `0x20839c0D8a7453EE58F955e07C545607dA798ba7` |
| MagmosAdvance (earned wage access) | `0x532791bC95152424739950a90AC986FF196097FC` |
| MagmosEquityVault (oracle-priced RSU vesting) | `0x0CdF00A15E01C389d9F5e695c5b85Ba8b96BeBA7` |
| PythPriceRelay (AAPL/USD feed) | `0x6ED62679f04a0Ba3D9e4F1A79AaE316334CF3e2B` |
| MagmosRegistry | `0x9C73E54e78c0e1d5C46aC996A126Ba5B9d4fC501` |
| MagmosVault | `0x9F4AeADcc5C21ACB1dC96C66947E4373C6abF322` |
| MagmosYieldVault | `0x3e711d38FFC65C278Fe78eC981bc5cEC5807D0c2` |
| MagmosUSDC (faucet test token) | `0x3248CcD4c276b4785f81f8c1207094262F67a33C` |

**139 Foundry tests** (unit, fuzz, full-lifecycle, reentrancy-attack) — including the earned-wage
invariant `drawn + claimed == earned` under fuzz, and two that walk every topic *and* every data word
of every emitted log asserting no recipient address appears. Plus **49 TypeScript tests** covering
the stealth-address crypto and the Merkle commitment.

## Quickstart

```bash
# contracts
cd contracts && forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.6.1
forge test                                  # 139 tests

# org dashboard (needs .env.local — see .env.example)
cd app && bun install && PORT=3100 bun dev  # http://localhost:3100

# recipient portal
cd employee && bun install && PORT=3001 bun dev  # http://localhost:3001

# seed the full demo (org + 3 named recipients streaming on-chain)
./scripts/seed-demo.sh
```

Wallet setup: add Arc testnet to MetaMask (chain `5042002`, RPC `https://rpc.testnet.arc.network`,
symbol USDC) and grab gas at [faucet.circle.com](https://faucet.circle.com). Then mint test USDC
in-app at `/faucet`. Full guide: [RUN.md](RUN.md) · pitch & demo script: [PITCH.md](PITCH.md).

## Deploy (Vercel)

The dashboard + landing (`app/`) runs on Vercel → **[magmos.vercel.app](https://magmos.vercel.app)**.

Deploy your own:

1. Import this repo in Vercel and set **Root Directory = `app`** (the Next.js app lives there, not at the repo root). Next.js 16 is auto-detected and built with the committed `bun.lock`.
2. Add the environment variables from [`app/.env.example`](app/.env.example):
   - `MONGODB_URI`, `MONGODB_DB` — metadata store (org/recipient names only; never touches funds)
   - `NEXT_PUBLIC_ARC_RPC`, `NEXT_PUBLIC_MAGMOS_*`, `NEXT_PUBLIC_USDC` — Arc RPC + contract addresses (all public)
   - `NEXT_PUBLIC_SITE_URL` — your production URL (OG tags / sitemap)
   - `ANTHROPIC_API_KEY` *(optional)* — turns on the Magmos AI assistant; falls back to a heuristic if unset

```bash
cd app && vercel link && vercel --prod   # or connect the repo in the Vercel dashboard
```

## Circle stack usage

- **USDC** — the payroll rail (streams, claims, escrow). App runs on a faucet-mintable test USDC
  so anyone can try it; real Circle USDC (`0x3600…0000`) is a one-env-var flip.
- **CCTP v2** — `depositForBurn` on Arc (domain 26) → Iris attestation → mint on the destination
  chain, in-app.
- **Circle Modular Wallets** — passkey (WebAuthn) smart accounts on Arc with gasless claims.
- **USYC model** — the yield vault demonstrates "payroll that pays for itself"; production routes
  to Circle/Hashnote USYC.

## Confidential payroll

Streaming payroll on a public chain has an obvious problem: everyone's salary is readable by anyone
with a block explorer. Magmos splits the difference the way payroll actually needs it —
**confidential to the public, auditable to the employer.**

A payroll run settles in **one** transaction, `settleAllSealed(poolId, sealRef)`. That is the whole
calldata: a pool and an opaque commitment. No recipient, no per-person amount — not in the input,
not in the logs. What stays public is the aggregate: that an org ran payroll, the total, and the
headcount. That is deliberate. An employer's total spend is the part that should remain auditable;
an individual's salary is the secret.

Verify it yourself rather than taking the claim:

```bash
cd app && node scripts/verify-privacy.mjs
```

It takes the adversary's view — transaction hashes only, reading what any explorer reads — against
an observer who **already knows every employee address**, because if the strongest adversary can't
attribute a payment, a stranger certainly can't. It also keeps a known-leaky transaction under test
as a control, so the pass means something.

```
employee identities recoverable   : NO
per-recipient amounts recoverable : NO
```

### Delivery: stealth addresses

Settling privately is only half the job — the money still has to reach people, and an ordinary
ERC-20 payout would republish everything settlement just hid. Arc's own confidential transfers would
solve this, but Arc's docs state privacy is *"on the roadmap and not yet available"*, so Magmos
builds the delivery leg itself, on-chain, with **no external privacy service**.

Each employee publishes a meta-address once — a spending key and a viewing key, derived in their
browser from a wallet signature and never sent anywhere. For every payment the employer derives a
one-time address by ECDH:

```
R = r·G                    published in the Announcement
s = keccak256(r·V)         shared secret (employer has r, employee has v)
P = S + s·G                one-time stealth pubkey
```

Only the employee can compute the matching private key. Payments are committed as a Merkle root and
funded in **one** transaction — not N transfers, because N transfers publish N amounts together and
bind every recipient into a single correlatable cohort. Employees find their own payment by scanning
announcements with their viewing key, then claim whenever they like, to wherever they like. The
stealth address never needs gas: it only signs, and anyone can relay.

Run the whole thing yourself:

```bash
cd app && node scripts/stealth-run.mjs
```

Real transactions from that run — settle, batch, then three independent claims:

| Leg | Transaction |
| --- | --- |
| settleAllSealed | [`0x11eaf902…`](https://testnet.arcscan.app/tx/0x11eaf9027c2f28398ccd02fe95775b8f0f943575d7fdf04e18d6fafe81f25327) |
| fundBatch | [`0x56177654…`](https://testnet.arcscan.app/tx/0x561776540506a7b9794d503df8c18a3a9e2bda21ce7615462674c86c4d7f43dc) |
| claim ×3 | [`0x0a4016f7…`](https://testnet.arcscan.app/tx/0x0a4016f7d7b3633a8a6c957464dfd9abfcc30d3c9be1ffa7faa65b978dce5005) · [`0x1ec15b3b…`](https://testnet.arcscan.app/tx/0x1ec15b3b7803cf3203d886da13fb412e10d273936064a78004a418ed4d7eb901) · [`0xe990ab3b…`](https://testnet.arcscan.app/tx/0xe990ab3b32652e44c993ee2f346e3581f150210386385f5e5c4180fd260de66c) |

Across all five: **no employee address appears in any calldata or any log.**

## Honest status

Arc is testnet-only — so is Magmos. The CCTP destination mint and passkey flows are wired and
compile; end-to-end verification of those two requires a wallet on the destination chain and a
browser biometric respectively.

An earlier revision of this project settled payroll one employee at a time and described that as
private. It was not: `settleSealed`'s calldata carries the recipient and the amount, and calldata is
public regardless of what an event emits. That is fixed — payroll goes through `settleAllSealed` —
and the verification script keeps the old path under test as a control so the mistake cannot quietly
return.

An employee who has not registered a payout key is **not paid** by the confidential path. They are
held back and reported, rather than quietly paid in the clear.

---

<p align="center">Magmos is the Arc-native evolution of <a href="https://github.com/snehendu098/sweem">Sweem</a> (streaming payroll on Sui).</p>
