/**
 * The payroll control plane.
 *
 * An agent drafts payroll runs from plain English. This module decides what happens to them — and
 * it is deliberately, boringly deterministic. No model output reaches a fund movement without
 * passing through `evaluateRun`, and `evaluateRun` never asks a model anything. That separation is
 * the entire safety argument: an LLM can be talked into believing a $2,000,000 bonus is reasonable;
 * a `>` comparison cannot.
 *
 * Three outcomes, and the difference between the last two matters:
 *
 *   EXECUTE  — inside every control. Settles immediately.
 *   APPROVE  — over a soft control. Held for a second human signature (maker–checker).
 *   REFUSE   — over a hard control. **No signature can release it.** Approving a refused run is not
 *              a permission the UI withholds; it is a state the run can never be in.
 *
 * A refusal is not a stronger warning. It is a different category, and it is what makes leaving an
 * agent unattended defensible: the worst an over-eager or manipulated agent can do is get a run
 * held for a human, and it cannot drain the treasury, redirect funds off the allowlist, or pay a
 * grossly wrong amount at all.
 */

/** Amounts are 6-dp micro-USDC everywhere, matching the payroll contracts. */
export type Micros = bigint

export interface PayrollControls {
  /** Over this, a run needs a second signature. Soft. */
  perRunSoftCapMicros: Micros
  /** Over this, a run is refused outright. Hard — approval cannot release it. */
  perRunHardCapMicros: Micros
  /** Over this, a single recipient's payment needs a second signature. Soft. */
  perPersonSoftCapMicros: Micros
  /** Over this, a single recipient's payment is refused outright. Hard. */
  perPersonHardCapMicros: Micros
  /**
   * Acceptable band around a recipient's expected pay, in basis points. Outside it, refused —
   * this is the "grossly over/under-pay" control, and it catches a decimal-place error in either
   * direction, which a cap alone cannot.
   */
  bandBps: number
  /** Recipients that may be paid at all. Off-list is refused. */
  allowlist: string[]
  /** Whether early/duplicate runs on the same day need a second signature. Soft. */
  requireApprovalForRepeatRun: boolean
}

export const DEFAULT_CONTROLS: PayrollControls = {
  perRunSoftCapMicros: 10_000_000_000n, // 10,000 USDC
  perRunHardCapMicros: 50_000_000_000n, // 50,000 USDC
  perPersonSoftCapMicros: 5_000_000_000n, // 5,000 USDC
  perPersonHardCapMicros: 20_000_000_000n, // 20,000 USDC
  bandBps: 5_000, // ±50% of expected
  allowlist: [],
  requireApprovalForRepeatRun: true,
}

export interface DraftLine {
  /** Recipient's payroll wallet — the allowlist and audit key. */
  employee: string
  name?: string
  /** What this run proposes to pay. */
  amountMicros: Micros
  /** What the roster says they should get. Used for the band check; omit to skip it. */
  expectedMicros?: Micros
}

export interface DraftRun {
  lines: DraftLine[]
  /** True when a run has already settled for this period — a repeat is suspicious, not invalid. */
  alreadyPaidToday?: boolean
  /** Free-text intent from the agent, recorded for audit. Never used in a decision. */
  intent?: string
}

export type Decision = 'execute' | 'approve' | 'refuse'

export interface Violation {
  /** Machine-readable so the UI can style it without regex-sniffing prose. */
  code:
    | 'run_soft_cap'
    | 'run_hard_cap'
    | 'person_soft_cap'
    | 'person_hard_cap'
    | 'band'
    | 'not_allowlisted'
    | 'repeat_run'
    | 'empty_run'
    | 'non_positive'
  severity: 'soft' | 'hard'
  employee?: string
  message: string
  /** The two numbers behind the decision, so the UI never has to recompute them. */
  actualMicros?: Micros
  limitMicros?: Micros
}

export interface PolicyVerdict {
  decision: Decision
  totalMicros: Micros
  violations: Violation[]
  /** One sentence, already user-facing. */
  summary: string
  /**
   * Explicit rather than inferred. Manila re-derives the duplicate-run case by regex-matching
   * `/already|again/i` against the reason string; a flag cannot drift from the reason text.
   */
  isRepeatRun: boolean
}

const usd = (m: Micros) =>
  `${(Number(m) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`

/**
 * Decide a drafted run. Pure: same input, same verdict, no I/O, no model.
 *
 * Hard violations dominate soft ones regardless of order, and every violation is collected rather
 * than short-circuiting — an operator seeing one problem, fixing it, and hitting a second is worse
 * than seeing both at once.
 */
export function evaluateRun(draft: DraftRun, controls: PayrollControls): PolicyVerdict {
  const violations: Violation[] = []
  const allowlist = new Set(controls.allowlist.map((a) => a.toLowerCase()))

  let total = 0n
  for (const line of draft.lines) total += line.amountMicros

  if (draft.lines.length === 0) {
    violations.push({
      code: 'empty_run',
      severity: 'hard',
      message: 'This run has no recipients.',
    })
  }

  for (const line of draft.lines) {
    const who = line.name || line.employee

    if (line.amountMicros <= 0n) {
      violations.push({
        code: 'non_positive',
        severity: 'hard',
        employee: line.employee,
        message: `${who} would be paid a non-positive amount.`,
        actualMicros: line.amountMicros,
      })
      continue
    }

    // Allowlist. Empty means "not yet configured", which must not silently permit everyone —
    // but must also not brick a fresh install, so an empty list is treated as unrestricted and
    // the readiness endpoint reports it as unconfigured.
    if (allowlist.size > 0 && !allowlist.has(line.employee.toLowerCase())) {
      violations.push({
        code: 'not_allowlisted',
        severity: 'hard',
        employee: line.employee,
        message: `${who} is not on the payroll allowlist — refused outright.`,
      })
    }

    if (line.amountMicros > controls.perPersonHardCapMicros) {
      violations.push({
        code: 'person_hard_cap',
        severity: 'hard',
        employee: line.employee,
        message: `${who} would receive ${usd(line.amountMicros)}, over the hard per-person ceiling of ${usd(controls.perPersonHardCapMicros)}.`,
        actualMicros: line.amountMicros,
        limitMicros: controls.perPersonHardCapMicros,
      })
    } else if (line.amountMicros > controls.perPersonSoftCapMicros) {
      violations.push({
        code: 'person_soft_cap',
        severity: 'soft',
        employee: line.employee,
        message: `${who} would receive ${usd(line.amountMicros)}, over the ${usd(controls.perPersonSoftCapMicros)} per-person limit.`,
        actualMicros: line.amountMicros,
        limitMicros: controls.perPersonSoftCapMicros,
      })
    }

    // Band check — catches a misplaced decimal in EITHER direction, which a ceiling alone cannot.
    // A 100x underpayment is as much an error as a 100x overpayment, and only this rule sees it.
    if (line.expectedMicros !== undefined && line.expectedMicros > 0n) {
      const bps = (line.amountMicros * 10_000n) / line.expectedMicros
      const lo = BigInt(Math.max(0, 10_000 - controls.bandBps))
      const hi = BigInt(10_000 + controls.bandBps)
      if (bps < lo || bps > hi) {
        violations.push({
          code: 'band',
          severity: 'hard',
          employee: line.employee,
          message: `${who} would receive ${usd(line.amountMicros)} against an expected ${usd(line.expectedMicros)} — outside the ±${(controls.bandBps / 100).toFixed(0)}% control band, refused.`,
          actualMicros: line.amountMicros,
          limitMicros: line.expectedMicros,
        })
      }
    }
  }

  if (total > controls.perRunHardCapMicros) {
    violations.push({
      code: 'run_hard_cap',
      severity: 'hard',
      message: `This run totals ${usd(total)}, over the hard ceiling of ${usd(controls.perRunHardCapMicros)}. Nothing can release it.`,
      actualMicros: total,
      limitMicros: controls.perRunHardCapMicros,
    })
  } else if (total > controls.perRunSoftCapMicros) {
    violations.push({
      code: 'run_soft_cap',
      severity: 'soft',
      message: `This run totals ${usd(total)}, over the ${usd(controls.perRunSoftCapMicros)} limit.`,
      actualMicros: total,
      limitMicros: controls.perRunSoftCapMicros,
    })
  }

  const isRepeatRun = Boolean(draft.alreadyPaidToday)
  if (isRepeatRun && controls.requireApprovalForRepeatRun) {
    violations.push({
      code: 'repeat_run',
      severity: 'soft',
      message: 'Payroll has already run for this period — a repeat needs a second signature.',
    })
  }

  const hard = violations.filter((v) => v.severity === 'hard')
  const soft = violations.filter((v) => v.severity === 'soft')
  const decision: Decision = hard.length > 0 ? 'refuse' : soft.length > 0 ? 'approve' : 'execute'

  const summary =
    decision === 'refuse'
      ? `Refused: ${hard[0].message}`
      : decision === 'approve'
        ? `Held for a second signature: ${soft[0].message}`
        : `Within every control — ${usd(total)} across ${draft.lines.length} recipient${draft.lines.length === 1 ? '' : 's'}.`

  return { decision, totalMicros: total, violations, summary, isRepeatRun }
}

/**
 * The largest bonus that would still settle without a second signature.
 *
 * Backs the agent's "give everyone the maximum acceptable bonus" instruction. Computed against the
 * controls rather than guessed by the model — the agent asks this function what is allowed instead
 * of proposing a number and hoping. Returns per-recipient micros, 0 when nothing is available.
 */
export function maxAcceptableBonusMicros(
  baseLines: DraftLine[],
  controls: PayrollControls
): Micros {
  if (baseLines.length === 0) return 0n
  const n = BigInt(baseLines.length)
  const base = baseLines.reduce((s, l) => s + l.amountMicros, 0n)

  // Run-level headroom, shared equally.
  const runHeadroom = controls.perRunSoftCapMicros > base ? controls.perRunSoftCapMicros - base : 0n
  let perPerson = runHeadroom / n

  // Then clamp to the tightest per-person constraint any single line would hit.
  for (const l of baseLines) {
    const personHeadroom =
      controls.perPersonSoftCapMicros > l.amountMicros
        ? controls.perPersonSoftCapMicros - l.amountMicros
        : 0n
    if (personHeadroom < perPerson) perPerson = personHeadroom

    // The band is a hard control, so a bonus must not push anyone outside it.
    if (l.expectedMicros !== undefined && l.expectedMicros > 0n) {
      const maxByBand = (l.expectedMicros * BigInt(10_000 + controls.bandBps)) / 10_000n
      const bandHeadroom = maxByBand > l.amountMicros ? maxByBand - l.amountMicros : 0n
      if (bandHeadroom < perPerson) perPerson = bandHeadroom
    }
  }

  return perPerson > 0n ? perPerson : 0n
}

/**
 * Run lifecycle. A rejected run is terminal.
 *
 * This is the mechanism behind "refused outright, and not even approval can release it": the state
 * machine has no edge from `refused` or `rejected` to anything that settles, so the guarantee does
 * not depend on a UI check or on the agent behaving.
 */
export type RunStatus = 'draft' | 'pending_approval' | 'settling' | 'settled' | 'rejected' | 'refused' | 'failed'

const TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  draft: ['pending_approval', 'settling', 'refused'],
  pending_approval: ['settling', 'rejected'],
  settling: ['settled', 'failed'],
  settled: [],
  rejected: [], // terminal — approving a rejected run is not a thing that can happen
  refused: [], // terminal — no signature releases a hard-control breach
  failed: [],
}

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

/** Throws with a precise reason rather than silently no-oping — callers persist this. */
export function assertTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal run transition: ${from} → ${to}`)
  }
}
