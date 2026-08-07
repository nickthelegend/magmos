/**
 * The treasury signer — the server-side key that settles payroll.
 *
 * Why a server key at all: settlement is delegated. The org grants SEALER_ROLE to this address once
 * (`grantPoolRole`), and from then on the payroll run can execute without the founder's wallet being
 * present to click through each recipient. The role is revocable on-chain, which is the point — the
 * signer's authority is a pool permission, never custody. It cannot create pools, cannot withdraw,
 * and `settleSealed` can only ever move funds that a stream has already accrued.
 *
 * Loading:
 *   PAYROLL_SIGNER_KEY   0x-prefixed private key of the delegated signer
 *
 * If it is absent, every function here reports that plainly rather than falling back to the
 * deployer key. A payroll route silently signing with the deployer would hand a web request the
 * authority to drain a pool.
 */

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  decodeEventLog,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcCall } from './arc-transport'
import { ARC_CHAIN_ID, ARC_RPC_URL, MAGMOS_PAYROLL, PAYROLL_ABI, SEALER_ROLE } from './magmos'

const arc = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  // Arc's gas token is USDC at 18 decimals — not ether, and not the 6-decimal ERC-20.
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
})

/**
 * Arc's RPC rejects concurrent requests (`-32011 request limit reached`), measured — twelve parallel
 * calls all fail in ~250ms where one succeeds. Settlement is therefore strictly sequential below,
 * and this client is deliberately not wrapped in any batching transport.
 */
export const settlementPublicClient = createPublicClient({ chain: arc, transport: http(ARC_RPC_URL) })

function signerKey(): Hex | null {
  const k = process.env.PAYROLL_SIGNER_KEY?.trim()
  return k && /^0x[0-9a-fA-F]{64}$/.test(k) ? (k as Hex) : null
}

export function signerAccount() {
  const k = signerKey()
  return k ? privateKeyToAccount(k) : null
}

/** Booleans and the public address only — never the key itself. */
export function signerReadiness() {
  const acct = signerAccount()
  return {
    configured: Boolean(acct),
    address: acct?.address,
    hint: acct
      ? undefined
      : 'Set PAYROLL_SIGNER_KEY in .env.local, then grant it SEALER_ROLE on the pool.',
  }
}

/**
 * Does the signer actually hold settlement authority on this pool? Checked before a run rather than
 * discovered as a revert halfway through, which would leave a run part-settled.
 */
export async function signerCanSettle(poolId: Hex): Promise<{ ok: boolean; reason?: string }> {
  const acct = signerAccount()
  if (!acct) return { ok: false, reason: 'PAYROLL_SIGNER_KEY is not configured' }
  try {
    const has = await arcCall(() => settlementPublicClient.readContract({
      address: MAGMOS_PAYROLL,
      abi: PAYROLL_ABI,
      functionName: 'hasPoolRole',
      args: [poolId, acct.address, SEALER_ROLE],
    }))
    return has
      ? { ok: true }
      : {
          ok: false,
          reason: `Signer ${acct.address} does not hold SEALER_ROLE on this pool. The org must call grantPoolRole once.`,
        }
  } catch (e) {
    return { ok: false, reason: `Could not read pool role: ${(e as Error).message.slice(0, 120)}` }
  }
}

/**
 * A commitment to a confidential delivery, published on-chain in place of the recipient and amount.
 *
 * It is a hash, so the settlement log proves *that* a specific delivery was authorised without
 * revealing who or how much. The employer can reproduce it from their own audit record; nobody else
 * can invert it.
 */
export function sealRefFor(runId: string, employee: string, sealId: string): Hex {
  return keccak256(toHex(`magmos:seal:${runId}:${employee.toLowerCase()}:${sealId}`))
}

/**
 * Settle the whole pool in one confidential transaction.
 *
 * This is the payroll path. `settleSealedOnChain` below names a recipient and an amount in calldata,
 * which is public — verified by decoding a real transaction — so it must never carry a payroll run.
 * Here the calldata is `(poolId, sealRef)` and there is nothing to attribute.
 */
export async function settleAllSealedOnChain(
  poolId: Hex,
  sealRef: Hex
): Promise<{ txHash: Hex; totalMicros: bigint; count: number }> {
  const acct = signerAccount()
  if (!acct) throw new Error('PAYROLL_SIGNER_KEY is not configured')

  const wallet = createWalletClient({ account: acct, chain: arc, transport: http(ARC_RPC_URL) })
  const txHash = await arcCall(() => wallet.writeContract({
    address: MAGMOS_PAYROLL,
    abi: PAYROLL_ABI,
    functionName: 'settleAllSealed',
    args: [poolId, sealRef],
  }))
  const rc = await arcCall(() => settlementPublicClient.waitForTransactionReceipt({ hash: txHash }))
  if (rc.status !== 'success') throw new Error(`settleAllSealed reverted (${txHash})`)

  // The totals come back from the PayrollSealed event rather than being assumed from the draft, so
  // what is recorded is what the chain actually did.
  let totalMicros = 0n
  let count = 0
  for (const log of rc.logs) {
    try {
      const d = decodeEventLog({ abi: PAYROLL_ABI, data: log.data, topics: log.topics })
      if (d.eventName === 'PayrollSealed') {
        const a = d.args as unknown as { total: bigint; count: bigint }
        totalMicros = a.total
        count = Number(a.count)
      }
    } catch {
      /* not ours */
    }
  }
  return { txHash, totalMicros, count }
}

export type SettleResult = {
  employee: Address
  amountMicros: bigint
  txHash: Hex
  /** Claimable remaining after the seal. Non-zero is expected: streams accrue per second. */
  remainingClaimable: bigint
}

/**
 * Settle one recipient's accrued pay into the org treasury for confidential delivery.
 *
 * Reverts rather than truncates when `amountMicros` exceeds accrual — an under-settlement that
 * silently paid less than the run promised would be far worse than a failed line the operator can see.
 */
export async function settleSealedOnChain(
  poolId: Hex,
  employee: Address,
  amountMicros: bigint,
  sealRef: Hex
): Promise<SettleResult> {
  const acct = signerAccount()
  if (!acct) throw new Error('PAYROLL_SIGNER_KEY is not configured')

  const wallet = createWalletClient({ account: acct, chain: arc, transport: http(ARC_RPC_URL) })

  const txHash = await wallet.writeContract({
    address: MAGMOS_PAYROLL,
    abi: PAYROLL_ABI,
    functionName: 'settleSealed',
    args: [poolId, employee, amountMicros, sealRef],
  })
  const rc = await settlementPublicClient.waitForTransactionReceipt({ hash: txHash })
  if (rc.status !== 'success') throw new Error(`settleSealed reverted (${txHash})`)

  const remainingClaimable = (await settlementPublicClient.readContract({
    address: MAGMOS_PAYROLL,
    abi: PAYROLL_ABI,
    functionName: 'claimableAmount',
    args: [poolId, employee],
  })) as bigint

  return { employee, amountMicros, txHash, remainingClaimable }
}
