// Write-request builders for wagmi's `useWriteContract`. Each returns a config object the
// component passes to `writeContract(...)`. Replaces the Sui PTB builders in lib/tx.ts.
//
// Flow notes:
//  - Funding a pool needs a prior USDC `approve(payroll, amount)` (ERC-20), then
//    `deposit`/`createPoolAndDeposit`. Two txs (or one if allowance already set).
//  - Amounts are raw 6-dec USDC (use toRaw from lib/tokens). ratePeriods are in SECONDS.

import { erc20Abi, type Address } from 'viem'
import {
  MAGMOS_PAYROLL,
  MAGMOS_VAULT,
  MAGMOS_ADVANCE,
  PAYROLL_ABI,
  VAULT_ABI,
  ADVANCE_ABI,
  USDC,
} from './magmos'

// ---- ERC-20 (USDC) ----
export const approveUsdc = (spender: Address, amount: bigint) =>
  ({ address: USDC, abi: erc20Abi, functionName: 'approve', args: [spender, amount] }) as const

// ---- Payroll (org) ----
export const createPool = (token: Address) =>
  ({ address: MAGMOS_PAYROLL, abi: PAYROLL_ABI, functionName: 'createPool', args: [token] }) as const

export const createPoolAndDeposit = (
  token: Address,
  amount: bigint,
  employees: Address[],
  rateAmounts: bigint[],
  ratePeriods: bigint[]
) =>
  ({
    address: MAGMOS_PAYROLL,
    abi: PAYROLL_ABI,
    functionName: 'createPoolAndDeposit',
    args: [token, amount, employees, rateAmounts, ratePeriods],
  }) as const

export const deposit = (
  poolId: `0x${string}`,
  amount: bigint,
  employees: Address[],
  rateAmounts: bigint[],
  ratePeriods: bigint[]
) =>
  ({
    address: MAGMOS_PAYROLL,
    abi: PAYROLL_ABI,
    functionName: 'deposit',
    args: [poolId, amount, employees, rateAmounts, ratePeriods],
  }) as const

export const topup = (poolId: `0x${string}`, amount: bigint) =>
  ({ address: MAGMOS_PAYROLL, abi: PAYROLL_ABI, functionName: 'topup', args: [poolId, amount] }) as const

export const pauseStream = (poolId: `0x${string}`, employee: Address) =>
  ({ address: MAGMOS_PAYROLL, abi: PAYROLL_ABI, functionName: 'pauseStream', args: [poolId, employee] }) as const

export const resumeStream = (poolId: `0x${string}`, employee: Address) =>
  ({ address: MAGMOS_PAYROLL, abi: PAYROLL_ABI, functionName: 'resumeStream', args: [poolId, employee] }) as const

export const stopStream = (poolId: `0x${string}`, employee: Address) =>
  ({ address: MAGMOS_PAYROLL, abi: PAYROLL_ABI, functionName: 'stopStream', args: [poolId, employee] }) as const

export const grantPoolRole = (poolId: `0x${string}`, account: Address, role: number) =>
  ({ address: MAGMOS_PAYROLL, abi: PAYROLL_ABI, functionName: 'grantPoolRole', args: [poolId, account, role] }) as const

// ---- Payroll (recipient) ----
export const claim = (poolId: `0x${string}`) =>
  ({ address: MAGMOS_PAYROLL, abi: PAYROLL_ABI, functionName: 'claim', args: [poolId] }) as const

// ---- Earned Wage Access (recipient) ----
// Draws wages already accrued on the stream. Lands plain USDC in the worker's own wallet, exactly
// like a claim — which is why the CCTP "send home" path needs no special casing for advances.
export const drawAdvance = (poolId: `0x${string}`, amount: bigint) =>
  ({
    address: MAGMOS_ADVANCE,
    abi: ADVANCE_ABI,
    functionName: 'drawAdvance',
    args: [poolId, amount],
  }) as const

// ---- Vault (recipient savings) ----
export const createVault = (name: string) =>
  ({ address: MAGMOS_VAULT, abi: VAULT_ABI, functionName: 'createVault', args: [name] }) as const

export const vaultDeposit = (vaultId: bigint, token: Address, amount: bigint) =>
  ({ address: MAGMOS_VAULT, abi: VAULT_ABI, functionName: 'deposit', args: [vaultId, token, amount] }) as const

export const vaultWithdraw = (vaultId: bigint, token: Address, amount: bigint) =>
  ({ address: MAGMOS_VAULT, abi: VAULT_ABI, functionName: 'withdraw', args: [vaultId, token, amount] }) as const

/** Claim from several pools in one signature (a recipient with more than one employer). */
export const claimMany = (poolIds: `0x${string}`[]) =>
  ({ address: MAGMOS_PAYROLL, abi: PAYROLL_ABI, functionName: 'claimMany', args: [poolIds] }) as const

/** Claim straight to another address — a savings wallet, an exchange, family. */
export const claimTo = (poolId: `0x${string}`, to: Address) =>
  ({ address: MAGMOS_PAYROLL, abi: PAYROLL_ABI, functionName: 'claimTo', args: [poolId, to] }) as const

/**
 * Draw earned pay directly to another address.
 * Saves a second transaction (and a second gas payment) when the money is going onward anyway.
 */
export const drawAdvanceTo = (poolId: `0x${string}`, amount: bigint, to: Address) =>
  ({
    address: MAGMOS_ADVANCE,
    abi: ADVANCE_ABI,
    functionName: 'drawAdvanceTo',
    args: [poolId, amount, to],
  }) as const

/** Draw everything currently available without reading the limit first. */
export const drawMax = (poolId: `0x${string}`) =>
  ({ address: MAGMOS_ADVANCE, abi: ADVANCE_ABI, functionName: 'drawMax', args: [poolId] }) as const
