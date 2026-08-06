import { describe, expect, test } from 'bun:test'
import { parseInstruction, runAgent, type RosterEntry } from './payroll-agent'
import { DEFAULT_CONTROLS } from './payroll-policy'

const usdc = (n: number) => BigInt(Math.round(n * 1e6))
const A = '0xaaaa000000000000000000000000000000000001'
const B = '0xbbbb000000000000000000000000000000000002'
const roster: RosterEntry[] = [
  { employee: A, name: 'Maya Santos — Manila', expectedMicros: usdc(2400), accruedMicros: usdc(2400) },
  { employee: B, name: 'Amara Diallo — Lagos', expectedMicros: usdc(3200), accruedMicros: usdc(3200) },
]
const controls = { ...DEFAULT_CONTROLS, allowlist: [A, B] }

describe('deterministic parser needs no model', () => {
  test('run today', () => expect(parseInstruction("run today's payroll", roster).kind).toBe('run_payroll'))
  test('named subset by first name', () => {
    const a = parseInstruction('pay just Maya', roster)
    expect(a).toMatchObject({ kind: 'run_payroll', who: [A] })
  })
  test('equity', () => expect(parseInstruction('release vested equity', roster).kind).toBe('release_equity'))
  test('max bonus flagged, amount NOT parsed from text', () => {
    const a = parseInstruction('run payroll with the maximum acceptable bonus', roster)
    expect(a).toMatchObject({ kind: 'run_payroll', maxBonus: true })
    expect((a as any).bonusMicros).toBeUndefined()
  })
  test('explicit bonus read only near the word bonus', () => {
    const a = parseInstruction('run payroll with a 500 usdc bonus', roster)
    expect((a as any).bonusMicros).toBe(usdc(500))
  })
  test('gibberish is unknown, not a guessed run', () =>
    expect(parseInstruction('what is the weather', roster).kind).toBe('unknown'))
})

describe('amounts come from chain accrual, never the instruction', () => {
  test('accrual below expectation caps the line', async () => {
    const short = [{ ...roster[0], accruedMicros: usdc(100) }]
    const r = await runAgent({ instruction: "run today's payroll", roster: short, controls, alreadyPaidToday: false })
    expect(r.draft!.lines[0].amountMicros).toBe(usdc(100))
  })
  test('max bonus lands inside the controls', async () => {
    const r = await runAgent({ instruction: 'run payroll with the maximum acceptable bonus', roster, controls, alreadyPaidToday: false })
    expect(r.verdict!.decision).toBe('execute')
  })
  test('a repeat run is held, not settled', async () => {
    const r = await runAgent({ instruction: "run today's payroll", roster, controls, alreadyPaidToday: true })
    expect(r.verdict!.decision).toBe('approve')
  })
})
