# Earned Wage Access — build notes, demo path, and honest limits

Ship state: **live on Arc testnet**, with real on-chain draws. This document is the operator's
guide — what was built, how to demo it, and what is genuinely not solved yet.

## What it is

A worker draws wages they have **already streamed and earned**, instantly, before the payroll
claim event. Repayment happens automatically, because the draw is deducted from the accrued
balance it came out of.

It is not a loan and deliberately cannot become one: `MagmosPayroll.settleAdvance` reverts with
`ExceedsClaimable` on any amount above what the stream has accrued.

## Architecture — why it is two contracts

`MagmosPayroll` custodies the USDC and owns stream accounting, so no external contract can move
`pool.balance` or touch `pendingBalance`. A "fully standalone" advance contract is therefore
impossible without either duplicating the stream math (which would drift and become exploitable)
or turning the product into a real loan with default risk.

The split that works:

| | |
|---|---|
| **MagmosPayroll** (`settleAdvance`) | The single privileged primitive. Reuses `_effectiveEnd`/`_accrued` verbatim — the exact functions `claim()` uses — then crystallizes accrual into `pendingBalance` and subtracts the drawn amount. ~35 lines. Core streaming math untouched. |
| **MagmosAdvance** | Everything else: per-pool policy, the access fee, the yield subsidy, the audit trail, and every view the UI needs. Auditable in isolation. |

`advanceModule` is settable **once, by the deployer, ever** (`AdvanceModuleAlreadySet`), so a later
key compromise cannot redirect recipient funds through a malicious module.

**There is deliberately no debt ledger.** Reducing `pendingBalance` *is* the deduction. A parallel
"amount owed" number could drift from stream state; this one cannot.

## Who pays for it

The access fee is 0.5% (hard-capped at 2% by `MAX_ADVANCE_FEE_BPS` — EWA must never drift into
payday-loan pricing). Idle payroll float earns yield in `MagmosYieldVault`; that yield is parked in
`MagmosAdvance` via `fundSubsidy()` and absorbs the fee, so the worker typically pays **nothing**.

The split is on-chain per draw and aggregated in `stats()`:
`totalFeesCharged`, `totalFeesSubsidized`, `feesPaidByWorkers`, `totalYieldContributed`. The
dashboard's "the float pays, not the worker" claim is therefore auditable rather than asserted.

## Employer controls

Employers do **not** approve individual draws — that would reintroduce the guarantor model this
exists to remove. They set an envelope once, for their own pool:

```solidity
advance.setPoolPolicy(poolId, maxDrawBps, minDraw, disabled);
```

## ⚠️ Honest limitations

1. **Pools can be underfunded, and advances pull that forward.** `pool.balance` is shared across
   all recipients with no solvency invariant; `claim()` already reverts `InsufficientPoolBalance`
   when a pool runs dry (first-come-first-served — the dashboard's "Runway" card is exactly this).
   Advances add no *new* insolvency risk but do accelerate withdrawal timing, which can surface a
   shortfall sooner for coworkers. Mitigations shipped: `drawableAmount` is capped by the pool's
   real balance, and `maxDrawBps` lets an employer bound exposure deliberately.
2. **Redeploy required.** `settleAdvance` is new bytecode, so MagmosPayroll was redeployed. The
   previous instance is kept in `deployments/arc-testnet.json` as `MagmosPayroll_v1_noEWA` for
   provenance of earlier demo transactions.
3. **Arc's public RPC rate-limits hard, and that shaped the client.** Measured: a single
   `eth_call` succeeds while 12 concurrent calls all fail in ~250ms with HTTP 429
   `-32011 request limit reached`. viem's `batch.multicall` transport option did not reliably
   coalesce them, so the per-recipient fan-out is issued as an **explicit multicall3 aggregate**
   (12 reads → 1 request, ~740ms). `eth_getLogs` is separately capped at a 10,000-block range,
   hence the 9k window for draw history; the authoritative lifetime total comes from `accountOf`
   (plain state), never from logs. **For demo day, point `NEXT_PUBLIC_ARC_RPC` at a dedicated
   endpoint** — a shared IP that has been hammered by testing will throttle the dashboard, and
   both apps now show an honest "Can't reach Arc" banner rather than fabricating zeros.
4. **CCTP bridges Circle USDC, streams use the faucet token.** This is pre-existing and unchanged
   by EWA — see below.

## Circle surface (Feature 3) — confirmed, not rebuilt

- **CCTP "send home"** needed **zero** special-casing. A draw delivers plain USDC to the worker's
  own wallet in the same transaction, exactly as a claim does; `SendHomeCard` operates on the
  wallet's balance and is already decoupled from the claim flow. Note the pre-existing detail that
  CCTP bridges native Circle USDC (`0x3600…0000`) while the demo streams the faucet-mintable test
  token — drawn funds are therefore exactly as bridgeable as claimed funds, no more, no less.
  Pointing `NEXT_PUBLIC_USDC` at real USDC makes both bridge natively.
- **Circle Wallets passkey / gasless** needed no new plumbing: `sendGaslessCall(ctx, {to, data})`
  is generic over any call. `/passkey` now offers a gasless **"Get X USDC early"** alongside the
  gasless claim, routed through that generic helper (it previously had no callers).

## Demo click-path

Seed first — this funds the pool, parks 50 USDC of yield subsidy, and draws one real advance:

```bash
SKIP_API=1 ./scripts/seed-demo.sh          # add SEED_ADVANCE=0 to skip the EWA seeding
```

Then record:

1. **Employer** → `localhost:3100/dashboard/payments`. Scroll to **Early wage access**: advanced to
   date, live drawable exposure, and "% of access fees covered by yield" with the ledger beneath.
   The streams table now carries a **Drawn early** column per recipient.
2. **Worker** → `localhost:3001` with a key from `scripts/.demo-wallets.json`. The stream card
   shows the live ticker, then the **GET PAID EARLY** band: what's available right now and why.
3. Click **Draw now** → pick an amount (or **Max**) → the modal shows the fee, the yield subsidy
   covering it, and what you receive. Confirm.
4. The sonner toast shows the **real tx hash** with a **Receipt** link to arcscan.
5. Watch **Claimable now drop by exactly the drawn amount** — that is the repayment, live. The band
   then reads *"You have drawn X early. It is already netted off your next claim."*
6. **Block explorer** → open the receipt; the `AdvanceDrawn` event carries amount, fee,
   subsidizedByYield, netToWorker and remainingClaimable.

`demo-recording/verify-ewa.mjs` drives all of this headless with an injected provider (keys stay
in Node) and screenshots each step into `demo-recording/shots-ewa/`.

## Real transactions from this build

| What | Tx |
|---|---|
| Pool created + 3 streams funded | [`0x11841238…3521d1`](https://testnet.arcscan.app/tx/0x11841238783eb2e65345ab74ad28484b8666b5a3a4546eeb3c5914727e3521d1) |
| First earned-wage advance (seeder) | [`0x509b28e3…425b628`](https://testnet.arcscan.app/tx/0x509b28e34b2f88439c3a308c567bfa451fb95cbf742bd2676811efdd2425b628) |
| Advance drawn from the UI | [`0x81b9c7f4…f36fb7`](https://testnet.arcscan.app/tx/0x81b9c7f4086f5b0b599ddffc22470120022175f55f832b5c3bf049277bf36fb7) |

## Tests

93 Foundry tests pass (49 original + 25 EWA + 19 batch/solvency). The load-bearing one is the fuzz invariant:

```
testFuzz_DrawPlusClaim_EqualsEarned — for any rate, elapsed time and draw fraction,
drawn + claimed == earned, exactly.
```

Plus: draw above accrued reverts, draw-then-claim is reduced, pause/resume/stop accounting holds,
a rate change does not resurrect drawn pay, drawable is capped by pool balance, fee/subsidy splits,
employer policy caps, and a reentrancy attack via a malicious pool token.
