// viem read helpers against Arc. Replaces the Sui `readPoolSummary`/`readClaimable`/
// `findMyStreamPools`/etc. The deployed contracts expose enumerable indexes so the whole
// dashboard can be built chain-first (no indexer): orgPools → getPool → employeesOf →
// getStream/claimableAmount.

import { createPublicClient, http, erc20Abi, type Address } from 'viem'
import { arcTestnet } from './wagmi'
import {
  MAGMOS_PAYROLL,
  MAGMOS_VAULT,
  MAGMOS_ADVANCE,
  PAYROLL_ABI,
  VAULT_ABI,
  ADVANCE_ABI,
  ARC_RPC_URL,
  USDC,
} from './magmos'

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_RPC_URL),
  // Coalesce concurrent reads into multicall3 aggregates. The dashboard fans out per recipient
  // (stream + claimable + advance account + drawable, ×N) every 5s; unbatched that trips the
  // public Arc RPC's rate limit and reads silently degrade to zero.
  batch: { multicall: { wait: 20 } },
})

export interface PoolSummary {
  org: Address
  token: Address
  totalDeposited: bigint
  totalClaimed: bigint
  balance: bigint
  exists: boolean
}

export interface StreamView {
  rateAmount: bigint
  ratePeriod: bigint
  pendingBalance: bigint
  startedAt: bigint
  claimedAt: bigint
  totalPausedSecs: bigint
  pausedAt: bigint
  stoppedAt: bigint
  exists: boolean
}

async function readPayroll<T>(functionName: string, args: readonly unknown[]): Promise<T> {
  return (await publicClient.readContract({
    address: MAGMOS_PAYROLL,
    abi: PAYROLL_ABI,
    functionName,
    args,
  })) as T
}

// ---- Earned Wage Access (MagmosAdvance) ----
// Employer-side view of early access: how much workers have taken of what they already earned,
// and how much they could take right now (the employer's live liquidity exposure).

export interface AdvanceAccount {
  totalDrawn: bigint
  feesPaid: bigint
  feesSubsidized: bigint
  lastDrawAt: bigint
  drawCount: number
}

export interface AdvanceStats {
  advanced: bigint
  feesCharged: bigint
  feesSubsidized: bigint
  feesPaidByWorkers: bigint
  yieldContributed: bigint
}

export interface PoolExposure {
  drawableNow: bigint
  lifetimeDrawn: bigint
  workers: bigint
}

async function readAdvance<T>(functionName: string, args: readonly unknown[]): Promise<T> {
  return (await publicClient.readContract({
    address: MAGMOS_ADVANCE,
    abi: ADVANCE_ABI,
    functionName,
    args,
  })) as T
}

export const getDrawable = (poolId: `0x${string}`, emp: Address) =>
  readAdvance<bigint>('drawableAmount', [poolId, emp])
export const getAdvanceAccount = (poolId: `0x${string}`, emp: Address) =>
  readAdvance<AdvanceAccount>('accountOf', [poolId, emp])

export async function getPoolExposure(poolId: `0x${string}`): Promise<PoolExposure> {
  const r = await readAdvance<[bigint, bigint, bigint]>('poolExposure', [poolId])
  return { drawableNow: r[0], lifetimeDrawn: r[1], workers: r[2] }
}

export async function getAdvanceStats(): Promise<AdvanceStats> {
  const r = await readAdvance<[bigint, bigint, bigint, bigint, bigint]>('stats', [])
  return {
    advanced: r[0],
    feesCharged: r[1],
    feesSubsidized: r[2],
    feesPaidByWorkers: r[3],
    yieldContributed: r[4],
  }
}

export const getSubsidyBalance = (token: Address) =>
  readAdvance<bigint>('subsidyBalance', [token])

// ---- Payroll reads ----
export async function getPool(poolId: `0x${string}`): Promise<PoolSummary> {
  const r = await readPayroll<[Address, Address, bigint, bigint, bigint, boolean]>('getPool', [
    poolId,
  ])
  return {
    org: r[0],
    token: r[1],
    totalDeposited: r[2],
    totalClaimed: r[3],
    balance: r[4],
    exists: r[5],
  }
}

export const getOrgPools = (org: Address) => readPayroll<`0x${string}`[]>('orgPools', [org])
export const getEmployeePools = (emp: Address) =>
  readPayroll<`0x${string}`[]>('employeePools', [emp])
export const getEmployees = (poolId: `0x${string}`) =>
  readPayroll<Address[]>('employeesOf', [poolId])
export const getClaimable = (poolId: `0x${string}`, emp: Address) =>
  readPayroll<bigint>('claimableAmount', [poolId, emp])
export const hasStream = (poolId: `0x${string}`, emp: Address) =>
  readPayroll<boolean>('hasStream', [poolId, emp])
export const getStream = (poolId: `0x${string}`, emp: Address) =>
  readPayroll<StreamView>('getStream', [poolId, emp])

// ---- ERC-20 USDC ----
export async function getUsdcBalance(owner: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner],
  })) as bigint
}

export async function getUsdcAllowance(owner: Address, spender: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender],
  })) as bigint
}

// ---- Vault reads ----
export async function getOwnerVaults(owner: Address): Promise<bigint[]> {
  return (await publicClient.readContract({
    address: MAGMOS_VAULT,
    abi: VAULT_ABI,
    functionName: 'ownerVaults',
    args: [owner],
  })) as bigint[]
}

export async function getVaultBalance(vaultId: bigint, token: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: MAGMOS_VAULT,
    abi: VAULT_ABI,
    functionName: 'balanceOf',
    args: [vaultId, token],
  })) as bigint
}
