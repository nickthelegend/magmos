/**
 * Database indexes, applied once per process.
 *
 * Every query below was doing a full collection scan. That is invisible on a seeded demo roster and
 * becomes the whole latency budget on a real one — the audit trail in particular is append-only and
 * only grows, so the page that reads it gets slower forever.
 *
 * Two of these are not about speed. The unique index on `payrollPayments` is a correctness
 * guarantee: it makes it structurally impossible to persist two payment rows for the same recipient
 * in the same run, which is the shape a double-payment bug would take. And the partial unique index
 * on `payrollRuns` is what stops a retried request creating a second run for the same batch id.
 *
 * `createIndex` is idempotent, so calling this on every cold start is safe and self-healing — a
 * dropped index reappears rather than silently degrading.
 */

import { COLLECTIONS, getDb } from './mongo'

let applied: Promise<void> | null = null

async function apply(): Promise<void> {
  const db = await getDb()

  await Promise.all([
    // Roster lookups: by org (dashboard) and by wallet (employee claiming).
    db.collection(COLLECTIONS.employees).createIndex({ orgWallet: 1 }),
    db.collection(COLLECTIONS.employees).createIndex({ walletAddress: 1 }),

    // Runs are listed newest-first for one org.
    db.collection(COLLECTIONS.payrollRuns).createIndex({ orgWallet: 1, createdAt: -1 }),
    db.collection(COLLECTIONS.payrollRuns).createIndex({ orgWallet: 1, runId: 1 }, { unique: true }),

    // One row per (run, employee). Unique because a duplicate here is what a double-payment looks
    // like in the database, and the constraint is cheaper than the reconciliation.
    db
      .collection(COLLECTIONS.payrollPayments)
      .createIndex({ orgWallet: 1, runId: 1, employee: 1 }, { unique: true }),
    // The employee's own view: what has been delivered to me and not yet claimed.
    db.collection(COLLECTIONS.payrollPayments).createIndex({ employee: 1, status: 1, updatedAt: -1 }),

    // Append-only and unbounded, so this is the index that matters most over time.
    db.collection(COLLECTIONS.auditLog).createIndex({ orgWallet: 1, at: -1 }),
    db.collection(COLLECTIONS.auditLog).createIndex({ orgWallet: 1, runId: 1 }),

    db.collection(COLLECTIONS.payrollControls).createIndex({ orgWallet: 1 }, { unique: true }),
  ])
}

/**
 * Ensure indexes exist. Safe to await on any request path — the work happens once and every later
 * caller awaits the same promise.
 *
 * A failure is logged and swallowed on purpose: a payroll request must not 500 because an index
 * could not be built. Slow is recoverable; refusing to pay people is not.
 */
export function ensureIndexes(): Promise<void> {
  if (!applied) {
    applied = apply().catch((e) => {
      console.error('[mongo] index creation failed, continuing without:', (e as Error).message)
    })
  }
  return applied
}
