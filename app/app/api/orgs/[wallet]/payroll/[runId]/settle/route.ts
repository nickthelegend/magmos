import { NextResponse, type NextRequest } from 'next/server'
import { isAddress, keccak256, toHex, type Address } from 'viem'
import { requireOwner } from '@/lib/auth'
import { poolIdFor, USDC } from '@/lib/magmos'
import { sealProvider } from '@/lib/seal'
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

  const provider = sealProvider()
  const deliveryLive = provider.live

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

  // ---- leg 2: confidential delivery, per recipient ----------------------------------------
  //
  // Sequential because Arc's RPC rejects concurrent requests outright (-32011). A failure here does
  // NOT undo the settlement: the pay is in the org treasury and the line is marked failed so it can
  // be redelivered, which is recoverable. Silently reporting it as delivered would not be.
  for (const line of lines) {
    const employee = line.employee as Address
    try {
      await updatePayment(org, runId, employee, { status: 'settling' })

      let deliveryRef: string | undefined
      let deliveryTxHash: string | undefined
      if (deliveryLive) {
        if (!line.sealedTo) throw new Error('Recipient has no sealed payout address enrolled')
        const d = await provider.seal(line.sealedTo, line.amountMicros)
        deliveryRef = d.ref
        deliveryTxHash = d.txHash
      }

      await updatePayment(org, runId, employee, {
        status: 'sealed',
        sealRef: runSealRef,
        settleTxHash: settleTxHash as `0x${string}`,
        sealTxHash: deliveryTxHash as `0x${string}` | undefined,
      })
      await appendAudit({
        orgWallet: org,
        at: new Date().toISOString(),
        event: 'payment.sealed',
        actor,
        runId,
        employee,
        amountMicros: line.amountMicros,
        detail: deliveryLive
          ? 'Delivered confidentially from the sealed treasury.'
          : 'Settled on Arc. Confidential delivery not run — Unlink credentials absent.',
        refs: {
          settleTxHash,
          sealRef: runSealRef,
          ...(deliveryRef ? { deliveryRef } : {}),
          ...(deliveryTxHash ? { sealTxHash: deliveryTxHash } : {}),
        },
      })

      settled.push({
        employee,
        name: line.name,
        amountUsdc: Number(line.amountMicros) / 1e6,
        txHash: settleTxHash,
        sealRef: runSealRef,
        delivered: deliveryLive,
      })
    } catch (e) {
      const message = (e as Error).message.slice(0, 200)
      await updatePayment(org, runId, employee, { status: 'failed', error: message })
      await appendAudit({
        orgWallet: org,
        at: new Date().toISOString(),
        event: 'payment.failed',
        actor,
        runId,
        employee,
        amountMicros: line.amountMicros,
        detail: message,
      })
      failed.push({ employee, name: line.name, error: message })
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
    confidentialDelivery: deliveryLive
      ? { ran: true, provider: provider.kind }
      : {
          ran: false,
          reason:
            'Unlink credentials are not configured. Pay was settled on-chain and the commitment recorded; the shielded transfer was not performed.',
        },
  })
}
