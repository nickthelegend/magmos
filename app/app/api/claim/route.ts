import { NextResponse, type NextRequest } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDb, COLLECTIONS } from '@/lib/mongo'
import { isValidMeta } from '@/lib/payroll-delivery'
import { ensureIndexes } from '@/lib/mongo-indexes'
import { LIMITS, rateLimit, rateLimitHeaders } from '@/lib/rate-limit'

export const runtime = 'nodejs'

/**
 * The employee's side of confidential payroll.
 *
 * Authenticated with `verifyAuth`, not `requireOwner`: the caller is an employee proving they
 * control a wallet on some org's roster, not an org owner. The address comes from the recovered
 * signature and never from the body — otherwise anyone could name someone else's wallet.
 *
 * Note what is NOT here: any private key material. The spending and viewing keys are derived in the
 * employee's browser from a wallet signature and never sent anywhere. This endpoint only stores the
 * public halves and hands back the proofs needed to claim, both of which are safe to lose.
 */

/** What is waiting for this employee, and whether they are set up to receive it. */
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const rl = rateLimit(`claim-read:${auth.address}`, LIMITS.read.limit, LIMITS.read.windowMs)
  if (!rl.ok) {
    return NextResponse.json({ error: 'Slow down.' }, { status: 429, headers: rateLimitHeaders(rl) })
  }
  await ensureIndexes()

  const db = await getDb()
  const employee = auth.address!

  const records = await db
    .collection(COLLECTIONS.employees)
    .find({ walletAddress: { $regex: `^${employee}$`, $options: 'i' } }, { projection: { _id: 0 } })
    .toArray()

  const registered = records.some((r) => isValidMeta(r.stealthMeta))

  // Every delivered-but-unclaimed payment, with the proof needed to claim it.
  const payments = await db
    .collection(COLLECTIONS.payrollPayments)
    .find(
      { employee: employee.toLowerCase(), status: 'sealed', stealthAddress: { $exists: true } },
      { projection: { _id: 0 } }
    )
    .sort({ updatedAt: -1 })
    .limit(50)
    .toArray()

  return NextResponse.json({
    registered,
    // Deliberately explicit rather than an empty state: "nothing here" reads as a bug to someone
    // who was told they have private payouts waiting.
    message: registered
      ? undefined
      : 'You have not set up a private payout key yet. Until you do, your employer cannot pay you confidentially.',
    payments: payments.map((p) => ({
      batchId: p.batchId,
      stealthAddress: p.stealthAddress,
      amountUsdc: Number(p.amountMicros ?? 0) / 1e6,
      amountMicros: String(p.amountMicros ?? '0'),
      proof: p.claimProof ?? [],
      // Returned so the client can re-derive the stealth key itself instead of trusting the address
      // we stored. Without this a compromised server could point a claim at an address it controls.
      ephemeralPubKey: p.ephemeralPubKey,
      viewTag: p.viewTag,
      runId: p.runId,
      settleTxHash: p.settleTxHash,
      fundTxHash: p.sealTxHash,
      at: p.updatedAt,
    })),
  })
}

/**
 * Publish a meta-address — the public halves of the employee's stealth identity.
 *
 * Validated before storage. A malformed key produces a stealth address whose private key nobody can
 * derive, which means salary that cannot be claimed until the reclaim window expires. Rejecting it
 * here costs a round-trip; accepting it costs someone their pay.
 */
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const rl = rateLimit(`register:${auth.address}`, LIMITS.register.limit, LIMITS.register.windowMs)
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many key updates. Try again in ${rl.retryAfter}s.` },
      { status: 429, headers: rateLimitHeaders(rl) }
    )
  }

  let body: { spendingPubKey?: string; viewingPubKey?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const meta = { spendingPubKey: body.spendingPubKey ?? '', viewingPubKey: body.viewingPubKey ?? '' }
  if (!isValidMeta(meta)) {
    return NextResponse.json(
      { error: 'Both keys must be compressed secp256k1 points (0x02/0x03 + 32 bytes).' },
      { status: 400 }
    )
  }
  if (meta.spendingPubKey === meta.viewingPubKey) {
    // Sharing a viewing key must never confer the ability to spend.
    return NextResponse.json(
      { error: 'Spending and viewing keys must differ — a shared key would let a viewer spend.' },
      { status: 400 }
    )
  }

  const db = await getDb()
  const res = await db.collection(COLLECTIONS.employees).updateMany(
    { walletAddress: { $regex: `^${auth.address}$`, $options: 'i' } },
    { $set: { stealthMeta: meta, stealthRegisteredAt: new Date().toISOString() } }
  )

  if (res.matchedCount === 0) {
    return NextResponse.json(
      { error: 'This wallet is not on any employer roster yet.' },
      { status: 404 }
    )
  }
  return NextResponse.json({ ok: true, rosters: res.matchedCount })
}
