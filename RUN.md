# Running Magmos locally

Two Next.js apps + live contracts on Arc testnet.

## 0. One-time wallet setup (MetaMask)
Add **Arc Testnet**:
- Network name: `Arc Testnet`
- RPC: `https://rpc.testnet.arc.network`
- Chain ID: `5042002`
- Currency symbol: `USDC`
- Explorer: `https://testnet.arcscan.app`

Then get **gas** (native USDC on Arc): https://faucet.circle.com → select Arc testnet → paste your address.

## 1. Org app (sender dashboard) — port 3000
```bash
cd "magmos/app"
bun install         # first time
PORT=3100 bun dev   # → http://localhost:3100
```
`.env.local` is already set (Mongo URI + Arc addresses + faucet-token USDC).

## 2. Recipient app (claim + send home) — port 3001
```bash
cd "magmos/employee"
bun install         # first time
bun dev --port 3001 # → http://localhost:3001
```

## 3. Get test USDC (the faucet you asked for)
Open **http://localhost:3100/faucet** → connect wallet → **Get 10,000 test USDC**.
(This mints `MagmosUSDC`, a 6-dec faucet token = the payroll rail. Real Circle USDC is a
one-env-var switch — see below.)

## 4. Demo flow
1. **Org** (localhost:3100): connect → onboarding (org name) → dashboard → **Fund payroll**:
   add recipients (address + name + monthly USDC) → approve USDC → stream. Streams start ticking.
2. **Recipient** (localhost:3001): connect with a recipient wallet → watch the **live per-second
   ticker** → **Claim** → USDC lands in the wallet → **Send home** (CCTP bridge to another chain).

## Live contracts (Arc testnet, chain 5042002)
| | Address |
|---|---|
| MagmosPayroll | `0xA837eB367585399b972cDa816dB9DB3D74281287` |
| MagmosRegistry | `0x9C73E54e78c0e1d5C46aC996A126Ba5B9d4fC501` |
| MagmosVault | `0x9F4AeADcc5C21ACB1dC96C66947E4373C6abF322` |
| MagmosUSDC (faucet test token) | `0x3248CcD4c276b4785f81f8c1207094262F67a33C` |
| USDC (real Circle, on Arc) | `0x3600000000000000000000000000000000000000` |

## Switching to real Circle USDC (official run)
In both `.env.local` files set `NEXT_PUBLIC_USDC=0x3600000000000000000000000000000000000000`
and restart. The contracts are token-agnostic — nothing else changes. (Get real testnet USDC
from https://faucet.circle.com.) Note: CCTP "send home" always bridges real USDC.
