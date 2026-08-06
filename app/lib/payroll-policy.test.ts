import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_CONTROLS,
  assertTransition,
  canTransition,
  evaluateRun,
  maxAcceptableBonusMicros,
  type DraftLine,
  type PayrollControls,
} from './payroll-policy'

const usdc = (n: number) => BigInt(Math.round(n * 1e6))
const ALICE = '0x1111111111111111111111111111111111111111'
const BOB = '0x2222222222222222222222222222222222222222'
const MALLORY = '0x3333333333333333333333333333333333333333'

const controls = (over: Partial<PayrollControls> = {}): PayrollControls => ({
  ...DEFAULT_CONTROLS,
  allowlist: [ALICE, BOB],
  ...over,
})

const line = (employee: string, amount: number, expected?: number): DraftLine => ({
  employee,
  amountMicros: usdc(amount),
  ...(expected !== undefined ? { expectedMicros: usdc(expected) } : {}),
})

describe('the happy path settles without a human', () => {
  test('a normal run executes', () => {
    const v = evaluateRun({ lines: [line(ALICE, 3000, 3000), line(BOB, 2400, 2400)] }, controls())
    expect(v.decision).toBe('execute')
    expect(v.totalMicros).toBe(usdc(5400))
    expect(v.violations).toHaveLength(0)
  })
})

describe('soft controls hold for a second signature', () => {
  test('over the per-run limit → approve, not refuse', () => {
    const v = evaluateRun({ lines: [line(ALICE, 4000, 4000), line(BOB, 4000, 4000)] },
      controls({ perRunSoftCapMicros: usdc(5000) }))
    expect(v.decision).toBe('approve')
    expect(v.violations.map((x) => x.code)).toContain('run_soft_cap')
  })

  test('over the per-person limit → approve', () => {
    const v = evaluateRun({ lines: [line(ALICE, 6000, 6000)] },
      controls({ perPersonSoftCapMicros: usdc(5000), bandBps: 10_000 }))
    expect(v.decision).toBe('approve')
  })

  test('a repeat run on the same day is held, not refused', () => {
    const v = evaluateRun({ lines: [line(ALICE, 100, 100)], alreadyPaidToday: true }, controls())
    expect(v.decision).toBe('approve')
    expect(v.isRepeatRun).toBe(true)
  })

  test('the repeat flag is explicit, not inferred from prose', () => {
    // Manila regex-sniffs /already|again/i out of the reason string; a flag cannot drift from text.
    const v = evaluateRun({ lines: [line(ALICE, 100, 100)] }, controls())
    expect(v.isRepeatRun).toBe(false)
  })
})

describe('hard controls refuse outright — no signature releases them', () => {
  test('over the hard run ceiling → refuse', () => {
    const v = evaluateRun({ lines: [line(ALICE, 60_000, 60_000)] }, controls({ bandBps: 10_000 }))
    expect(v.decision).toBe('refuse')
    expect(v.violations.some((x) => x.code === 'run_hard_cap' && x.severity === 'hard')).toBe(true)
  })

  test('an off-allowlist recipient is refused, however small the amount', () => {
    const v = evaluateRun({ lines: [line(MALLORY, 1, 1)] }, controls())
    expect(v.decision).toBe('refuse')
    expect(v.violations[0].code).toBe('not_allowlisted')
  })

  test('a hard breach dominates soft ones regardless of order', () => {
    const v = evaluateRun(
      { lines: [line(ALICE, 6000, 6000), line(MALLORY, 1, 1)], alreadyPaidToday: true },
      controls({ perPersonSoftCapMicros: usdc(5000), bandBps: 10_000 })
    )
    expect(v.decision).toBe('refuse')
    // and it still reports everything, so an operator fixes both at once
    expect(v.violations.length).toBeGreaterThan(1)
  })

  test('an empty run cannot settle', () => {
    expect(evaluateRun({ lines: [] }, controls()).decision).toBe('refuse')
  })

  test('a non-positive amount is refused', () => {
    const v = evaluateRun({ lines: [{ employee: ALICE, amountMicros: 0n }] }, controls())
    expect(v.decision).toBe('refuse')
    expect(v.violations[0].code).toBe('non_positive')
  })
})

describe('the band catches decimal errors in BOTH directions', () => {
  test('a 100x overpayment is refused', () => {
    const v = evaluateRun({ lines: [line(ALICE, 300_000, 3000)] }, controls())
    expect(v.decision).toBe('refuse')
    expect(v.violations.some((x) => x.code === 'band')).toBe(true)
  })

  test('a 100x UNDERpayment is refused too — a ceiling alone would miss this', () => {
    const v = evaluateRun({ lines: [line(ALICE, 30, 3000)] }, controls())
    expect(v.decision).toBe('refuse')
    expect(v.violations.some((x) => x.code === 'band')).toBe(true)
  })

  test('inside the band is fine', () => {
    const v = evaluateRun({ lines: [line(ALICE, 3300, 3000)] }, controls())
    expect(v.decision).toBe('execute')
  })
})

describe('an empty allowlist does not silently permit everyone... or brick a fresh install', () => {
  test('unconfigured allowlist permits, and readiness reports it separately', () => {
    const v = evaluateRun({ lines: [line(MALLORY, 100, 100)] }, controls({ allowlist: [] }))
    expect(v.decision).toBe('execute')
  })

  test('allowlist matching is case-insensitive', () => {
    const v = evaluateRun({ lines: [line(ALICE.toUpperCase(), 100, 100)] }, controls())
    expect(v.decision).toBe('execute')
  })
})

describe('maximally acceptable bonus is computed, never guessed', () => {
  test('it lands exactly at the run limit and still executes', () => {
    const base = [line(ALICE, 3000, 3000), line(BOB, 3000, 3000)]
    const c = controls({ perRunSoftCapMicros: usdc(8000), bandBps: 10_000 })
    const bonus = maxAcceptableBonusMicros(base, c)
    expect(bonus).toBe(usdc(1000))

    const withBonus = base.map((l) => ({ ...l, amountMicros: l.amountMicros + bonus }))
    expect(evaluateRun({ lines: withBonus }, c).decision).toBe('execute')
  })

  test('one unit more would need a signature — the bound is tight, not conservative', () => {
    const base = [line(ALICE, 3000, 3000), line(BOB, 3000, 3000)]
    const c = controls({ perRunSoftCapMicros: usdc(8000), bandBps: 10_000 })
    const bonus = maxAcceptableBonusMicros(base, c)
    const over = base.map((l) => ({ ...l, amountMicros: l.amountMicros + bonus + 1n }))
    expect(evaluateRun({ lines: over }, c).decision).toBe('approve')
  })

  test('it respects the band, not just the caps', () => {
    // Huge run headroom, but the band only allows +50% on a 3000 expectation.
    const base = [line(ALICE, 3000, 3000)]
    const c = controls({ perRunSoftCapMicros: usdc(1_000_000), perPersonSoftCapMicros: usdc(1_000_000), bandBps: 5_000 })
    expect(maxAcceptableBonusMicros(base, c)).toBe(usdc(1500))
  })

  test('no headroom yields zero rather than a negative', () => {
    const base = [line(ALICE, 9000, 9000)]
    const c = controls({ perRunSoftCapMicros: usdc(5000) })
    expect(maxAcceptableBonusMicros(base, c)).toBe(0n)
  })

  test('an empty roster yields zero', () => {
    expect(maxAcceptableBonusMicros([], controls())).toBe(0n)
  })
})

describe('a rejected or refused run is terminal', () => {
  test('rejected cannot reach settling — approval is not a permission the UI withholds', () => {
    expect(canTransition('rejected', 'settling')).toBe(false)
    expect(canTransition('rejected', 'pending_approval')).toBe(false)
    expect(() => assertTransition('rejected', 'settling')).toThrow(/illegal run transition/)
  })

  test('refused is likewise terminal', () => {
    expect(canTransition('refused', 'settling')).toBe(false)
    expect(canTransition('refused', 'pending_approval')).toBe(false)
  })

  test('a settled run cannot be re-settled', () => {
    expect(canTransition('settled', 'settling')).toBe(false)
  })

  test('the legitimate path still works', () => {
    expect(canTransition('draft', 'pending_approval')).toBe(true)
    expect(canTransition('pending_approval', 'settling')).toBe(true)
    expect(canTransition('settling', 'settled')).toBe(true)
  })
})

describe('determinism', () => {
  test('the same draft always yields the same verdict', () => {
    const draft = { lines: [line(ALICE, 3000, 3000), line(BOB, 12_000, 2400)] }
    const a = evaluateRun(draft, controls())
    const b = evaluateRun(draft, controls())
    expect(a.decision).toBe(b.decision)
    expect(a.summary).toBe(b.summary)
    expect(a.violations).toEqual(b.violations)
  })
})
