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
import { REAL_USDC } from './cctp'

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_RPC_URL),
  // Coalesce concurrent reads into multicall3 aggregates so the portal's polling (claimable,
  // drawable, advance account, policy, quote) stays well inside the public RPC's rate limit.
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

// ---- Earned Wage Access (MagmosAdvance) ----
// A worker's drawable balance is their live accrual, capped by employer policy and by what the
// pool can actually pay right now. It is not a credit line — see contracts/src/MagmosAdvance.sol.

export interface AdvanceAccount {
  totalDrawn: bigint
  feesPaid: bigint
  feesSubsidized: bigint
  lastDrawAt: bigint
  drawCount: number
}

/** fee, subsidizedByYield, workerPays, netToWorker */
export type AdvanceQuote = readonly [bigint, bigint, bigint, bigint]

async function readAdvance<T>(functionName: string, args: readonly unknown[]): Promise<T> {
  return (await publicClient.readContract({
    address: MAGMOS_ADVANCE,
    abi: ADVANCE_ABI,
    functionName,
    args,
  })) as T
}

export interface AdvancePolicy {
  maxDrawBps: number
  minDraw: bigint
  disabled: boolean
  exists: boolean
}

export const getDrawable = (poolId: `0x${string}`, emp: Address) =>
  readAdvance<bigint>('drawableAmount', [poolId, emp])
export const getAdvancePolicy = (poolId: `0x${string}`) =>
  readAdvance<AdvancePolicy>('policyOf', [poolId])
export const getAdvanceAccount = (poolId: `0x${string}`, emp: Address) =>
  readAdvance<AdvanceAccount>('accountOf', [poolId, emp])
export const quoteAdvance = (poolId: `0x${string}`, amount: bigint) =>
  readAdvance<AdvanceQuote>('quote', [poolId, amount])

export interface AdvanceDraw {
  amount: bigint
  fee: bigint
  subsidized: bigint
  netToWorker: bigint
  timestamp: number
  txHash: `0x${string}`
}

const advanceDrawnEvent = {
  type: 'event',
  name: 'AdvanceDrawn',
  inputs: [
    { name: 'poolId', type: 'bytes32', indexed: true },
    { name: 'worker', type: 'address', indexed: true },
    { name: 'amount', type: 'uint256', indexed: false },
    { name: 'fee', type: 'uint256', indexed: false },
    { name: 'subsidizedByYield', type: 'uint256', indexed: false },
    { name: 'netToWorker', type: 'uint256', indexed: false },
    { name: 'remainingClaimable', type: 'uint256', indexed: false },
    { name: 'timestamp', type: 'uint256', indexed: false },
  ],
} as const

/**
 * Recent draws for one worker, newest first.
 *
 * Arc's RPC caps eth_getLogs at a 10,000-block range, so this is a single window just under
 * that rather than a full history scan. The authoritative lifetime total comes from
 * `accountOf` (a plain state read that never depends on log retention); this list is only the
 * recent detail. Returns [] rather than throwing if the node rate-limits.
 */
export async function getAdvanceHistory(
  poolId: `0x${string}`,
  worker: Address,
  limit = 5
): Promise<AdvanceDraw[]> {
  try {
    const latest = await publicClient.getBlockNumber()
    const window = 9_000n
    const fromBlock = latest > window ? latest - window : 0n
    const logs = await publicClient.getLogs({
      address: MAGMOS_ADVANCE,
      event: advanceDrawnEvent,
      args: { poolId, worker },
      fromBlock,
      toBlock: latest,
    })
    return logs
      .map((l) => ({
        amount: l.args.amount as bigint,
        fee: l.args.fee as bigint,
        subsidized: l.args.subsidizedByYield as bigint,
        netToWorker: l.args.netToWorker as bigint,
        timestamp: Number(l.args.timestamp as bigint),
        txHash: l.transactionHash as `0x${string}`,
      }))
      .reverse()
      .slice(0, limit)
  } catch {
    return []
  }
}

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

// ---- REAL Circle USDC (for the CCTP "Send home" bridge) ----
// CCTP only bridges native Circle USDC (0x3600…0000), NOT the streamed faucet test token,
// so these read the recipient's balance/allowance for the REAL_USDC contract.
export async function getRealUsdcBalance(owner: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: REAL_USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner],
  })) as bigint
}

export async function getRealUsdcAllowance(owner: Address, spender: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: REAL_USDC,
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
