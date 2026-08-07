import { NextResponse, type NextRequest } from 'next/server'
import { createWalletClient, defineChain, http, isAddress, type Hex } from 'viem'
import { requireOwner } from '@/lib/auth'
import {
  ARC_CHAIN_ID,
  ARC_RPC_URL,
  MAGMOS_STEALTH_PAYOUT,
  STEALTH_PAYOUT_ABI,
} from '@/lib/magmos'
import { appendAudit } from '@/lib/payroll-store'
import { settlementPublicClient, signerAccount } from '@/lib/payroll-signer'
import { LIMITS, rateLimit, rateLimitHeaders } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const maxDuration = 120

type Params = { params: Promise<{ wallet: string; batchId: string }> }

const arc = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
})

/**
 * Recover salary nobody claimed, after the window closes.
 *
 * This exists because the alternative is worse: a lost viewing key would otherwise strand an
 * employee's pay in the contract forever, with no one able to move it. It is deliberately narrow —
 * only the remainder, only after the expiry the employer committed to when funding, and the contract
 * enforces both. An employer cannot cancel a salary that is owed and merely unclaimed.
 *
 * The preflight below duplicates checks the contract already makes. That is on purpose: a revert
 * costs gas and says `NotExpired` with no context, where this can say how many days are left.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { wallet, batchId } = await params
  if (!isAddress(wallet)) return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
  if (!/^0x[0-9a-fA-F]{64}$/.test(batchId)) {
    return NextResponse.json({ error: 'Invalid batch id' }, { status: 400 })
  }

  const auth = await requireOwner(req, wallet)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const rl = rateLimit(`reclaim:${auth.address}`, LIMITS.settle.limit, LIMITS.settle.windowMs)
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${rl.retryAfter}s.` },
      { status: 429, headers: rateLimitHeaders(rl) }
    )
  }

  const acct = signerAccount()
  if (!acct) {
    return NextResponse.json({ error: 'PAYROLL_SIGNER_KEY is not configured' }, { status: 503 })
  }

  type OnChainBatch = {
    total: bigint
    claimed: bigint
    funder: string
    expiresAt: bigint
    exists: boolean
  }

  let batch: OnChainBatch
  try {
    batch = (await settlementPublicClient.readContract({
      address: MAGMOS_STEALTH_PAYOUT,
      abi: STEALTH_PAYOUT_ABI,
      functionName: 'getBatch',
      args: [batchId as Hex],
    })) as OnChainBatch
  } catch (e) {
    return NextResponse.json(
      { error: 'Could not read the batch', detail: (e as Error).message.slice(0, 160) },
      { status: 502 }
    )
  }

  if (!batch.exists) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  const now = BigInt(Math.floor(Date.now() / 1000))
  if (now < batch.expiresAt) {
    const days = Math.ceil(Number(batch.expiresAt - now) / 86400)
    return NextResponse.json(
      {
        error: `The claim window has not closed. ${days} day(s) left — recipients can still claim, and pulling their pay back early is not something this can do.`,
      },
      { status: 409 }
    )
  }
  const remaining = batch.total - batch.claimed
  if (remaining === 0n) {
    return NextResponse.json({ error: 'Everyone claimed. Nothing to reclaim.' }, { status: 409 })
  }

  // The contract only lets the original funder reclaim, and that is the signer.
  if (batch.funder.toLowerCase() !== acct.address.toLowerCase()) {
    return NextResponse.json(
      {
        error: `This batch was funded by ${batch.funder}, not the current payroll signer, so only that address can reclaim it.`,
      },
      { status: 409 }
    )
  }

  try {
    const walletClient = createWalletClient({ account: acct, chain: arc, transport: http(ARC_RPC_URL) })
    const txHash = await walletClient.writeContract({
      address: MAGMOS_STEALTH_PAYOUT,
      abi: STEALTH_PAYOUT_ABI,
      functionName: 'reclaim',
      args: [batchId as Hex],
    })
    const rc = await settlementPublicClient.waitForTransactionReceipt({ hash: txHash })
    if (rc.status !== 'success') throw new Error(`reclaim reverted (${txHash})`)

    await appendAudit({
      orgWallet: wallet.toLowerCase(),
      at: new Date().toISOString(),
      event: 'run.settled',
      actor: auth.address!,
      detail: `Reclaimed ${Number(remaining) / 1e6} USDC of unclaimed pay from batch ${batchId.slice(0, 10)}… after the claim window closed.`,
      refs: { batchId, txHash },
    })

    return NextResponse.json({ ok: true, txHash, reclaimedUsdc: Number(remaining) / 1e6 })
  } catch (e) {
    return NextResponse.json(
      { error: 'Reclaim failed', detail: (e as Error).message.slice(0, 200) },
      { status: 502 }
    )
  }
}
