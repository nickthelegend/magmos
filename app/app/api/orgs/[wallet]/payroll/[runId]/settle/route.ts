import { NextResponse, type NextRequest } from 'next/server'
import { isAddress, keccak256, toHex, type Address } from 'viem'
import { requireOwner } from '@/lib/auth'
import { getDb, COLLECTIONS } from '@/lib/mongo'
import { poolIdFor, USDC } from '@/lib/magmos'
import { deliverBatch, isValidMeta } from '@/lib/payroll-delivery'
import {
  settleAllSealedOnChain,
  signerAccount,
  signerCanSettle,
} from '@/lib/payroll-signer'
import {
  advanceRun,
  appendAudit,
  getRun,
  listAudit,
  listPayments,
  updatePayment,
} from '@/lib/payroll-store'

export const runtime = 'nodejs'
// Settlement broadcasts one transaction per recipient and waits for each receipt.
export const maxDuration = 300

type Params = { params: Promise<{ wallet: string; runId: string }> }

/**
 * Execute a drafted run: settle each line on-chain, then deliver confidentially.
 *
 * The two legs are deliberately separate and reported separately:
 *
 *   1. `settleSealed` on Arc — always real. It moves the accrued pay out of the stream and into the
 *      org treasury, emitting `PaySealed` with a commitment hash instead of a recipient. The
 *      contract enforces that this can never exceed what the stream actually earned.
 *   2. The shielded delivery — only attempted when Unlink credentials are present. If they are not,
 *      this route settles, records the commitment, and says the delivery leg did not run. It does
 *      NOT invent a transfer id. A mock receipt written into an audit trail is worse than a gap,
 *      because the gap is visible and the mock is not.
 *
 * Status transitions go through `advanceRun`, which is a compare-and-swap on the current status, so
 * two concurrent settle requests cannot both take a run out of `pending_approval`.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { wallet, runId } = await params
  if (!isAddress(wallet)) return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })

  const auth = await requireOwner(req, wallet)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const org = wallet.toLowerCase()
  const actor = auth.address!

  const run = await getRun(org, runId)
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  // The policy engine already decided. This route enforces that decision; it never re-derives it,
  // so there is exactly one place in the codebase that can authorise a payment.
  if (run.verdict?.decision === 'refuse') {
    return NextResponse.json(
      { error: 'This run was refused by policy and cannot be settled.', verdict: run.verdict },
      { status: 409 }
    )
  }
  if (run.status === 'pending_approval') {
    // Maker-checker. The drafter is read back from the append-only audit log rather than a mutable
    // field on the run, so the check cannot be defeated by rewriting the run document.
    const drafted = (await listAudit(org, 500)).find(
      (a) => a.runId === runId && a.event === 'run.drafted'
    )
    if (drafted && drafted.actor.toLowerCase() === actor.toLowerCase()) {
      return NextResponse.json(
        { error: 'This run needs a second approver — the drafter cannot also approve it.' },
        { status: 409 }
      )
    }
  }
  if (run.status !== 'draft' && run.status !== 'pending_approval') {
    return NextResponse.json(
      { error: `Run is ${run.status} and cannot be settled.` },
      { status: 409 }
    )
  }

  const poolId = poolIdFor(wallet as Address, USDC)

  const canSettle = await signerCanSettle(poolId)
  if (!canSettle.ok) {
    return NextResponse.json(
      { error: 'Settlement signer is not ready', detail: canSettle.reason },
      { status: 503 }
    )
  }

  // Claim the run before touching the chain. `advanceRun` compare-and-swaps on the status it read,
  // so if two requests race, the loser throws here rather than both settling the same payroll.
  try {
    await advanceRun(org, runId, 'settling', {
      approvedBy: run.status === 'pending_approval' ? actor : undefined,
      approvedAt: run.status === 'pending_approval' ? new Date().toISOString() : undefined,
    })
  } catch (e) {
    return NextResponse.json(
      { error: 'Run was already taken by another request.', detail: (e as Error).message },
      { status: 409 }
    )
  }

  await appendAudit({
    orgWallet: org,
    at: new Date().toISOString(),
    event: 'run.settling',
    actor,
    runId,
    detail: `Settling via delegated signer ${signerAccount()?.address}`,
  })

  const lines = (await listPayments(org, runId)).filter((l) => l.status !== 'sealed')
  const settled: unknown[] = []
  const failed: unknown[] = []

  // ---- leg 1: ONE confidential settlement for the whole run -------------------------------
  //
  // Deliberately not a loop. Settling per employee would put each recipient and each salary into
  // calldata, which is public — that was measured on a real transaction, not assumed. `settleAllSealed`
  // takes only (poolId, sealRef), so there is nothing to attribute. The run-level sealRef commits to
  // the run without naming it: the employer can reproduce it from their own records, nobody else can
  // invert it.
  const runSealRef = keccak256(toHex(`magmos:run:${org}:${runId}`))

  let settleTxHash: string
  let settledTotalMicros: bigint
  let settledCount: number
  try {
    const r = await settleAllSealedOnChain(poolId, runSealRef)
    settleTxHash = r.txHash
    settledTotalMicros = r.totalMicros
    settledCount = r.count
  } catch (e) {
    // Nothing was delivered, so put the run back where it can be retried rather than stranding it
    // in `settling` forever.
    const message = (e as Error).message.slice(0, 200)
    await advanceRun(org, runId, 'failed')
    await appendAudit({
      orgWallet: org,
      at: new Date().toISOString(),
      event: 'run.failed',
      actor,
      runId,
      detail: `On-chain settlement failed, nothing delivered: ${message}`,
    })
    return NextResponse.json({ error: 'Settlement failed on-chain', detail: message }, { status: 502 })
  }

  await appendAudit({
    orgWallet: org,
    at: new Date().toISOString(),
    event: 'run.settled',
    actor,
    runId,
    amountMicros: settledTotalMicros,
    detail: `Settled ${settledCount} stream(s) in one confidential transaction — no recipient or per-person amount is on-chain.`,
    refs: { settleTxHash, sealRef: runSealRef },
  })

  // ---- leg 2: ONE confidential delivery batch --------------------------------------------
  //
  // Stealth addresses (ERC-5564): each line gets a one-time address only that employee can derive.
  // Committed as a Merkle root and funded in a single transaction, so there is no per-recipient
  // transfer to correlate and no cohort bound together by a shared block.
  //
  // Employees without a registered meta-address are held back rather than paid in the clear. Falling
  // back to a plain transfer would silently undo the privacy for exactly the people who had not set
  // themselves up — the worst possible default.
  const db = await getDb()
  const deliverable = []
  for (const line of lines) {
    const emp = await db
      .collection(COLLECTIONS.employees)
      .findOne({ orgWallet: org, walletAddress: { $regex: `^${line.employee}$`, $options: 'i' } })
    if (isValidMeta(emp?.stealthMeta)) {
      deliverable.push({
        employee: line.employee,
        name: line.name,
        amountMicros: line.amountMicros,
        meta: emp!.stealthMeta,
      })
    } else {
      const message = 'No private payout key registered — ask them to visit /claim and set one up.'
      await updatePayment(org, runId, line.employee as Address, { status: 'failed', error: message })
      await appendAudit({
        orgWallet: org,
        at: new Date().toISOString(),
        event: 'payment.failed',
        actor,
        runId,
        employee: line.employee,
        amountMicros: line.amountMicros,
        detail: message,
      })
      failed.push({ employee: line.employee, name: line.name, error: message })
    }
  }

  let delivery = null
  if (deliverable.length) {
    try {
      delivery = await deliverBatch(org, runId, deliverable)
      for (const d of delivery.lines) {
        await updatePayment(org, runId, d.employee as Address, {
          status: 'sealed',
          sealRef: runSealRef,
          settleTxHash: settleTxHash as `0x${string}`,
          sealTxHash: delivery.fundTxHash,
          stealthAddress: d.stealthAddress,
          claimProof: d.proof,
          batchId: delivery.batchId,
          ephemeralPubKey: d.ephemeralPubKey,
          viewTag: d.viewTag,
        })
        await appendAudit({
          orgWallet: org,
          at: new Date().toISOString(),
          event: 'payment.sealed',
          actor,
          runId,
          employee: d.employee,
          amountMicros: d.amountMicros,
          detail: 'Delivered to a one-time stealth address. Nothing on-chain links it to them.',
          refs: { settleTxHash, fundTxHash: delivery.fundTxHash, batchId: delivery.batchId },
        })
        settled.push({
          employee: d.employee,
          name: d.name,
          amountUsdc: Number(d.amountMicros) / 1e6,
          txHash: delivery.fundTxHash,
          sealRef: runSealRef,
          delivered: true,
        })
      }
    } catch (e) {
      // Settlement already happened, so the pay is safe in the treasury. Mark the lines for
      // redelivery rather than pretending the run failed entirely.
      const message = (e as Error).message.slice(0, 200)
      for (const d of deliverable) {
        await updatePayment(org, runId, d.employee as Address, { status: 'failed', error: message })
        failed.push({ employee: d.employee, name: d.name, error: message })
      }
      await appendAudit({
        orgWallet: org,
        at: new Date().toISOString(),
        event: 'payment.failed',
        actor,
        runId,
        detail: `Settled on-chain but delivery failed, funds are in the treasury: ${message}`,
      })
    }
  }

  // The money already moved on-chain, so the run is `settled` even if a delivery failed — marking it
  // `failed` would invite a retry that double-settles. Failed lines are listed for redelivery.
  const finalStatus = 'settled'
  await advanceRun(org, runId, finalStatus)
  if (failed.length) {
    await appendAudit({
      orgWallet: org,
      at: new Date().toISOString(),
      event: 'run.failed',
      actor,
      runId,
      detail: `Settled on-chain, but ${failed.length} delivery/deliveries failed and need redelivery.`,
    })
  }

  return NextResponse.json({
    runId,
    status: finalStatus,
    settleTxHash,
    settledTotalUsdc: Number(settledTotalMicros) / 1e6,
    settledStreamCount: settledCount,
    settled,
    failed,
    // Stated on every response so a caller can never mistake a settled-only run for a delivered one.
    confidentialDelivery: delivery
      ? {
          ran: true,
          method: 'stealth-addresses',
          batchId: delivery.batchId,
          fundTxHash: delivery.fundTxHash,
          recipients: delivery.lines.length,
        }
      : {
          ran: false,
          reason:
            'No recipient had a private payout key registered, so nothing was delivered. Pay is settled and waiting in the treasury.',
        },
  })
}
