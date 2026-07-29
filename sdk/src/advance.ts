// Earned Wage Access client for @magmos/sdk.
//
// Lets a partner app (a super-app, a neobank, a marketplace) offer "get paid early" on top of a
// Magmos payroll stream without re-deriving any streaming math. Every limit is enforced on-chain;
// this is a typed wrapper, not a source of truth.

import type { Address, PublicClient } from 'viem'

export const MAGMOS_ADVANCE_ADDRESS =
  '0xD3bB15A03982e928e38DcE7610930246867fa240' as const satisfies Address

/** Minimal ABI slice — keeps the published bundle small. */
export const advanceAbi = [
  {
    type: 'function',
    name: 'drawableAmount',
    stateMutability: 'view',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'worker', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'quote',
    stateMutability: 'view',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [
      { name: 'fee', type: 'uint256' },
      { name: 'subsidized', type: 'uint256' },
      { name: 'workerPays', type: 'uint256' },
      { name: 'netToWorker', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'accountOf',
    stateMutability: 'view',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'worker', type: 'address' },
    ],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'totalDrawn', type: 'uint256' },
          { name: 'feesPaid', type: 'uint256' },
          { name: 'feesSubsidized', type: 'uint256' },
          { name: 'lastDrawAt', type: 'uint64' },
          { name: 'drawCount', type: 'uint32' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'drawAdvance',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'drawAdvanceTo',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
      { name: 'to', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'drawMax',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

export interface AdvanceQuote {
  /** Total access fee on the draw. */
  fee: bigint
  /** Portion of the fee absorbed by yield on the employer's payroll float. */
  subsidizedByYield: bigint
  /** What the worker actually bears (usually zero). */
  workerPays: bigint
  /** USDC delivered. */
  netToWorker: bigint
}

export interface AdvanceAccount {
  totalDrawn: bigint
  feesPaid: bigint
  feesSubsidized: bigint
  lastDrawAt: bigint
  drawCount: number
}

/** How much this worker can draw right now (already capped by policy and pool liquidity). */
export async function getDrawable(
  client: PublicClient,
  poolId: `0x${string}`,
  worker: Address,
  advance: Address = MAGMOS_ADVANCE_ADDRESS
): Promise<bigint> {
  return (await client.readContract({
    address: advance,
    abi: advanceAbi,
    functionName: 'drawableAmount',
    args: [poolId, worker],
  })) as bigint
}

/** Preview a draw's fee split before asking the user to sign. */
export async function quoteAdvance(
  client: PublicClient,
  poolId: `0x${string}`,
  amount: bigint,
  advance: Address = MAGMOS_ADVANCE_ADDRESS
): Promise<AdvanceQuote> {
  const r = (await client.readContract({
    address: advance,
    abi: advanceAbi,
    functionName: 'quote',
    args: [poolId, amount],
  })) as readonly [bigint, bigint, bigint, bigint]
  return { fee: r[0], subsidizedByYield: r[1], workerPays: r[2], netToWorker: r[3] }
}

/** Lifetime draw history totals for a worker on one pool. */
export async function getAdvanceAccount(
  client: PublicClient,
  poolId: `0x${string}`,
  worker: Address,
  advance: Address = MAGMOS_ADVANCE_ADDRESS
): Promise<AdvanceAccount> {
  const a = (await client.readContract({
    address: advance,
    abi: advanceAbi,
    functionName: 'accountOf',
    args: [poolId, worker],
  })) as AdvanceAccount
  return a
}

/**
 * Write-request builder for `useWriteContract` / `writeContract`.
 * Pass `to` to deliver the draw straight to another address in the same transaction.
 */
export function buildDrawRequest(opts: {
  poolId: `0x${string}`
  amount?: bigint
  to?: Address
  advance?: Address
}) {
  const address = opts.advance ?? MAGMOS_ADVANCE_ADDRESS
  if (opts.amount === undefined) {
    return { address, abi: advanceAbi, functionName: 'drawMax' as const, args: [opts.poolId] as const }
  }
  if (opts.to) {
    return {
      address,
      abi: advanceAbi,
      functionName: 'drawAdvanceTo' as const,
      args: [opts.poolId, opts.amount, opts.to] as const,
    }
  }
  return {
    address,
    abi: advanceAbi,
    functionName: 'drawAdvance' as const,
    args: [opts.poolId, opts.amount] as const,
  }
}
