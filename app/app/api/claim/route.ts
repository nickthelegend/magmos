import { NextResponse, type NextRequest } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDb } from '@/lib/mongo'
import { isSealedAddress } from '@/lib/seal'

export const runtime = 'nodejs'

const COLLECTION = 'sealedClaims'

/**
 * The employee's side of the sealed rail.
 *
 * Authenticated with `verifyAuth`, not `requireOwner`: the caller here is the employee proving they
 * control the wallet on the roster, not an org owner. The employee address is taken from the
 * recovered signature and never from the request body — otherwise anyone could name someone else's
 * wallet and open their envelope.
 */

/** What is waiting for this employee. Never returns the recovery phrase. */
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const db = await getDb()
  const claim = await db.collection(COLLECTION).findOne({ employee: auth.address })

  if (!claim) {
    return NextResponse.json({
      hasAddress: false,
      // A specific message rather than an empty state: "nothing here" reads as a bug to someone who
      // was told they have a private payout address.
      message:
        'No sealed payout address has been provisioned for this wallet yet. Your employer creates it when they run provisioning.',
    })
  }

  return NextResponse.json({
    hasAddress: true,
    sealedTo: claim.sealedTo,
    claimed: Boolean(claim.claimed),
    // Present only when it has never been opened. The phrase itself stays server-side until POST.
    phraseAvailable: Boolean(claim.mnemonic) && !claim.claimed,
    provisionedAt: claim.createdAt,
  })
}

/**
 * Open the envelope — once.
 *
 * The phrase is returned exactly one time and deleted from the database in the same operation. That
 * is the whole point of the flow: until this call, the employer could in principle spend the
 * employee's sealed balance, and after it they demonstrably cannot. A phrase that stayed readable
 * server-side would make "confidential payroll" a promise the employer could quietly break.
 *
 * `findOneAndUpdate` with `claimed: false` in the filter makes the reveal atomic: two concurrent
 * requests cannot both receive the phrase.
 */
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const db = await getDb()

  // Validate BEFORE consuming. Ordering matters more than it looks: the update below is destructive
  // and unrepeatable, so any check that can reject the claim has to run first. Validating afterwards
  // meant a bad stored address destroyed the phrase and returned an error — the employee lost the
  // only copy of their key and got nothing. Caught by running the flow, not by reading it.
  const pre = await db.collection(COLLECTION).findOne({ employee: auth.address, claimed: false })
  if (pre?.mnemonic && !isSealedAddress(pre.sealedTo)) {
    return NextResponse.json(
      {
        error:
          'Your stored payout address failed checksum validation, so it was not released. Your recovery phrase is untouched — ask your employer to re-provision.',
      },
      { status: 500 }
    )
  }

  const res = await db
    .collection(COLLECTION)
    .findOneAndUpdate(
      { employee: auth.address, claimed: false },
      { $set: { claimed: true, claimedAt: new Date().toISOString() }, $unset: { mnemonic: '' } },
      { returnDocument: 'before' }
    )

  const claim = res as { mnemonic?: string; sealedTo?: string } | null
  if (!claim?.mnemonic) {
    // Deliberately not 404 — the distinction between "never existed" and "already opened" matters to
    // someone who is worried their phrase leaked.
    const existing = await db.collection(COLLECTION).findOne({ employee: auth.address })
    return NextResponse.json(
      {
        error: existing
          ? 'This phrase has already been claimed. It was shown once and deleted — it cannot be shown again.'
          : 'No sealed payout address has been provisioned for this wallet.',
        alreadyClaimed: Boolean(existing),
      },
      { status: 409 }
    )
  }

  return NextResponse.json({
    sealedTo: claim.sealedTo,
    mnemonic: claim.mnemonic,
    warning:
      'This is the only time this phrase will be shown. Write it down now — it is already deleted from our database.',
  })
}
