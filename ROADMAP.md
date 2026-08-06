# Magmos — Roadmap

**Magmos** = the Arc-native evolution of Sweem. We take Sweem's streaming-payroll protocol
(currently live on Sui) and rebuild it on **Arc** (Circle's stablecoin L1, EVM) for the
**Stablecoin Commerce Stack Challenge**, targeting:

> **Track 1 — Best Cross-Border Payments & Remittances Experience (UAE → Global)**
> 1st: 5,000 USDC · 2nd: 3,000 USDC

The premium Sweem UI is preserved verbatim. Only the chain layer (wallet, tx-building,
reads, addresses, auth) is rewired from Sui/Move → Arc/EVM.

---

## 1. Product framing (why this wins Track 1)

**Magmos — real-time cross-border payroll & remittances on Arc.**
UAE businesses stream USDC salaries, contractor payouts, and remittances to recipients
anywhere in the world — settled *per-second* on Arc with deterministic finality,
transparent dollar-denominated fees, and instant claim + cross-chain bridge-out via
Circle CCTP.

This maps directly onto the track's own examples:
- ✅ *"Global payroll / contractor payouts with stablecoin settlement and receipts"* — the core Magmos flow.
- ✅ *"Remittance app with transparent fees + real-time settlement confirmation"* — the per-second stream **is** the real-time settlement; fees are shown live and dollar-denominated.
- ✅ *"Marketplace settlement (UAE platform paying global sellers/creators)"* — same rails, different label.

**The wedge:** a freelancer in Manila / Lagos / Karachi opens Magmos and watches their pay
tick up per second from their UAE employer. They claim anytime and **bridge USDC to their
home chain via CCTP** (or route to a yield vault), with a receipt. Payroll that settles the
moment work happens — no 3-day SWIFT, no 6% remittance haircut.

**Circle stack used (all on Arc):**
| Tool | Use in Magmos |
|---|---|
| **USDC** | primary rail — pools, streams, claims, escrow |
| **CCTP v2 + Bridge** | recipient bridges claimed USDC to their home chain; org can fund cross-chain |
| **Circle Wallets** | embedded wallet UX for non-crypto-native recipients (stretch) |
| **Circle Gateway** | org treasury unified-balance / routing (stretch) |
| **USYC** | idle payroll float earns yield for the org (stretch, the "pays for itself" story) |
| **StableFX** | AED→USDC FX-aware settlement concept (stretch / narrative) |

---

## 2. What we keep vs. rewire

**Keep 1:1 (no visual changes):** all React components, Tailwind theme, framer-motion,
landing page, dashboard, onboarding wizard, employee/recipient portal, CSV+AI onboarding,
shadcn UI, brand assets.

**Rewire (Sui → Arc/EVM):** wallet provider, tx builders, on-chain reads, auth signature,
address validation, token/protocol config, backend RPC + sig-verify. (48 Sui-touching files
inventoried — see §6.)

**Drop:** Cetus DEX aggregator (`lib/cetus.ts`), Sui yield adapters (Navi / Scallop /
Suilend / stSUI / USDY). Yield, if built, is a single **USYC** adapter instead.

---

## 3. Target architecture

```
magmos/
├── contracts/        Foundry (Solidity) — Arc testnet
│   ├── MagmosRegistry.sol     fees + treasury + protocol allowlist   (← registry.move)
│   ├── MagmosPayroll.sol      stream pools, deposit/claim/pause/stop  (← stream_pool.move)
│   ├── MagmosVault.sol        recipient multi-token vaults            (← employee_vault.move)
│   └── (stretch) USYCAdapter.sol   idle float → USYC yield
├── app/              Next.js 16 (ported from sweem/fe) — org + recipient portal
├── server/           Hono/Workers backend (ported from sweem/sweem-server)
└── packages/sdk/     (optional) embeddable pay/stream widget (← sweem-sdk)
```

**Chain layer stack:** `wagmi` + `viem` + connector (RainbowKit/injected), Arc chain config,
Multicall3 for batched reads, event-log indexing for stream discovery (mirrors Sweem's
chain-first read model). Backend: `viem` public client on Arc RPC; EIP-191/SIWE auth.

**Contract design notes (Move → Solidity):**
- **Time:** Sui `clock.timestamp_ms()` (ms) → EVM `block.timestamp` (seconds). Rate period
  becomes seconds. Per-second streaming is still "real-time" for payroll.
- **Pool model:** Sui `StreamPool<T>` shared object per (org, token) → single upgradeable
  `MagmosPayroll` contract with `mapping(bytes32 poolId => Pool)`, `poolId = keccak256(org, token)`.
  Gas-efficient, matches "one pool per token per org."
- **Custody:** Move `Balance<T>` held in object → ERC-20 balance held by the contract via
  `SafeERC20.transferFrom` (deposit) / `transfer` (claim). Track internal accounting to keep
  per-pool balances isolated.
- **Iteration:** Sui `Table<address, Stream>` → Solidity `mapping` (no native iteration) +
  events for the backend to index. Batched reads via Multicall3 (`claimable` per employee).
- **Streaming math:** identical — `earned = elapsed * rate / period`, `pending_balance`
  crystallization, `total_paused_ms`, min-claim floor, coverage floor. Ported with the same
  invariants and OpenZeppelin overflow-safe math (`Math.mulDiv`).
- **Roles:** `delegated_roles` bitmap → OZ `AccessControl` / simple bitmap mapping. Two-step
  org transfer preserved.
- **Fees:** deposit fee bps → treasury on deposit/topup (identical to registry.move).
- **USDC:** ERC-20 at `0x3600…0000`, **6 decimals** (confirmed on-chain). Native gas USDC is
  18-dec — deployer needs a little native USDC for gas.

---

## 4. Phased roadmap

> **Decisions locked (2026-07-01):** two apps (org + recipient) · CCTP-first, USYC yield as a
> stretch · wagmi + MetaMask now, Circle Wallets later · **backend = Next.js API routes +
> MongoDB** (chain-first core; not the Cloudflare/Postgres stack) · demo corridor = **mixed
> global** (a UAE marketplace settling with creators/sellers worldwide).

### 🟢 Live on Arc testnet (chain 5042002)
| Contract | Address |
|---|---|
| MagmosRegistry | `0x9C73E54e78c0e1d5C46aC996A126Ba5B9d4fC501` |
| MagmosPayroll | `0xaE5A8a7F57490ada1d530fE4E6b8074B1E7dB36B` |
| MagmosVault | `0x9F4AeADcc5C21ACB1dC96C66947E4373C6abF322` |
| treasury / deployer | `0xF1a800BA07Bd0b55Dce43be2e837933AF3e53226` |

Explorer: https://testnet.arcscan.app/address/0xaE5A8a7F57490ada1d530fE4E6b8074B1E7dB36B

### Phase 0 — Foundations ✅
- [x] Deployer wallet generated → `0xF1a800BA07Bd0b55Dce43be2e837933AF3e53226` (fund via faucet.circle.com)
- [x] Arc facts verified on-chain (chainId 5042002, USDC 6-dec, RPC live)
- [x] Foundry init + Arc network profile in `foundry.toml` (solc 0.8.28, evm cancun, OZ v5.6.1)
- [ ] `magmos/app` + `magmos/employee` scaffolds (Phase 2)
- [ ] Shared Arc config module (chain, RPC, addresses, ABIs) — emitted at deploy

### Phase 1 — Contracts (Solidity port) ✅ (deploy pending funding)
- [x] `MagmosRegistry.sol` — fees, treasury, protocol allowlist, AccessControl (2 roles)
- [x] `MagmosPayroll.sol` — createPool, createPoolAndDeposit, deposit, topup, claim,
      pause/resume/stop, `claimableAmount()` view, roles, enumerable discovery indexes
- [x] `MagmosVault.sol` — create vault, deposit/withdraw multi-token
- [x] Foundry tests — **36 passing** (stream accrual, pause math, min-claim, rate-change
      crystallization, fee split, access control, multi-recipient)
- [x] `forge script script/Deploy.s.sol` written + builds (emits `deployments/arc-testnet.json`)
- [x] **Deployed to Arc testnet** ✅ (addresses above; verified live on-chain)
- [ ] Post-deploy admin setup (fees stay 0 for demo; approve USYC when adapter lands)

### Phase 2 — App chain layer (rewire, UI untouched)
- [x] Providers: `SuiClientProvider`/`WalletProvider` → `WagmiProvider` + injected connector + Arc chain
- [x] Wallet button rewired (`useAccount`/`useConnect`/`useDisconnect`, + wrong-chain switch), visuals kept
- [x] `lib/magmos.ts` (← `lib/sweem.ts`) — Arc addresses, ABIs, decimals, explorer URLs, poolIdFor
- [x] `lib/wagmi.ts` — arcTestnet chain + wagmi config; ABIs extracted to `lib/abi/*.json`
- [x] `lib/writes.ts` — viem/wagmi write-request builders (create/fund/claim/pause/stop/vault)
- [x] `lib/reads.ts` — viem read helpers (orgPools/getPool/employeesOf/getStream/claimable/USDC/vault)
- [x] deps swapped (@mysten/cetus → wagmi/viem/mongodb) and installed ✓
- [ ] rewire ~20 screen components to use writes/reads + wagmi hooks (the bulk of the work)
- [ ] `lib/tokens.ts` / `protocols.ts` → USDC / EURC / USYC on Arc; delete `cetus.ts`
- [ ] `lib/api.ts` → same-origin `/api/*` + EIP-191 auth (keep hook signatures)
- [ ] `isValidSuiAddress` → viem `isAddress` (onboarding CSV, wallet-button)
- [ ] full `next build` passes

### Phase 3 — Cross-border layer (Track 1 differentiator) 🎯
- [x] CCTP v2 on Arc: `approve` → `depositForBurn` (TokenMessengerV2 `0x8FE6…2DAA`, domain 26)
      → Iris sandbox attestation polling. Signature verified vs Circle docs + on-chain source.
- [x] Recipient "Send home" UI: destination-chain picker + multi-step burn/attest status + arcscan link
- [x] **Destination-chain `receiveMessage` mint — in-app**: wallet switches to Sepolia/Fuji/
      Arbitrum/Base, mints, destination explorer link, "Switch back to Arc" (full CCTP loop)
- [x] Circle Wallets passkey onboarding (`/passkey`) — register/login → smart account → gasless claim
- [ ] (stretch) Circle Gateway unified balance for org treasury

### Phase 4 — Backend = Next.js API routes + MongoDB (in `magmos/app/app/api/*`)
- [x] Mongo connection singleton (`lib/mongo.ts`) + `.env.local` (MONGODB_URI, gitignored)
- [ ] Collections/models: orgs, employees, groups, invoices, apiKeys (metadata only — no funds)
- [ ] API routes replacing the sweem-server surface the UI calls: `/api/orgs`, `/api/orgs/[wallet]/employees`,
      `/api/orgs/[wallet]/employees/bulk`, `/api/groups`, `/api/invoices`, `/api/ai/map-csv`, `/api/compute/*`
- [ ] EIP-191 auth middleware (viem `verifyMessage`) replacing Sui `verifyPersonalMessageSignature`
- [ ] `lib/api.ts` rewired to call same-origin `/api/*` (keep the `useSweemApi` hook signatures)
- [ ] CSV→columns AI mapping: keep heuristic-first; AI optional (defer Workers-AI)
- [ ] employee app calls the org app's `/api/*` (CORS) or shares via `NEXT_PUBLIC_API_BASE`

### Phase 5 — Yield ("payroll that pays for itself") ✅
- [x] `MagmosYieldVault.sol` — ERC-4626 over USDC, 5% APY, live-growing share price (7 tests)
- [x] Deployed `0x3e711d38FFC65C278Fe78eC981bc5cEC5807D0c2`; deposit proven live on-chain
- [x] `/yield` treasury page — deposit idle USDC, live-ticking position, withdraw
- [x] Fire-theme reskin + magmos.png logo + Space Grotesk wordmark (both apps green)
- note: real USYC is KYC/teller-gated; this test-yield vault routes to USYC in production

### Phase 5b — Circle Wallets (passkey onboarding) — pending Circle credentials
- Modular Wallets support Arc + are viem-compatible (`@circle-fin/modular-wallets-core`)
- [ ] Blocked: needs a Circle Client Key + Client URL from console.circle.com to build/test

### Phase 6 — Polish & demo
- [x] Landing + dashboard + nav + FAQ copy → Magmos / Arc / remittance framing (visuals unchanged)
- [x] Faucet screen (`/faucet`) + faucet-mintable test USDC deployed on Arc
- [x] Demo script + pitch kit → `PITCH.md`; run guide → `RUN.md`
- [x] On-chain proof: streaming works with real USDC AND the faucet token (arcscan)
- [ ] Browser click-through of the full UI flow (proven via cast, not yet clicked)
- [ ] Walkthrough video + seed a scripted mixed-global demo org
- [ ] (stretch) rename `/public/sweem*.png` assets + `@sweem/sdk`/social handles to Magmos

---

## 5. Arc testnet reference (verified)

| Item | Value |
|---|---|
| Chain ID | `5042002` (`0x4D0012`) |
| RPC | `https://rpc.testnet.arc.network` |
| WS | `wss://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| Faucet | `https://faucet.circle.com` |
| Native gas | **USDC** (18-dec native) |
| USDC (ERC-20) | `0x3600000000000000000000000000000000000000` — **6 decimals** |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| USYC | `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C` — 6 decimals |
| CCTP TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` (domain 26) |
| CCTP MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| CCTP TokenMinterV2 | `0xb43db544E2c27092c107639Ad201b3dEfAbcF192` |
| Gateway Wallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` |
| Gateway Minter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` |
| StableFX FxEscrow | `0x867650F5eAe8df91445971f14d89fd84F0C9a9f8` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

**Note:** Arc is testnet-only right now (mainnet addresses not yet published). The hackathon
runs on testnet.

---

## 6. Migration surface (48 Sui-touching files)

- **~26 tx builders** across `fe/lib/tx.ts` (1,421 loc), `employee/`, `client-test/`, `scripts/`
- **3 wallet providers** (fe / employee / sdk) — `SuiClientProvider` + `WalletProvider`
- **4 config files** with Sui package/object IDs (`*/lib/sweem.ts`, `scripts/config.ts`)
- **6 backend RPC ops** (SuiClient, getObject, getValidatorsApy, getTransactionBlock, verify)
- **2 signature-verify** impls (`sweem-server/src/lib/auth.ts`, SDK)
- **coin-type handling** in 5 files; **5 yield fetchers**; **Cetus** swap integration (drop)

Every one of these is enumerated with file paths in the migration notes and will be ported
or deleted phase-by-phase.

---

## 7. Open decisions (confirm before Phase 1 build-out)

1. **App structure** — one unified `magmos` app (org + recipient via route groups) vs. two
   apps (mirror Sweem's `fe` + `employee` split).
2. **Yield scope** — core remittance + CCTP first, USYC yield as stretch (recommended) vs.
   USYC in core scope vs. drop yield entirely.
3. **Recipient wallet UX** — wagmi + injected/MetaMask now, Circle Wallets embedded later
   (recommended) vs. Circle Wallets embedded from the start.

---

## Earned Wage Access — shipped, and what was deliberately left out

**Shipped (live on Arc testnet):** `MagmosAdvance` + the `settleAdvance` primitive. Workers draw
pay they have already streamed; repayment is structural (netted off the next claim), the access
fee is covered by yield on the payroll float, and employers set an exposure envelope rather than
approving individual draws. See [docs/EARNED-WAGE-ACCESS.md](docs/EARNED-WAGE-ACCESS.md).

**Explicitly NOT built, to keep one loop bulletproof rather than four half-finished:**

- **Neo-bank surface** — multi-currency balances, spend cards, an FX desk. A real direction, but it
  dilutes a demo whose whole point is a single verifiable money loop.
- **Underwriting of any kind** — credit bureau pulls, NBFC-style risk scoring, KYC beyond the
  wallet. The thesis is that on-chain accrued wages *are* the underwriting; adding a bureau would
  contradict the product.
- **Draws against *future* (unearned) pay.** This is the line between earned wage access and a
  payday loan, and the contract enforces it (`ExceedsClaimable`). Crossing it would need real
  underwriting, licensing, and default handling.
- **Pool solvency guarantees.** Advances surface an underfunded pool sooner (see the limitation
  note in the EWA doc). A proper fix — an employer-side reserve requirement or a coverage
  invariant across all streams in a pool — is the most valuable next piece of work here.
- **Real USYC routing** for the subsidy yield. Today's yield vault is a testnet rail; production
  should route the float to Circle/Hashnote USYC and fund the subsidy from actual yield.
