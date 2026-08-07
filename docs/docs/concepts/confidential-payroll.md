---
id: confidential-payroll
title: Confidential payroll
sidebar_position: 6
---

# Confidential payroll

Streaming payroll on a public chain has an obvious problem. Everyone's salary is readable by anyone
with a block explorer — permanently, and searchable by address. That single fact is why most
employers who look at stablecoin payroll stop looking.

Magmos splits it the way payroll actually needs: **confidential to the public, auditable to the
employer.**

## What is hidden and what is not

| | Public | Hidden |
|---|---|---|
| A stream exists and accrues | ✅ | |
| That an org ran payroll | ✅ | |
| Total spent, and headcount | ✅ | |
| **Who was paid** | | ✅ |
| **How much each person got** | | ✅ |
| The employer's own full record | | audit trail + CSV |

The aggregate is public on purpose. An employer's total payroll spend is the part that *should*
stay auditable — hiding it would throw away the reason streaming payroll is worth auditing at all.
An individual's salary is the secret.

## Why Arc's own privacy isn't used

Arc has an opt-in privacy design — confidential transfers with view keys for auditors — and it is a
good fit for exactly this. But [Arc's documentation](https://docs.arc.io/arc/concepts/opt-in-privacy)
states plainly that privacy features are *"on the roadmap and not yet available"*. So Magmos builds
both legs itself, on-chain, with no external privacy service and no trusted setup.

## Leg 1 — settlement names nobody

A payroll run settles in **one** transaction:

```solidity
settleAllSealed(bytes32 poolId, bytes32 sealRef)
```

That is the entire calldata. There is no recipient and no per-person amount to read, in the input or
the logs.

The obvious alternative — settling per employee — cannot be made confidential no matter what it
emits, because `settleSealed(poolId, employee, amount, sealRef)` puts both values in **calldata**,
which is public on a transparent chain. Redacting the event would only hide the leak from anyone who
didn't decode the input. The fix is not to emit less; it is to *ask for less*.

## Leg 2 — delivery goes to one-time addresses

Settling privately is half the job. The money still has to reach people, and an ordinary ERC-20
payout republishes everything settlement just hid.

Each employee publishes a **meta-address** once — a spending key `S` and a viewing key `V`, derived
in their browser from a wallet signature and never sent anywhere. For each payment the employer
derives a fresh one-time address by ECDH:

```
R = r·G                    ephemeral, published in the Announcement
s = keccak256(r·V)         shared secret — employer has r, employee has v
P = S + s·G                one-time stealth public key
stealthAddress = addr(P)
```

Only the employee can compute the matching private key `p = (spend + s) mod n`. The link between a
person and an address is a discrete log away.

### Why a Merkle root instead of N transfers

Paying each stealth address at payout time would publish N amounts in a single transaction. The
count alone reveals headcount, and the shared timing binds every recipient into one correlatable
cohort. Instead the employer commits a root and deposits the total; employees claim independently,
whenever they like. Claims scattered across days give an observer no cohort to work with.

### Why the stealth address never needs gas

A freshly derived address holds nothing. Funding it first would create exactly the linking
transaction this design removes — whoever sends the gas is a clue. So the stealth key only *signs*,
and anyone may relay the transaction. The signature commits to the destination, so a relayer cannot
redirect the money.

## Self-custody

Every claim can be reconstructed from chain data alone:

- `Announcement` carries the amount, XORed with a one-time pad derived from the same shared secret.
  Only the recipient can remove it. They need the amount to rebuild their own leaf.
- `BatchLeaves` publishes every leaf. They are hashes of unlinkable addresses, so this reveals
  nothing — and it lets any recipient rebuild the tree and derive their own proof.

The **Recover from chain** button on `/claim` does exactly this, ignoring the Magmos database
entirely. If Magmos disappeared tomorrow, an employee with their wallet could still find and claim
their salary.

## Guardrails

- **No silent fallback.** An employee without a registered payout key is *held back*, not paid in
  the clear. Paying them normally would strip privacy from precisely the people who hadn't set
  themselves up yet.
- **A claim window, then reclaim.** A lost viewing key would otherwise strand salary forever. The
  employer can recover the remainder — but only the remainder, only after the expiry they committed
  to at funding time, and both are enforced by the contract.
- **Viewing ≠ spending.** The two scalars are domain-separated, so an employee can hand a viewing key
  to an accountant without handing over the salary.

## Verify it yourself

```bash
cd app && node scripts/verify-privacy.mjs
```

It takes the adversary's view — transaction hashes only, reading what any explorer reads — against
an observer who **already knows every employee address**. If the strongest adversary cannot
attribute a payment, a stranger cannot either. A known-leaky transaction is kept under test as a
control, so a pass means something.

To run the whole pipeline end to end against Arc:

```bash
cd app && node scripts/stealth-run.mjs
```
