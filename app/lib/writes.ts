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

// ---- Test-USDC faucet (MagmosUSDC.faucet mints 10,000 test USDC to the caller) ----
export const FAUCET_ABI = [
  { type: 'function', name: 'faucet', inputs: [], outputs: [], stateMutability: 'nonpayable' },
] as const

export const faucetMint = () =>
  ({ address: USDC, abi: FAUCET_ABI, functionName: 'faucet', args: [] }) as const

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

// ---- Vault (recipient savings) ----
export const createVault = (name: string) =>
  ({ address: MAGMOS_VAULT, abi: VAULT_ABI, functionName: 'createVault', args: [name] }) as const

export const vaultDeposit = (vaultId: bigint, token: Address, amount: bigint) =>
  ({ address: MAGMOS_VAULT, abi: VAULT_ABI, functionName: 'deposit', args: [vaultId, token, amount] }) as const

export const vaultWithdraw = (vaultId: bigint, token: Address, amount: bigint) =>
  ({ address: MAGMOS_VAULT, abi: VAULT_ABI, functionName: 'withdraw', args: [vaultId, token, amount] }) as const

// ---- Batch stream control (one signature for a whole roster) ----
export const pauseMany = (poolId: `0x${string}`, employees: Address[]) =>
  ({
    address: MAGMOS_PAYROLL,
    abi: PAYROLL_ABI,
    functionName: 'pauseMany',
    args: [poolId, employees],
  }) as const

export const resumeMany = (poolId: `0x${string}`, employees: Address[]) =>
  ({
    address: MAGMOS_PAYROLL,
    abi: PAYROLL_ABI,
    functionName: 'resumeMany',
    args: [poolId, employees],
  }) as const

// ---- Earned Wage Access (employer side) ----
// The employer sets an exposure envelope once; they never approve individual draws.
export const setPoolPolicy = (
  poolId: `0x${string}`,
  maxDrawBps: number,
  minDraw: bigint,
  disabled: boolean
) =>
  ({
    address: MAGMOS_ADVANCE,
    abi: ADVANCE_ABI,
    functionName: 'setPoolPolicy',
    args: [poolId, maxDrawBps, minDraw, disabled],
  }) as const

/** Park float yield to absorb workers' access fees. */
export const fundSubsidy = (token: Address, amount: bigint) =>
  ({
    address: MAGMOS_ADVANCE,
    abi: ADVANCE_ABI,
    functionName: 'fundSubsidy',
    args: [token, amount],
  }) as const
