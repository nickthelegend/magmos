// Magmos on Arc — chain constants, deployed addresses, token config, and ABIs.
// Single source of truth for the chain layer (replaces the Sui-era lib/sweem.ts).

import type { Abi } from 'viem'
import { encodeAbiParameters, keccak256 } from 'viem'
import payrollAbi from './abi/MagmosPayroll.json'
import registryAbi from './abi/MagmosRegistry.json'
import vaultAbi from './abi/MagmosVault.json'
import advanceAbi from './abi/MagmosAdvance.json'

export const NETWORK = 'arc-testnet' as const

// ----- Arc testnet chain -----
export const ARC_CHAIN_ID = 5042002
export const ARC_RPC_URL = process.env.NEXT_PUBLIC_ARC_RPC || 'https://rpc.testnet.arc.network'
export const ARC_WS_URL = 'wss://rpc.testnet.arc.network'
export const ARC_EXPLORER = 'https://testnet.arcscan.app'
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const

// ----- Deployed Magmos core (Arc testnet) -----
export const MAGMOS_PAYROLL = (process.env.NEXT_PUBLIC_MAGMOS_PAYROLL ||
  '0x23888C1556FF5ebbA045D979f56C1151D0D0af47') as `0x${string}`
// Earned Wage Access module — draw wages already streamed-and-earned, before the claim.
export const MAGMOS_ADVANCE = (process.env.NEXT_PUBLIC_MAGMOS_ADVANCE ||
  '0x360c66B83C26AfAE457A4022bDdAAb58ADF9E7C4') as `0x${string}`
export const MAGMOS_REGISTRY = (process.env.NEXT_PUBLIC_MAGMOS_REGISTRY ||
  '0x9C73E54e78c0e1d5C46aC996A126Ba5B9d4fC501') as `0x${string}`
export const MAGMOS_VAULT = (process.env.NEXT_PUBLIC_MAGMOS_VAULT ||
  '0x9F4AeADcc5C21ACB1dC96C66947E4373C6abF322') as `0x${string}`

export const PAYROLL_ABI = payrollAbi as Abi
export const REGISTRY_ABI = registryAbi as Abi
export const VAULT_ABI = vaultAbi as Abi
export const ADVANCE_ABI = advanceAbi as Abi

// ----- Arc testnet tokens -----
export const USDC = (process.env.NEXT_PUBLIC_USDC ||
  '0x3248CcD4c276b4785f81f8c1207094262F67a33C') as `0x${string}`
export const USDC_DECIMALS = 6
export const USYC = '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C' as `0x${string}`
export const EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as `0x${string}`

// ----- Circle CCTP v2 on Arc (domain 26) — recipient "send home" bridge (Phase 3) -----
export const ARC_CCTP_DOMAIN = 26
export const CCTP_TOKEN_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA' as `0x${string}`
export const CCTP_MESSAGE_TRANSMITTER =
  '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275' as `0x${string}`

// Pool role bits (mirror MagmosPayroll.PAUSER_ROLE)
export const PAUSER_ROLE = 1

// Rate-period presets in SECONDS (Arc uses block.timestamp; Sweem used ms).
export const WEEK_S = 604_800
export const MONTH_S = 2_592_000 // 30 days — default stream rate period

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || ''

export const EXPLORER_TX = (hash: string) => `${ARC_EXPLORER}/tx/${hash}`
export const EXPLORER_ADDR = (addr: string) => `${ARC_EXPLORER}/address/${addr}`

// poolId = keccak256(abi.encode(org, token)) — must match MagmosPayroll.poolIdFor.
export function poolIdFor(org: `0x${string}`, token: `0x${string}`): `0x${string}` {
  return keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [org, token])
  )
}

// Min claim (raw) the contract enforces: 10% of one week's pay at the stream rate.
export function minClaimRaw(rateRaw: bigint, periodS: bigint): bigint {
  if (periodS === 0n) return 0n
  return (BigInt(WEEK_S) * rateRaw) / (periodS * 10n)
}
