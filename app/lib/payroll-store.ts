/**
 * Persistence for confidential payroll runs.
 *
 * Real MongoDB, not an in-memory map — a run that vanishes on redeploy is worse than no audit
 * trail at all, because it looks like one.
 *
 * Two properties are enforced here rather than trusted to callers:
 *
 *   1. **The run state machine is enforced at the write.** `advanceRun` refuses an illegal
 *      transition, so "a refused run can never settle" is a database-level fact. Manila leans on a
 *      SQLite CHECK constraint for this; Mongo has no equivalent, so the guard is explicit and
 *      every write goes through it. A route that forgets to check cannot corrupt the state.
 *
 *   2. **The audit log is append-only.** There is deliberately no update or delete. "Open the
 *      envelope" is only worth anything if the envelope cannot be rewritten afterwards.
 */

import { randomUUID } from 'node:crypto'
import { getDb, COLLECTIONS } from './mongo'
import {
  DEFAULT_CONTROLS,
  assertTransition,
  type PayrollControls,
  type PolicyVerdict,
  type RunStatus,
} from './payroll-policy'

/** Amounts persist as decimal strings — BSON has no 64-bit-safe integer for micro-USDC. */
const enc = (v: bigint) => v.toString()
const dec = (v: unknown) => BigInt(String(v ?? '0'))

export interface PayrollRun {
  runId: string
  orgWallet: string
  status: RunStatus
  /** What the operator actually typed. Recorded verbatim for audit. */
  instruction: string
  totalMicros: bigint
  /** The verdict that produced this status. Frozen at draft time. */
  verdict: PolicyVerdict
  createdAt: string
  updatedAt: string
  /** Who added the second signature, when held. */
  approvedBy?: string
  approvedAt?: string
}

export interface PayrollPayment {
  runId: string
  orgWallet: string
  employee: string
  name?: string
  amountMicros: bigint
  /** Sealed payout address. Never the amount — that is the point. */
  sealedTo?: string
  /** On-chain `settleSealed` hash. Public: proves pay was settled, not how much went where. */
  settleTxHash?: string
  /** Provider-side shielded transfer id. */
  sealRef?: string
  /** The shielded transfer's own hash, unreadable on the explorer. */
  sealTxHash?: string
  status: 'queued' | 'settling' | 'sealed' | 'failed'
  error?: string
  createdAt: string
  updatedAt: string
}

export interface AuditEntry {
  orgWallet: string
  /** Machine-readable; the UI styles from this, never from prose. */
  event:
    | 'run.drafted'
    | 'run.executed'
    | 'run.held'
    | 'run.refused'
    | 'run.approved'
    | 'run.rejected'
    | 'payment.settled'
    | 'payment.sealed'
    | 'payment.failed'
    | 'controls.updated'
    | 'recipient.enrolled'
  runId?: string
  employee?: string
  amountMicros?: bigint
  /** Human sentence, already user-facing. */
  detail: string
  /** Settlement references, so a row links straight to the explorer. */
  refs?: Record<string, string>
  /** Who caused it — an authenticated wallet, never a hardcoded "employer" literal. */
  actor: string
  at: string
}

const now = () => new Date().toISOString()

// ─────────────────────────────── controls ───────────────────────────────

export async function getControls(orgWallet: string): Promise<PayrollControls> {
  const db = await getDb()
  const row = await db
    .collection(COLLECTIONS.payrollControls)
    .findOne({ orgWallet: orgWallet.toLowerCase() }, { projection: { _id: 0 } })
  if (!row) return { ...DEFAULT_CONTROLS }
  return {
    perRunSoftCapMicros: dec(row.perRunSoftCapMicros),
    perRunHardCapMicros: dec(row.perRunHardCapMicros),
    perPersonSoftCapMicros: dec(row.perPersonSoftCapMicros),
    perPersonHardCapMicros: dec(row.perPersonHardCapMicros),
    bandBps: Number(row.bandBps ?? DEFAULT_CONTROLS.bandBps),
    allowlist: Array.isArray(row.allowlist) ? row.allowlist : [],
    requireApprovalForRepeatRun: row.requireApprovalForRepeatRun !== false,
  }
}

export async function saveControls(
  orgWallet: string,
  c: PayrollControls,
  actor: string
): Promise<void> {
  const db = await getDb()
  await db.collection(COLLECTIONS.payrollControls).updateOne(
    { orgWallet: orgWallet.toLowerCase() },
    {
      $set: {
        orgWallet: orgWallet.toLowerCase(),
        perRunSoftCapMicros: enc(c.perRunSoftCapMicros),
        perRunHardCapMicros: enc(c.perRunHardCapMicros),
        perPersonSoftCapMicros: enc(c.perPersonSoftCapMicros),
        perPersonHardCapMicros: enc(c.perPersonHardCapMicros),
        bandBps: c.bandBps,
        allowlist: c.allowlist.map((a) => a.toLowerCase()),
        requireApprovalForRepeatRun: c.requireApprovalForRepeatRun,
        updatedAt: now(),
      },
    },
    { upsert: true }
  )
  await appendAudit({
    orgWallet,
    event: 'controls.updated',
    detail: `Controls updated — run limit ${Number(c.perRunSoftCapMicros) / 1e6} USDC, hard ceiling ${Number(c.perRunHardCapMicros) / 1e6} USDC, band ±${c.bandBps / 100}%.`,
    actor,
    at: now(),
  })
}

// ─────────────────────────────── runs ───────────────────────────────

export async function createRun(input: {
  orgWallet: string
  instruction: string
  verdict: PolicyVerdict
  lines: { employee: string; name?: string; amountMicros: bigint }[]
  actor: string
}): Promise<PayrollRun> {
  const db = await getDb()
  const runId = randomUUID()
  const org = input.orgWallet.toLowerCase()

  // The verdict decides the run's opening state — the caller does not get to choose it.
  const status: RunStatus =
    input.verdict.decision === 'refuse'
      ? 'refused'
      : input.verdict.decision === 'approve'
        ? 'pending_approval'
        : 'draft'

  const run: PayrollRun = {
    runId,
    orgWallet: org,
    status,
    instruction: input.instruction,
    totalMicros: input.verdict.totalMicros,
    verdict: input.verdict,
    createdAt: now(),
    updatedAt: now(),
  }

  await db.collection(COLLECTIONS.payrollRuns).insertOne({
    ...run,
    totalMicros: enc(run.totalMicros),
    verdict: { ...input.verdict, totalMicros: enc(input.verdict.totalMicros) },
  })

  if (input.lines.length > 0) {
    await db.collection(COLLECTIONS.payrollPayments).insertMany(
      input.lines.map((l) => ({
        runId,
        orgWallet: org,
        employee: l.employee.toLowerCase(),
        name: l.name,
        amountMicros: enc(l.amountMicros),
        status: 'queued' as const,
        createdAt: now(),
        updatedAt: now(),
      }))
    )
  }

  await appendAudit({
    orgWallet: org,
    event:
      status === 'refused' ? 'run.refused' : status === 'pending_approval' ? 'run.held' : 'run.drafted',
    runId,
    amountMicros: input.verdict.totalMicros,
    detail: input.verdict.summary,
    actor: input.actor,
    at: now(),
  })

  return run
}

export async function getRun(orgWallet: string, runId: string): Promise<PayrollRun | null> {
  const db = await getDb()
  const r = await db
    .collection(COLLECTIONS.payrollRuns)
    .findOne({ orgWallet: orgWallet.toLowerCase(), runId }, { projection: { _id: 0 } })
  if (!r) return null
  return {
    ...(r as unknown as PayrollRun),
    totalMicros: dec(r.totalMicros),
    verdict: { ...(r.verdict as PolicyVerdict), totalMicros: dec(r.verdict?.totalMicros) },
  }
}

/**
 * Move a run to a new state, refusing anything the state machine forbids.
 *
 * The `status` filter makes this a compare-and-swap: two concurrent approvals of the same held run
 * cannot both succeed, because the second one's filter no longer matches. Without it, a double
 * click could settle a run twice.
 */
export async function advanceRun(
  orgWallet: string,
  runId: string,
  to: RunStatus,
  extra: Record<string, unknown> = {}
): Promise<PayrollRun> {
  const current = await getRun(orgWallet, runId)
  if (!current) throw new Error(`run not found: ${runId}`)
  assertTransition(current.status, to)

  const db = await getDb()
  const res = await db.collection(COLLECTIONS.payrollRuns).updateOne(
    { orgWallet: orgWallet.toLowerCase(), runId, status: current.status },
    { $set: { status: to, updatedAt: now(), ...extra } }
  )
  if (res.matchedCount === 0) {
    throw new Error(`run ${runId} changed underneath this update — refusing to overwrite`)
  }
  return { ...current, status: to, updatedAt: now(), ...extra }
}

export async function listRuns(orgWallet: string, limit = 50): Promise<PayrollRun[]> {
  const db = await getDb()
  const rows = await db
    .collection(COLLECTIONS.payrollRuns)
    .find({ orgWallet: orgWallet.toLowerCase() }, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray()
  return rows.map((r) => ({
    ...(r as unknown as PayrollRun),
    totalMicros: dec(r.totalMicros),
  }))
}

/** Has a run already settled for this org today? Drives the repeat-run control. */
export async function hasSettledToday(orgWallet: string): Promise<boolean> {
  const db = await getDb()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const n = await db.collection(COLLECTIONS.payrollRuns).countDocuments({
    orgWallet: orgWallet.toLowerCase(),
    status: 'settled',
    updatedAt: { $gte: since },
  })
  return n > 0
}

// ─────────────────────────────── payments ───────────────────────────────

export async function listPayments(orgWallet: string, runId?: string): Promise<PayrollPayment[]> {
  const db = await getDb()
  const q: Record<string, unknown> = { orgWallet: orgWallet.toLowerCase() }
  if (runId) q.runId = runId
  const rows = await db
    .collection(COLLECTIONS.payrollPayments)
    .find(q, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(500)
    .toArray()
  return rows.map((r) => ({
    ...(r as unknown as PayrollPayment),
    amountMicros: dec(r.amountMicros),
  }))
}

export async function updatePayment(
  orgWallet: string,
  runId: string,
  employee: string,
  patch: Partial<Omit<PayrollPayment, 'amountMicros'>> & { amountMicros?: bigint }
): Promise<void> {
  const db = await getDb()
  const set: Record<string, unknown> = { ...patch, updatedAt: now() }
  if (patch.amountMicros !== undefined) set.amountMicros = enc(patch.amountMicros)
  await db
    .collection(COLLECTIONS.payrollPayments)
    .updateOne(
      { orgWallet: orgWallet.toLowerCase(), runId, employee: employee.toLowerCase() },
      { $set: set }
    )
}

// ─────────────────────────────── audit ───────────────────────────────

/** Append-only by construction: there is no update or delete counterpart, deliberately. */
export async function appendAudit(entry: AuditEntry): Promise<void> {
  const db = await getDb()
  await db.collection(COLLECTIONS.auditLog).insertOne({
    ...entry,
    orgWallet: entry.orgWallet.toLowerCase(),
    amountMicros: entry.amountMicros !== undefined ? enc(entry.amountMicros) : undefined,
  })
}

export async function listAudit(orgWallet: string, limit = 200): Promise<AuditEntry[]> {
  const db = await getDb()
  const rows = await db
    .collection(COLLECTIONS.auditLog)
    .find({ orgWallet: orgWallet.toLowerCase() }, { projection: { _id: 0 } })
    .sort({ at: -1 })
    .limit(limit)
    .toArray()
  return rows.map((r) => ({
    ...(r as unknown as AuditEntry),
    amountMicros: r.amountMicros !== undefined ? dec(r.amountMicros) : undefined,
  }))
}

/**
 * The employer's export — the other half of the privacy bargain.
 *
 * Public confidentiality is only defensible if the employer retains a complete, portable record.
 * Fields are RFC-4180 quoted so an amount or a name containing a comma cannot shift columns and
 * silently corrupt a compliance export.
 */
export function auditToCsv(rows: AuditEntry[]): string {
  const head = ['timestamp', 'event', 'actor', 'run_id', 'employee', 'amount_usdc', 'detail', 'refs']
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = rows.map((r) =>
    [
      q(r.at),
      q(r.event),
      q(r.actor),
      q(r.runId ?? ''),
      q(r.employee ?? ''),
      q(r.amountMicros !== undefined ? (Number(r.amountMicros) / 1e6).toFixed(6) : ''),
      q(r.detail),
      q(r.refs ? Object.entries(r.refs).map(([k, v]) => `${k}=${v}`).join(' ') : ''),
    ].join(',')
  )
  return [head.join(','), ...lines].join('\n')
}
