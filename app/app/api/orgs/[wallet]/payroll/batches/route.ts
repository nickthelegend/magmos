import { NextResponse, type NextRequest } from 'next/server'
import { isAddress, type Hex } from 'viem'
import { requireOwner } from '@/lib/auth'
import { MAGMOS_STEALTH_PAYOUT, STEALTH_PAYOUT_ABI } from '@/lib/magmos'
import { getDb, COLLECTIONS } from '@/lib/mongo'
import { ensureIndexes } from '@/lib/mongo-indexes'
import { settlementPublicClient } from '@/lib/payroll-signer'
import { LIMITS, rateLimit, rateLimitHeaders } from '@/lib/rate-limit'

export const runtime = 'nodejs'

type Params = { params: Promise<{ wallet: string }> }

/**
 * Delivery batches, from the employer's side.
 *
 * Deliberately reconciles the database against the chain rather than reporting either alone. The
 * database knows which run a batch belongs to and how many people were in it; only the chain knows
 * how much has actually been claimed. Reporting "delivered" from the database would tell an employer
 * their people have been paid when the money may still be sitting in the contract unclaimed.
 *
 * That gap is the useful signal here — an employee who never claims has probably lost their keys or
 * never set them up, and the employer needs to see that before the reclaim window closes.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { wallet } = await params
  if (!isAddress(wallet)) return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })

  const auth = await requireOwner(req, wallet)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const rl = rateLimit(`batches:${auth.address}`, LIMITS.read.limit, LIMITS.read.windowMs)
  if (!rl.ok) {
    return NextResponse.json({ error: 'Slow down.' }, { status: 429, headers: rateLimitHeaders(rl) })
  }
  await ensureIndexes()

  const org = wallet.toLowerCase()
  const db = await getDb()

  // One row per batch, newest first. Grouped in the database rather than in JS so a long history
  // does not have to travel over the wire to be counted.
  const grouped = await db
    .collection(COLLECTIONS.payrollPayments)
    .aggregate([
      { $match: { orgWallet: org, batchId: { $exists: true, $ne: null } } },
      {
        $group: {
          _id: '$batchId',
          runId: { $first: '$runId' },
          recipients: { $sum: 1 },
          updatedAt: { $max: '$updatedAt' },
          fundTxHash: { $first: '$sealTxHash' },
        },
      },
      { $sort: { updatedAt: -1 } },
      { $limit: 20 },
    ])
    .toArray()

  const now = Math.floor(Date.now() / 1000)

  // Sequential: Arc's RPC rejects concurrent requests outright (-32011), so a Promise.all over
  // batches here would fail every read at once rather than being faster.
  type OnChainBatch = {
    total: bigint
    claimed: bigint
    expiresAt: bigint
    recipientCount: number
    exists: boolean
  }

  const batches = []
  for (const g of grouped) {
    let onChain: OnChainBatch | null = null
    try {
      onChain = (await settlementPublicClient.readContract({
        address: MAGMOS_STEALTH_PAYOUT,
        abi: STEALTH_PAYOUT_ABI,
        functionName: 'getBatch',
        args: [g._id as Hex],
      })) as OnChainBatch
    } catch {
      // A batch funded by an older deployment will not resolve here. Reporting it as unreadable is
      // honest; reporting zeros would look like nobody had been paid.
    }

    const total = onChain?.exists ? onChain.total : null
    const claimed = onChain?.exists ? onChain.claimed : null
    const expiresAt = onChain?.exists ? Number(onChain.expiresAt) : null

    batches.push({
      batchId: g._id,
      runId: g.runId,
      recipients: g.recipients,
      fundTxHash: g.fundTxHash,
      deliveredAt: g.updatedAt,
      readable: Boolean(onChain?.exists),
      totalUsdc: total === null ? null : Number(total) / 1e6,
      claimedUsdc: claimed === null ? null : Number(claimed) / 1e6,
      unclaimedUsdc: total === null || claimed === null ? null : Number(total - claimed) / 1e6,
      fullyClaimed: total !== null && claimed !== null && claimed >= total,
      expiresAt,
      // Surfaced separately from `expiresAt` because it is the thing an employer acts on: after
      // this, unclaimed salary can be pulled back, and they should chase people before then.
      expiresInDays: expiresAt === null ? null : Math.max(0, Math.ceil((expiresAt - now) / 86400)),
      reclaimable: expiresAt !== null && now >= expiresAt && total !== null && claimed !== null && claimed < total,
    })
  }

  return NextResponse.json({ batches, payoutContract: MAGMOS_STEALTH_PAYOUT })
}
