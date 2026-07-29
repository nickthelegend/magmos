# Security

Magmos moves real value (testnet USDC today, the same code path on mainnet tomorrow), so this
document states plainly what is protected, what is not, and where to report a problem.

## Reporting

Open a **private** security advisory on the repository, or email the address in the repo profile.
Please do not open a public issue for anything that could move funds. A first response should be
expected within a few days.

## Trust model

| Component | Custody | Who can move funds |
|---|---|---|
| `MagmosPayroll` | Holds each org's pooled USDC | The recipient (own accrued pay only), and the wired advance module for early settlement |
| `MagmosAdvance` | Holds only the fee-subsidy float | Anyone drawing **their own** already-accrued pay |
| `MagmosVault` / `MagmosYieldVault` | Recipient/org opt-in deposits | The depositing owner |
| MongoDB | Names and labels only | Never touches funds |

Key properties, each enforced on-chain rather than in the UI:

- **A draw can never exceed accrued pay.** `settleAdvance` reverts `ExceedsClaimable`, computed with
  the same `_accrued`/`_effectiveEnd` functions `claim()` uses — there is no second implementation
  that could disagree.
- **No debt is ever created.** A draw crystallizes accrual and subtracts from `pendingBalance`, so
  repayment is structural. There is nothing to default on and nothing to collect.
- **The advance module is bound once.** `setAdvanceModule` is deployer-only and single-shot
  (`AdvanceModuleAlreadySet`), so a later key compromise cannot route recipient funds through a
  malicious module.
- **The access fee is capped in code.** `MAX_ADVANCE_FEE_BPS = 200` (2%); EWA cannot be turned into
  payday-loan pricing by a config change.
- **Reentrancy.** All value-moving entry points are `nonReentrant`; a malicious pool token attempting
  to re-enter `claim` or `drawAdvance` is covered by tests.

## Known limitations (deliberate, not oversights)

1. **Pool coverage is not enforced.** A pool's balance is shared across its recipients, and nothing
   requires it to cover total accrual — `claim()` simply reverts `InsufficientPoolBalance` when it
   runs dry, first-come-first-served. This is observable (`poolLiability`, `requiredTopUp`,
   `/api/orgs/[wallet]/solvency`, and the dashboard's coverage card) but not prevented. A reserve
   requirement or cross-stream coverage invariant is the highest-priority hardening work.
2. **Testnet yield rail.** `MagmosYieldVault` realizes yield by minting a mintable test underlying.
   That model does not transfer to production; a real deployment must route to USYC's exchange-rate
   appreciation instead. It is a demonstration, not a drop-in vault.
3. **Not audited.** No third-party audit has been performed. Do not deploy this to mainnet with real
   payroll without one.
4. **Registry roles are held by the deployer** on testnet. Production should move `FEE_MANAGER_ROLE`
   and `PROTOCOL_MANAGER_ROLE` behind a multisig or timelock.

## Operational notes

- Private keys live only in gitignored files (`contracts/.env.deployer`, `scripts/.demo-wallets.json`)
  and are read by Node scripts; they are never sent to a browser. The demo recorder injects an
  EIP-1193 shim and signs in Node precisely so keys stay out of page context.
- `MONGODB_URI` is server-only and is never exposed through a `NEXT_PUBLIC_` variable.
- `/api/rpc` is an allowlisted **read-only** proxy. It will not forward signing methods; the
  allowlist is asserted by the verification harness.
