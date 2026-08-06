import { NextResponse, type NextRequest } from 'next/server'
import { isAddress, type Address } from 'viem'
import { requireOwner } from '@/lib/auth'
import { getDb, COLLECTIONS } from '@/lib/mongo'
import { poolIdFor, USDC } from '@/lib/magmos'
import { getEmployeeSnapshots, getEmployees } from '@/lib/reads'
import { runAgent, type RosterEntry } from '@/lib/payroll-agent'
import {
  createRun,
  getControls,
  hasSettledToday,
  listPayments,
  listRuns,
} from '@/lib/payroll-store'

export const runtime = 'nodejs'

type Params = { params: Promise<{ wallet: string }> }

/**
 * Draft a payroll run from a plain-English instruction.
 *
 * Owner-authenticated. Manila ships every equivalent route unauthenticated with a hardcoded
 * "employer" string as the audit actor; here the actor is the EIP-191-verified wallet, so the audit
 * trail records who actually did something rather than that somebody did.
 *
 * This endpoint only ever DRAFTS. It never moves funds — the verdict decides whether the run is
 * executable, held for a second signature, or refused, and settlement is a separate authenticated
 * call. That split is what stops a single compromised request from paying anyone.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { wallet } = await params
  if (!isAddress(wallet)) return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })

  const auth = await requireOwner(req, wallet)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  let body: { instruction?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const instruction = String(body.instruction ?? '').trim()
  if (!instruction) return NextResponse.json({ error: 'instruction is required' }, { status: 400 })

  const org = wallet.toLowerCase()
  const poolId = poolIdFor(wallet as Address, USDC)

  try {
    // Roster = Mongo metadata (names, expected pay) joined with LIVE on-chain accrual. The agent
    // never invents an amount; it can only ever propose what a stream has actually earned.
    const db = await getDb()
    const meta = await db
      .collection(COLLECTIONS.employees)
      .find({ orgWallet: org }, { projection: { _id: 0 } })
      .toArray()
    const byAddr = new Map(meta.map((m) => [String(m.walletAddress).toLowerCase(), m]))

    const onChain = await getEmployees(poolId)
    const snapshots = onChain.length ? await getEmployeeSnapshots(poolId, onChain) : []

    const roster: RosterEntry[] = snapshots.map((s) => {
      const m = byAddr.get(s.addr.toLowerCase())
      const monthly = Number(m?.monthlyUsdc ?? 0)
      return {
        employee: s.addr,
        name: String(m?.name ?? s.addr),
        // Expected pay for a daily run — the band control measures against this.
        expectedMicros: BigInt(Math.round((monthly / 30) * 1e6)),
        accruedMicros: s.claimable,
      }
    })

    const [controls, paidToday] = await Promise.all([getControls(org), hasSettledToday(org)])

    // Who has already been paid in the last day, so "pay everyone else" resolves against reality.
    const recent = await listPayments(org)
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const alreadyPaid = recent
      .filter((p) => p.status === 'sealed' && p.updatedAt >= cutoff)
      .map((p) => p.employee)

    const result = await runAgent({
      instruction,
      roster,
      controls,
      alreadyPaidToday: paidToday,
      alreadyPaid,
    })

    // Only a run_payroll intent creates a persisted run; the rest are read-only answers.
    let runId: string | undefined
    if (result.action.kind === 'run_payroll' && result.draft && result.verdict) {
      const run = await createRun({
        orgWallet: org,
        instruction,
        verdict: result.verdict,
        lines: result.draft.lines.map((l) => ({
          employee: l.employee,
          name: l.name,
          amountMicros: l.amountMicros,
        })),
        actor: auth.address!,
      })
      runId = run.runId
    }

    return NextResponse.json({
      runId,
      via: result.via,
      action: result.action,
      reply: result.reply,
      verdict: result.verdict
        ? {
            ...result.verdict,
            totalMicros: result.verdict.totalMicros.toString(),
            violations: result.verdict.violations.map((v) => ({
              ...v,
              actualMicros: v.actualMicros?.toString(),
              limitMicros: v.limitMicros?.toString(),
            })),
          }
        : undefined,
      lines: result.draft?.lines.map((l) => ({
        employee: l.employee,
        name: l.name,
        amountUsdc: Number(l.amountMicros) / 1e6,
      })),
      rosterSize: roster.length,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 200) }, { status: 502 })
  }
}

/** Recent runs for this org. Public read of the org's own history is owner-gated too. */
export async function GET(req: NextRequest, { params }: Params) {
  const { wallet } = await params
  if (!isAddress(wallet)) return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })

  const auth = await requireOwner(req, wallet)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const runs = await listRuns(wallet.toLowerCase())
  return NextResponse.json(
    runs.map((r) => ({
      runId: r.runId,
      status: r.status,
      instruction: r.instruction,
      totalUsdc: Number(r.totalMicros) / 1e6,
      decision: r.verdict?.decision,
      summary: r.verdict?.summary,
      createdAt: r.createdAt,
    }))
  )
}
