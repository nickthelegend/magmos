# Submission checklist — Magmos

**Stablecoin Commerce Stack Challenge · Track 1: Cross-Border Payments & Remittances (UAE → Global)**

Every box below is verifiable by running the command next to it. Nothing here is asserted without a
way to check it.

## Links

| | |
|---|---|
| Live app | https://magmos.vercel.app |
| Repository | https://github.com/nickthelegend/magmos |
| Demo video | `demo-recording/renders/magmos-launch-and-demo.mp4` (5:59 — launch reel + full narrated demo) |
| Block explorer | https://testnet.arcscan.app/address/0xA837eB367585399b972cDa816dB9DB3D74281287 |
| Pitch deck prompt | [PITCH-DECK-PROMPT.md](PITCH-DECK-PROMPT.md) |

## Gates

| Check | Command | Status |
|---|---|---|
| Contracts compile + tests | `cd contracts && forge test` | 93 passing |
| Both apps typecheck | `bun run typecheck` | clean |
| Both apps lint | `bun run lint` | 0 errors, 0 warnings |
| ABI / address / doc drift | `bun run drift` | in sync |
| Every route, API and RPC path | `bun run verify` | 39/39 |
| Production builds | `cd app && bun run build` (also `employee`, `sdk`) | all green |
| Live readiness | `curl https://magmos.vercel.app/api/health` | `ok: true` |
| Everything at once | `bun run check` | — |

## What was actually built on Arc

- **Per-second streaming payroll** — fund once, stream continuously, pause/resume/stop/re-hire.
- **Earned Wage Access** — a worker draws pay they have *already earned*, before payday. No credit
  check, no bureau, no employer guarantor: the on-chain accrued balance is the collateral, and the
  draw is netted off their next claim so no debt exists. The 0.5% access fee is paid out of yield on
  the idle payroll float, so the worker typically pays nothing.
- **Payroll coverage** — the pool-funding gap is measured (`poolLiability`), surfaced in the
  dashboard, exposed at `/api/orgs/[wallet]/solvency`, and one click from fixed.
- **CCTP v2 send-home**, **Circle Wallets passkey + gasless claims/draws**, **ERC-4626 treasury yield**.
- Six contracts live on Arc testnet (chain `5042002`) — addresses in [README](README.md#contracts-arc-testnet-chain-5042002).

## Circle product feedback (honest)

- **USDC as native gas on Arc** is the feature that makes per-second payroll economically possible;
  sub-cent, dollar-denominated fees remove the volatile-gas problem entirely.
- **CCTP v2** required no special-casing to support early draws — a draw lands plain USDC in the
  worker's wallet exactly like a claim, so the existing bridge path just worked.
- **Circle Modular Wallets** are generic over an arbitrary call, so shipping a new contract method
  (`drawAdvance`) needed zero new wallet plumbing. That is the right abstraction.
- **Friction we hit:** the public Arc RPC rejects concurrent requests (HTTP 429,
  `-32011 request limit reached`) and caps `eth_getLogs` at 10,000 blocks. A dashboard that reads
  per-recipient state is therefore forced into multicall aggregation and a server-side caching proxy
  — both of which we built ([FEATURES.md](FEATURES.md) items 4–9). A higher per-IP allowance, or a
  documented recommended pattern, would save every team this discovery.
- **USYC is not openly mintable**, so the yield vault here is a testnet demonstration that realizes
  yield by minting a mintable underlying. A sandbox USYC with a teller-free faucet path would let
  teams demo the real "float pays for itself" mechanic instead of modelling it.

## Known limitations, stated up front

1. **Pool coverage is observable, not enforced.** A pool's balance is shared across recipients and
   nothing requires it to cover total accrual — `claim()` reverts when dry, first-come-first-served.
   Early draws don't create this risk but do surface it sooner. See [SECURITY.md](SECURITY.md).
2. **Testnet only**, and **not audited**.
3. **The yield rail is a demonstration**, not a production USYC integration.
4. CCTP destination mint and passkey biometrics are wired and compile; end-to-end confirmation of
   those two needs a wallet on the destination chain and a real biometric respectively.
