# Magmos — Pitch & Demo Kit

**Real-time cross-border payroll & remittances on Arc.**
A business streams USDC to workers anywhere in the world, settled *per second*, claimed anytime,
and bridged home via Circle CCTP. Payroll that arrives the moment work happens.

Built for the **Stablecoin Commerce Stack Challenge** — Track 1: *Best Cross-Border Payments &
Remittances Experience (UAE → Global)*. Live on Arc testnet.

---

## The one-liner (say this first)
> "SWIFT takes 3 days and 6%. Magmos takes one second and cents — a UAE business streams USDC
> to a creator in Manila, Lagos, or Karachi who watches their pay tick up live, claims it, and
> bridges it home. It's running on Arc today, with the full Circle stack."

## The problem
- Cross-border payroll is **slow, opaque, and expensive.** The UAE is one of the world's biggest
  remittance corridors (~$40B+/yr outbound, ~88% expat workforce); workers lose **~6% to fees**
  and wait days.
- Marketplaces paying global sellers/creators batch payouts weekly/monthly, eat FX + wire costs,
  and give recipients **zero real-time visibility.**
- Existing crypto payroll still pays in **lump sums** — no continuous settlement, no idle-float
  yield, no per-second transparency.

## The solution
Magmos turns payroll into a **continuous stream** on Arc (Circle's USDC-native L1):
1. A business funds a USDC pool once and streams to any number of recipients, per second.
2. Recipients watch their balance **accrue live** and claim anytime — no invoices, no waiting.
3. Recipients **bridge claimed USDC home** via Circle CCTP, save it to a vault, or onboard with a
   **passkey** (no seed phrase).
4. Idle treasury float earns **yield** while it waits to be streamed. Fees are dollar-denominated
   and transparent; finality is deterministic.

## Why Arc + Circle (the technical story judges want)
- **USDC is the native gas token** — costs are predictable and dollar-denominated end to end.
- **Deterministic finality** — real-time financial workflows, no probabilistic waiting.
- **We use the Circle stack for real, not as a logo:** USDC rail · **CCTP v2** send-home ·
  **Circle Modular Wallets** passkey onboarding · a USYC-style yield vault. (Gateway + StableFX
  on the roadmap.)

## Why it's different (defensible wedge)
| | Traditional remittance | Crypto payroll (Sablier/Superfluid) | **Magmos** |
|---|---|---|---|
| Settlement | 1–3 days | lump-sum / flow | **per-second stream** |
| Fees | ~6% + FX | gas | **transparent, USDC-denominated** |
| Recipient UX | opaque | claim | **live ticker + claim + bridge home + passkey** |
| Cross-chain cash-out | — | — | **native via CCTP** |
| Idle-float yield | — | — | **yes (treasury vault)** |
| Chain | banking rails | EVM L2s | **Arc (USDC-native L1)** |

---

## What's actually built & working (be specific, it's a strength)
- **5 contracts live on Arc testnet, 49 passing tests** (unit + fuzz + integration + a
  reentrancy-attack test), **independently audited (3-agent review) with every finding fixed and
  redeployed.**
  - MagmosPayroll `0xA837eB367585399b972cDa816dB9DB3D74281287`
  - MagmosRegistry `0x9C73E54e78c0e1d5C46aC996A126Ba5B9d4fC501`
  - MagmosVault `0x9F4AeADcc5C21ACB1dC96C66947E4373C6abF322`
  - MagmosYieldVault `0x3e711d38FFC65C278Fe78eC981bc5cEC5807D0c2`
  - MagmosUSDC (faucet test token) `0x3248CcD4c276b4785f81f8c1207094262F67a33C`
- **Streaming verified on-chain** — create → fund → stream → claim → pause/resume/stop, with
  per-second accrual, against the live contracts (arcscan:
  https://testnet.arcscan.app/tx/0x1a34f34689e6271059b8e451264bcbf9ac02dcd407050cf4525f331188ae57a5 ).
- **Two premium Next.js apps** (sender dashboard + recipient portal) on wagmi/viem, chain-first,
  with a live per-second ticker, a treasury **yield page** (deposit idle USDC → grows at 5% APY,
  proven on-chain), a **faucet**, and a **Circle passkey** onboarding page.
- **CCTP v2 "send home" — the FULL loop, in-app**: approve + `depositForBurn` on Arc → Circle
  Iris attestation → the wallet switches to the destination chain (Sepolia / Fuji / Arbitrum /
  Base) and mints via `receiveMessage`, with a destination-explorer receipt. Both the
  `depositForBurn` and `receiveMessage` signatures verified against Circle docs *and* the
  on-chain contract source.
- **On-chain receipts & activity feed** — every fund / claim / pause / stop as an
  arcscan-linked receipt row (the track's "payouts with receipts", live from contract events).
- **One-command demo seeder** — spins up "Falcon Marketplace FZ-LLC" streaming to named
  recipients in Manila, Lagos, and Karachi.

## Honest status (what's a labeled next-step — say this plainly)
Judges trust teams who are precise about what's done vs. next. Ours:
- **Testnet, not mainnet** — Arc is testnet-only today; so are we.
- The app defaults to a **faucet-mintable test USDC** so anyone can try it instantly; **real
  Circle USDC is a one-env-var flip** (the contracts are token-agnostic). CCTP bridges *real*
  USDC, so the send-home demo runs in real-USDC mode with a little destination-chain gas.
- **Circle passkey wallet** is built and compiles; passkey (WebAuthn) needs a real biometric in a
  browser to fully verify.
- The **yield vault** is a working testnet demonstration of the "payroll that pays for itself"
  model; a production version routes to Circle/Hashnote **USYC** (which is KYC/teller-gated).

---

## Demo script (90 seconds, the money shot)
1. **Faucet.** `/faucet` → "Get 10,000 test USDC." *(Arc pays gas in USDC — grab a little from
   Circle's faucet.)*
2. **Sender (UAE marketplace).** Dashboard → **Fund payroll**: add recipients (a designer in
   Manila, a dev in Lagos, a writer in Karachi) with monthly USDC → approve → stream in one flow.
   *"One transaction. Three continents. Streaming now."*
3. **Live dashboard.** Each recipient's figure **ticks up per second**; pause/resume/stop one live.
4. **Recipient portal.** Switch to a recipient wallet → balance **counting up live** → **Claim** →
   USDC lands in ~a second (show the arcscan tx). *"No invoice. No 3-day wait. No 6% haircut."*
5. **Send home + passkey.** Bridge via **CCTP** ("earned in Dubai, spendable at home") and show
   the **passkey** onboarding ("get paid with Face ID — no seed phrase").
6. **Close.** *"Real-time, dollar-denominated, on Circle's stack. Live on Arc today."*

## Positioning taglines (pick per audience)
- Consumer/remittance: **"Your pay, arriving every second."**
- B2B/marketplace: **"Settle with the world in real time."**
- Investor/judge: **"Stripe-grade payout rails, stablecoin-native, on Arc."**

## Market
UAE outbound remittances are a top global corridor; global freelance/creator payouts and
marketplace settlement are exploding and underserved by real-time, low-fee rails. Stablecoin
settlement is the wedge; Arc makes it dollar-native.

## Roadmap (what "with funding" unlocks)
- Circle **Gateway** (unified treasury balance for the sender) · **StableFX** (pay-in-AED,
  settle-in-USDC) · CCTP **auto-mint** on destination · production **USYC** yield · compliance +
  fiat off-ramp partners per corridor · mainnet at Arc GA.

---

## Earned Wage Access — the wedge

A live competitor in India (Ashneer Grover's "Fund My Staff") launched this month on INR rails: an
NBFC, credit-bureau underwriting, and the **employer signing as guarantor**. All of that exists to
answer one question — *will this person actually get paid?*

Magmos answers it structurally. Payroll streams on-chain every second, so a worker's
earned-but-unclaimed balance is not a prediction; it is contract state, already escrowed by the
employer. That balance **is** the collateral.

So the product needs **no bureau, no guarantor, no underwriting, and no new KYC**:

- A draw can never exceed wages already accrued — enforced in the same accrual math `claim()` uses.
- Repayment is automatic and unfailable: the draw is deducted from the accrued balance it came
  from, so the next claim is simply smaller. There is no debt to default on.
- The 0.5% access fee is paid by **yield on the idle payroll float** — the employer's money works
  while it waits and covers the worker's fee. Auditable on-chain, per draw.

"Payroll that arrives every second" becomes **"payroll you can reach the moment you've earned it."**
Same rail, same escrow, no new risk — a feature competitors need a lending licence to match.
