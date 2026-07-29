# 50 additions — verification pass + feature build

Everything below is implemented, typechecked, and covered by the automated verification harness
(`node demo-recording/verify-all.mjs` → **39/39 green**) or by Foundry (**93 tests passing**).

Three of these are **bug fixes for real defects found by verifying rather than assuming** — they are
marked 🐛 and each one was breaking something a user would hit.

---

## Correctness & reliability (1–14)

| # | What | Why it matters |
|---|---|---|
| 1 | 🐛 **Deep-linkable dashboard.** `RequireWallet` no longer redirects on a `disconnected` tick; it resolves in place with a Connect prompt. | wagmi reports `disconnected` before auto-reconnect settles, so **any hard refresh of `/dashboard/*` bounced the user to the marketing page** and dashboard URLs could not be bookmarked, shared, or opened in a new tab. This single defect was failing 8 routes. |
| 2 | 🐛 **wagmi transport routed through same-origin `/api/rpc`.** | The transport pointed straight at Arc, so every `useReadContract` was a cross-origin fetch — **CORS-blocked in the browser** and competing for Arc's per-IP limit. |
| 3 | 🐛 **Failed reads are no longer rendered as real data.** Worker shows "checking…", employer shows a "Can't reach Arc" banner; both hold the last good snapshot. | A rate-limited RPC was displaying `0.00 available` and *"your employer's pool is short"* — telling a worker their pay was gone when nothing was wrong. |
| 4 | **`/api/rpc` proxy** (both apps): short-TTL cache, in-flight coalescing, 429 retry with backoff, read-only method allowlist. | Measured: a 24-request burst returns **24/24** where upstream allowed ~2. One server-side budget shared by all visitors instead of each visitor's own IP. |
| 5 | **Explicit multicall3 aggregates** for the per-recipient fan-out (12 reads → 1 request, ~740ms). | viem's `batch.multicall` transport option did not reliably coalesce; measured 1 call OK vs 12 concurrent all failing in ~250ms. |
| 6 | Same for the worker's advance snapshot (drawable + account + policy). | One request per poll instead of three. |
| 7 | Same for `/api/orgs/[wallet]/solvency`. | It was an intermittent 502 — the one failure mode a monitoring endpoint must not have. |
| 8 | **Transport-level retry** (`retryCount`, backoff) on both public clients and both wagmi configs. | Server routes can't use the same-origin proxy; retry stops a transient throttle becoming a hard error. |
| 9 | `eth_getLogs` bounded to a 9,000-block window. | Arc caps the range at 10,000; the authoritative lifetime total comes from `accountOf` (plain state), never from log retention. |
| 10 | **Sub-cent money precision.** A 0.5% fee on a small draw no longer renders as `0.00`. | Showing a real charge as zero understates what the worker pays. |
| 11 | `_claim` shared path behind `claim`/`claimTo`/`claimMany`, with strict vs non-strict semantics. | All 74 pre-existing tests still pass — the refactor changed no behaviour. |
| 12 | **19 new Foundry tests** (93 total) covering every new contract entry point. | Includes batch ops, solvency views, draw destinations, and per-pool fee accounting. |
| 13 | **`scripts/sync-chain.mjs`** — propagates ABIs + addresses to both apps and all four env files from `deployments/arc-testnet.json`. | ABIs were hand-copied into two apps with no codegen; addresses were duplicated in four places. |
| 14 | **`sync-chain.mjs --check`** — non-zero exit on any drift. | Makes "the ABI is stale" a caught error instead of a mystery. |

## Contracts (15–23)

| # | What | Why it matters |
|---|---|---|
| 15 | **`poolLiability(poolId)`** → accrued / balance / shortfall across every stream. | Coverage is deliberately *not* enforced on-chain — `claim()` simply reverts when the pool runs dry, first-come-first-served. That made underfunding **silent until someone failed to get paid**. This is the risk flagged during the EWA build, now measurable. |
| 16 | **`requiredTopUp(poolId)`** | The exact number that closes the gap. |
| 17 | **`claimMany(bytes32[])`** — claim from several employers in one signature; skips pools that aren't ready instead of reverting the batch. | A worker with three clients signed three times. |
| 18 | **`claimTo(poolId, to)`** — claim straight to a savings wallet, exchange, or family. | |
| 19 | **`pauseMany` / `resumeMany`** — batch stream control that skips already-inactive entries. | End-of-contract batches were N transactions. |
| 20 | **`claimableBatch`** and **`drawableBatch`** roster views. | One RPC round trip for a whole team. |
| 21 | **`drawAdvanceTo(poolId, amount, to)`** — draw earned pay directly onward. | Saves a second transaction and a second gas payment; still charged only to the drawer's stream. |
| 22 | **`drawMax(poolId)`** — take everything available without reading the limit first. | |
| 23 | **`poolStats(poolId)`** — per-pool EWA economics. | An employer sees their own fee/subsidy split, not a protocol-wide aggregate. |

## Employer dashboard (24–33)

| # | What |
|---|---|
| 24 | **Payroll coverage card** — earned-and-unclaimed vs held, % covered, with a shortfall warning. |
| 25 | **One-click "Top up N USDC"** that funds exactly the shortfall (skips a redundant approval when allowance already covers it). |
| 26 | **Early-access policy editor** — max-share slider, minimum draw, and an on/off switch, seeded from chain state. |
| 27 | **Park-yield-to-cover-fees** flow, so the employer's float pays the worker's access fee. |
| 28 | **Streams table search** across name and address. |
| 29 | **Sortable columns** (recipient / monthly / streaming now / drawn early) with `aria-sort`. |
| 30 | **Multi-select** with a select-all header checkbox. |
| 31 | **Batch pause / resume** from the selection, in one transaction. |
| 32 | **CSV export** of exactly the on-screen view (respects search + sort). |
| 33 | **Copy-address buttons** on every row; reusable **`AmountInput`** primitive extracted from three duplicated money fields. |

## Worker portal (34–41)

| # | What |
|---|---|
| 34 | **Draw somewhere else** — optional destination address in the draw modal, with live validation, using `drawAdvanceTo`. |
| 35 | **Milestone ETA** — "your first draw unlocks in about 4 min" instead of a bare `0.00`. |
| 36 | **Cross-employer totals** — one claimable figure and one available-early figure across every stream. |
| 37 | **Claim from all** — one signature across every employer, via `claimMany`. |
| 38 | **Gasless "Get X USDC early"** on `/passkey`, routed through the generic `sendGaslessCall` wrapper. |
| 39 | **Real tx hash + explorer receipt** in every worker toast (`useTxRunner` extracted and shared). |
| 40 | **Recent-draws list** with per-draw explorer receipts and a "covered by yield" marker. |
| 41 | **Honest captions** that explain *why* a number is what it is — capped by employer, pool short, nothing earned yet, or fee covered by yield. |

## Platform, SDK & DX (42–50)

| # | What | Why it matters |
|---|---|---|
| 42 | **`/api/health`** — chain reachability + chainId, **contract bytecode present at the compiled-in addresses**, and Mongo ping. | "The dashboard shows zeros" has three unrelated causes; guessing between them wastes time exactly when there is least of it. |
| 43 | **`/api/orgs/[wallet]/solvency`** — machine-readable coverage. | Point a monitor at it and page someone when `covered` drops below 1. |
| 44 | **`/api/orgs/[wallet]/advances`** — server-side draw history that walks several 9k-block windows. | The browser can only afford one window; the server can chunk, and the shared cache absorbs the cost. |
| 45 | **`@magmos/sdk` advance client** — `getDrawable`, `quoteAdvance`, `getAdvanceAccount`, `buildDrawRequest`. | A partner app can offer "get paid early" without re-deriving any streaming math. |
| 46 | SDK ships a **minimal advance ABI + types**, exported from the package root. | Keeps the published bundle small. |
| 47 | **AI copilot knows EWA** — and states the coverage caveat plainly if asked about risk, rather than selling the feature. |
| 48 | **`bun run typecheck / verify / sync-chain / check`** in both apps. | `check` = typecheck + lint + drift guard. |
| 49 | **`seed-demo.sh` hardened** — addresses read from the deployment record, `SKIP_API` for chain-only runs, and it seeds the yield subsidy plus a real on-chain draw. | It hardcoded a payroll address that a redeploy silently invalidated. |
| 50 | **`demo-recording/verify-all.mjs`** — 39 checks: every route in both apps, every API endpoint, the proxy's cache/coalescing/allowlist, and the on-chain reads behind them, driven by a real connected wallet. | This is what found #1, #2 and #3. |

---

## Honest notes

- **The coverage gap is now visible, not closed.** A pool can still be underfunded; the contract
  does not enforce an invariant across streams. Items 15/16/24/25/43 make it observable and
  actionable, which is a materially different thing from solving it. A true fix (a reserve
  requirement or a cross-stream coverage invariant) is the most valuable next work and is written up
  in [ROADMAP.md](ROADMAP.md).
- **MagmosPayroll was redeployed** for the new views. Prior instances are kept in
  `contracts/deployments/arc-testnet.json` for provenance of earlier demo transactions.
- **Arc's public RPC is the binding constraint** on this stack, not the app. Items 4–9 exist because
  of measured behaviour (429 on concurrency, 10k log-range cap). For a live demo, point
  `NEXT_PUBLIC_ARC_RPC` at a dedicated endpoint.
- **One item was a harness bug, not an app bug**, and is recorded as such: the verification shim's
  fallback fetched Arc cross-origin from the page. A real wallet is an extension and is not subject
  to page CORS, so the harness was reporting its own artifact. Fixed in the harness.
