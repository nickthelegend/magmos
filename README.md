<p align="center">
  <img src="magmos.png" alt="Magmos" width="120" />
</p>

<h1 align="center">Magmos</h1>
<p align="center"><b>Real-time cross-border payroll & remittances on Arc.</b><br/>
Stream USDC to anyone in the world, settled per second. Claim anytime. Bridge home via Circle CCTP.<br/>
<i>Payroll that arrives the moment work happens.</i></p>

<p align="center">
Built for the <b>Stablecoin Commerce Stack Challenge</b> — Track 1: Best Cross-Border Payments & Remittances Experience (UAE → Global).<br/>
🟢 <a href="https://magmos.vercel.app"><b>Live app → magmos.vercel.app</b></a> · <b>Arc testnet</b> chain 5042002 · <a href="https://testnet.arcscan.app/address/0xA837eB367585399b972cDa816dB9DB3D74281287">arcscan</a>
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
├── contracts/       Solidity (Foundry) — 6 contracts live on Arc testnet, 93 tests
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
| MagmosPayroll | `0xA837eB367585399b972cDa816dB9DB3D74281287` |
| MagmosAdvance (earned wage access) | `0x532791bC95152424739950a90AC986FF196097FC` |
| MagmosEquityVault (oracle-priced RSU vesting) | `0x0CdF00A15E01C389d9F5e695c5b85Ba8b96BeBA7` |
| PythPriceRelay (AAPL/USD feed) | `0x6ED62679f04a0Ba3D9e4F1A79AaE316334CF3e2B` |
| MagmosRegistry | `0x9C73E54e78c0e1d5C46aC996A126Ba5B9d4fC501` |
| MagmosVault | `0x9F4AeADcc5C21ACB1dC96C66947E4373C6abF322` |
| MagmosYieldVault | `0x3e711d38FFC65C278Fe78eC981bc5cEC5807D0c2` |
| MagmosUSDC (faucet test token) | `0x3248CcD4c276b4785f81f8c1207094262F67a33C` |

**93 Foundry tests** (unit, fuzz, full-lifecycle, reentrancy-attack) — including the earned-wage
invariant `drawn + claimed == earned` under fuzz — plus a 3-agent code review with every finding
fixed and redeployed.

## Quickstart

```bash
# contracts
cd contracts && forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.6.1
forge test                                  # 93 tests

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

## Honest status

Arc is testnet-only — so is Magmos. The CCTP destination mint and passkey flows are wired and
compile; end-to-end verification of those two requires a wallet on the destination chain and a
browser biometric respectively. Everything else above is proven live on-chain.

---

<p align="center">Magmos is the Arc-native evolution of <a href="https://github.com/snehendu098/sweem">Sweem</a> (streaming payroll on Sui).</p>
