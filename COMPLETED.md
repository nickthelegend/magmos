# Completion ledger

Every item below was built and verified against live infrastructure — real deployed contracts on Arc
testnet, a real MongoDB, real signed transactions. Nothing is mocked, seeded, or stubbed.

Run `cd app && bun run verify` to check all of it in one command.

---

## Confidential settlement (contracts)

1. `settleAllSealed(poolId, sealRef)` — a whole payroll run in one transaction that names nobody
2. `PayrollSealed` event carrying only total and headcount, no recipient
3. Documented `PaySealed` as **not** confidential and kept it only for corrections and advances
4. Kept the leaky per-employee path under test as a control so a regression fails loudly
5. Foundry test: no employee address in any indexed slot of any log
6. Foundry test: sealed run and a later claim never disagree about what was earned
7. Foundry test: reverts with `ZeroClaimable` rather than recording an empty payroll run
8. Foundry test: double-settle is impossible — everything is crystallised
9. Foundry test: `settleAllSealed` requires `SEALER_ROLE`
10. Foundry test: totals equal the sum of every stream's accrual

## Confidential delivery — `MagmosStealthPayout`

11. ERC-5564 stealth-address payout contract
12. Merkle-committed batches so recipients claim independently, with no correlatable cohort
13. Signature-authorised claims — the stealth address never needs gas
14. Destination committed in the signature so a relayer cannot redirect funds
15. TTL + funder-only `reclaim` of the remainder, so a lost key cannot strand pay forever
16. `BatchInput` calldata struct (fixed a real stack-too-deep compile failure)
17. `Announcement` carries the amount encrypted with a per-payment one-time pad
18. `BatchLeaves` publishes every leaf so anyone can rebuild the tree
19. `claimMany` — several months of pay in one transaction, one transfer
20. `_claimOne` shared by both entry points so they cannot drift on what a valid claim is
21. `isClaimed(batchId, address, amount)` view
22. `unclaimedOf(batchId)` view returning 0 for unknown ids rather than reverting
23. 25 Foundry tests on the payout contract alone

## Stealth cryptography

24. ECDH derivation: `R = r·G`, `s = keccak256(r·V)`, `P = S + s·G`
25. Deterministic key derivation from a wallet signature — no seed phrase to lose
26. Domain-separated spending and viewing scalars so a viewing key cannot spend
27. View tags — reject ~255/256 of announcements with one hash
28. Amount encryption / decryption via a one-time pad
29. `reconstructClaim` — amount, leaf, tree and proof from chain data alone
30. Sorted-pair Merkle tree matching OpenZeppelin, promoting odd nodes instead of duplicating
31. bech32m address validation with full checksum
32. 24 TypeScript tests, including that a derived key actually controls its stealth address
33. Test: two payments to the same person are unlinkable

## Employer surface

34. `POST /payroll` — draft a run from plain English, gated by a deterministic policy engine
35. `POST /payroll/[runId]/settle` — settle confidentially, then deliver
36. `GET /payroll/batches` — reconciles the database against the chain
37. `POST /payroll/batches/[batchId]/reclaim`
38. `GET/PUT/DELETE /payroll/controls` with validation that rejects unenforceable configurations
39. `GET /payroll/audit` with RFC-4180 CSV export
40. Delivery batches table showing delivered vs **actually claimed**
41. "older contract" handling instead of misleading zeros
42. Reclaim button, shown only once the window has closed
43. `privatePayoutReady` on the employees API
44. Raw meta-address no longer leaked to clients
45. "no payout key" badge on the roster, visible *before* a run
46. Settlement receipts with explorer links
47. Verdict rendered louder than the agent's prose

## Worker surface

48. `/claim` — register a payout key, then claim
49. Keys derived in-browser, only public halves ever sent
50. `GET /api/claim` — what is waiting, with proofs and ECDH hints
51. `POST /api/claim` — publish a meta-address, validated before storage
52. Rejects identical spending and viewing keys
53. Claim re-derives the stealth key locally and refuses if it does not match
54. **Recover from chain** — ignores the database entirely
55. `/claim` added to navigation (it was previously unreachable)
56. Employee portal `PrivatePayoutsCard`, reading Arc with no backend
57. Portal filters already-claimed payments via `isClaimed`
58. Portal pages log reads at 9,000 blocks around Arc's 10,000 cap

## Policy, agent, data

59. Deterministic policy gate: execute / approve / refuse
60. Maker-checker — the drafter cannot approve their own run
61. Terminal states in the run state machine
62. Compare-and-swap status transitions
63. Append-only audit log with no update or delete counterpart
64. Groq wired as a secondary classifier, verified live
65. Amounts always from chain accrual — the model picks recipients, never numbers
66. Payroll runs, payments, controls and audit persisted in real MongoDB

## Infrastructure and safety

67. 9 MongoDB indexes across 5 collections
68. Unique index making duplicate payment rows structurally impossible
69. Unique index preventing a retried request creating a second run
70. Per-wallet rate limiting, budgeted by what each route actually costs
71. Rate-limit headers so clients can back off without guessing
72. 8 rate-limiter tests
73. Security-header middleware
74. CSP with a `connect-src` allowlist — the control behind "keys never leave your device"
75. `no-store` on every API response
76. `/api/health` reporting whether payroll can actually *run*, 503 when it cannot
77. 404 page that links somewhere useful
78. Global error boundary showing `digest`, never a raw stack
79. `robots.ts` keeping wallet-gated surfaces out of search
80. Metadata for `/claim`

## Tooling, CI, docs

81. `verify-all.mjs` — one command, 9 checks, all against live infrastructure
82. `verify-privacy.mjs` — the adversary's view, with a known-leaky control
83. `stealth-run.mjs` — the whole pipeline end to end
84. GitHub Actions: contracts job with a gas report
85. GitHub Actions: app job (typecheck, lint, unit tests)
86. GitHub Actions: dedicated address-drift job
87. Address/ABI drift guard across the deployment record, app, SDK and five docs
88. Drift guard across all three copies of the stealth crypto
89. Committed gas snapshot
90. `bun run verify` / `verify:privacy` / `payroll:confidential`
91. `.env.example` documenting what the signer can and cannot do
92. Employee portal `.env.example`
93. `docs/concepts/confidential-payroll.md` + sidebar entry
94. README rewritten around the delivery leg that exists
95. All docs repointed at the live contract
96. SDK exports the full stealth rail
97. Honest-status section recording the privacy mistake and its fix

## Bugs found by running it, not reading it

98. Privacy check only inspected ERC-20 logs — missed our own event *and* calldata
99. The contract fix was never wired into the settle route; the dashboard still leaked
100. `fundBatch` reverted `ERC20InsufficientBalance` — settlement pays the org, delivery ran as the signer
101. Claim consumed the envelope *before* validating, destroying the phrase and returning an error
102. `@noble/curves` was only a transitive dependency; removing the Unlink SDK broke the crypto
103. `vm.expectRevert` watched an external call inside an argument list — two reverting tests read as passing
104. `verify-all` expected bytecode at EOAs and matched its own comment
105. Every doc linked the dead pre-fix contract
106. Wrong decimals assumption — would have scaled every salary by 1e12

---

**Totals:** 148 Foundry tests · 66 TypeScript tests · 12 live contracts on Arc · 23 routes · zero
mocks in shipped code.
