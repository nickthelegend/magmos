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

// In the browser, reads go through our own /api/rpc proxy: it caches, coalesces identical
// concurrent calls into one upstream request, and retries Arc's 429s. On the server (and in Node
// scripts) there is no origin to be relative to, so talk to Arc directly.
const READ_RPC = typeof window === 'undefined' ? ARC_RPC_URL : '/api/rpc'

export const publicClient = createPublicClient({
  chain: arcTestnet,
  // Retry at the transport level: Arc answers a single call reliably but rejects bursts with a
  // 429, and a server-side route (which cannot use the same-origin proxy) would otherwise turn a
  // transient throttle into a 502. Cheap insurance — successful calls never pay for it.
  transport: http(READ_RPC, { retryCount: 4, retryDelay: 250, timeout: 20_000 }),
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

export interface AdvancePolicy {
  maxDrawBps: number
  minDraw: bigint
  disabled: boolean
  exists: boolean
}
export const getAdvancePolicy = (poolId: `0x${string}`) =>
  readAdvance<AdvancePolicy>('policyOf', [poolId])

export interface PoolLiability {
  accrued: bigint
  balance: bigint
  shortfall: bigint
}

/**
 * What the pool owes across every stream vs what is funded.
 *
 * The contract does not enforce coverage — `claim()` just reverts when a pool runs dry — so this
 * gap is real. Reading it here is what lets the dashboard warn an employer *before* a worker
 * cannot claim, instead of discovering it at the till.
 */
export async function getPoolLiability(poolId: `0x${string}`): Promise<PoolLiability> {
  const r = await readPayroll<[bigint, bigint, bigint]>('poolLiability', [poolId])
  return { accrued: r[0], balance: r[1], shortfall: r[2] }
}

export interface AdvancePoolStats {
  drawn: bigint
  feesCharged: bigint
  feesSubsidized: bigint
  feesOnWorkers: bigint
}
export async function getAdvancePoolStats(poolId: `0x${string}`): Promise<AdvancePoolStats> {
  const r = await readAdvance<[bigint, bigint, bigint, bigint]>('poolStats', [poolId])
  return { drawn: r[0], feesCharged: r[1], feesSubsidized: r[2], feesOnWorkers: r[3] }
}

export interface SolvencySnapshot {
  pool: PoolSummary
  liability: PoolLiability
  exposure: PoolExposure
  stats: AdvancePoolStats
}

/**
 * Everything the solvency endpoint reports, as ONE multicall.
 *
 * Issuing these as concurrent eth_calls reliably drew a 429 from Arc and turned the endpoint into
 * an intermittent 502 — the exact failure mode a monitoring endpoint must not have.
 */
export async function getSolvencySnapshot(poolId: `0x${string}`): Promise<SolvencySnapshot> {
  const res = await publicClient.multicall({
    contracts: [
      { address: MAGMOS_PAYROLL, abi: PAYROLL_ABI, functionName: 'getPool', args: [poolId] },
      { address: MAGMOS_PAYROLL, abi: PAYROLL_ABI, functionName: 'poolLiability', args: [poolId] },
      { address: MAGMOS_ADVANCE, abi: ADVANCE_ABI, functionName: 'poolExposure', args: [poolId] },
      { address: MAGMOS_ADVANCE, abi: ADVANCE_ABI, functionName: 'poolStats', args: [poolId] },
    ],
    allowFailure: false,
  })
  const p = res[0] as [Address, Address, bigint, bigint, bigint, boolean]
  const l = res[1] as [bigint, bigint, bigint]
  const e = res[2] as [bigint, bigint, bigint]
  const st = res[3] as [bigint, bigint, bigint, bigint]
  return {
    pool: {
      org: p[0],
      token: p[1],
      totalDeposited: p[2],
      totalClaimed: p[3],
      balance: p[4],
      exists: p[5],
    },
    liability: { accrued: l[0], balance: l[1], shortfall: l[2] },
    exposure: { drawableNow: e[0], lifetimeDrawn: e[1], workers: e[2] },
    stats: { drawn: st[0], feesCharged: st[1], feesSubsidized: st[2], feesOnWorkers: st[3] },
  }
}

export interface EmployeeSnapshot {
  addr: Address
  claimable: bigint
  stream: StreamView
  advance: AdvanceAccount
  drawable: bigint
}

/**
 * Every per-recipient read for a pool, as ONE request.
 *
 * Arc's public RPC rejects concurrent requests outright ("request limit reached") — measured:
 * a single eth_call succeeds while 12 in flight all fail in ~250ms. viem's `batch.multicall`
 * transport option did not reliably coalesce them, so the fan-out is issued explicitly as a
 * multicall3 aggregate instead. `allowFailure: false` keeps this honest: a genuine RPC failure
 * rejects the query (react-query then holds the last good snapshot) rather than silently
 * rendering 0.00 as if it were real payroll data.
 */
export async function getEmployeeSnapshots(
  poolId: `0x${string}`,
  employees: readonly Address[]
): Promise<EmployeeSnapshot[]> {
  if (employees.length === 0) return []
  const contracts = employees.flatMap((addr) => [
    { address: MAGMOS_PAYROLL, abi: PAYROLL_ABI, functionName: 'claimableAmount', args: [poolId, addr] },
    { address: MAGMOS_PAYROLL, abi: PAYROLL_ABI, functionName: 'getStream', args: [poolId, addr] },
    { address: MAGMOS_ADVANCE, abi: ADVANCE_ABI, functionName: 'accountOf', args: [poolId, addr] },
    { address: MAGMOS_ADVANCE, abi: ADVANCE_ABI, functionName: 'drawableAmount', args: [poolId, addr] },
  ])
  const res = await publicClient.multicall({ contracts, allowFailure: false })
  return employees.map((addr, i) => ({
    addr,
    claimable: res[i * 4] as bigint,
    stream: res[i * 4 + 1] as StreamView,
    advance: res[i * 4 + 2] as AdvanceAccount,
    drawable: res[i * 4 + 3] as bigint,
  }))
}

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
