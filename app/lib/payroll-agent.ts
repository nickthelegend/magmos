/**
 * The payroll agent — plain English in, a drafted run out.
 *
 * Deliberate architecture: **the model is an intent router, never an authority.** It chooses which
 * tool to call and with what arguments; every number it proposes is then recomputed from the live
 * roster and put through `evaluateRun`, which never asks a model anything. So the worst a
 * manipulated or hallucinating model can do is draft a run that the policy gate refuses.
 *
 * There are two layers, and the order matters:
 *
 *   1. `parseInstruction` — a real deterministic parser. This is the primary path. It handles every
 *      supported command with no network call, so a demo cannot fail because an inference provider
 *      is slow, rate-limited, or down mid-sentence.
 *   2. Groq (`llama-3.3-70b-versatile`, OpenAI-compatible tool calling) — used when GROQ_API_KEY is
 *      present and only to *classify* an instruction the parser could not confidently read. If it
 *      errors or returns nonsense, the parser's answer stands.
 *
 * That ordering is why the agent never echoes model garbage: the model can only ever narrow an
 * already-safe set of actions.
 */

import {
  evaluateRun,
  maxAcceptableBonusMicros,
  type DraftLine,
  type PayrollControls,
  type PolicyVerdict,
} from './payroll-policy'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

/** A recipient as the agent sees them — roster truth, not model output. */
export interface RosterEntry {
  employee: string
  name: string
  /** What the roster says they earn per run. The band control measures against this. */
  expectedMicros: bigint
  /** Live accrued-and-unsealed pay, read from the chain. Caps what a run can settle. */
  accruedMicros: bigint
}

export type AgentAction =
  | { kind: 'run_payroll'; who: 'all' | string[]; bonusMicros?: bigint; maxBonus?: boolean }
  | { kind: 'release_equity'; who: 'all' | string[] }
  | { kind: 'show_controls' }
  | { kind: 'show_audit' }
  | { kind: 'unknown'; reason: string }

export interface AgentResult {
  action: AgentAction
  /** How the action was determined — surfaced in the UI so the operator is never guessing. */
  via: 'parser' | 'groq'
  draft?: { lines: DraftLine[]; alreadyPaidToday: boolean }
  verdict?: PolicyVerdict
  /** What the agent says back. Always generated from the verdict, never free-form model prose. */
  reply: string
}

const usd = (m: bigint) => `${(Number(m) / 1e6).toFixed(2)} USDC`

// ─────────────────────────────── deterministic parser ───────────────────────────────

/** Match roster members named anywhere in the instruction. First name is enough. */
function namedIn(text: string, roster: RosterEntry[]): string[] {
  const t = text.toLowerCase()
  const hits: string[] = []
  for (const r of roster) {
    const full = r.name.toLowerCase()
    const first = full.split(/[\s—-]+/)[0]
    if (!first) continue
    // Word-boundary match so "amara" doesn't match inside another word.
    if (new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t)) {
      hits.push(r.employee)
    } else if (t.includes(r.employee.toLowerCase())) {
      hits.push(r.employee)
    }
  }
  return [...new Set(hits)]
}

/** Parse a money amount: "500", "$500", "500 usdc", "500.50". */
function amountIn(text: string): bigint | undefined {
  const m = text.match(/\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:usdc|usd|dollars?)?/i)
  if (!m) return undefined
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n * 1e6)) : undefined
}

/**
 * Read an instruction with no network call.
 *
 * Returns `unknown` rather than guessing when it genuinely cannot tell — that is what hands the
 * decision to the model layer, instead of quietly drafting the wrong run.
 */
export function parseInstruction(input: string, roster: RosterEntry[]): AgentAction {
  const t = input.trim().toLowerCase()
  if (!t) return { kind: 'unknown', reason: 'empty instruction' }

  if (/\b(control|policy|cap|limit)s?\b/.test(t) && /\b(show|what|list|view)\b/.test(t)) {
    return { kind: 'show_controls' }
  }
  if (/\b(audit|history|log|envelope)\b/.test(t)) return { kind: 'show_audit' }

  if (/\b(equity|rsu|vest(ed|ing)?|shares?)\b/.test(t)) {
    const who = namedIn(t, roster)
    return { kind: 'release_equity', who: who.length ? who : 'all' }
  }

  const isPayroll = /\b(run|pay|payroll|salar|disburse|settle|send)\b/.test(t)
  if (!isPayroll) return { kind: 'unknown', reason: 'not recognised as a payroll instruction' }

  // "maximum/maximally acceptable bonus" — the amount is computed from controls, never parsed.
  const maxBonus = /\b(max|maximum|maximal(ly)?|largest|biggest|as much as)\b/.test(t) && /\bbonus\b/.test(t)

  let bonusMicros: bigint | undefined
  if (!maxBonus && /\bbonus\b/.test(t)) {
    // Only read an amount that actually sits near the word "bonus".
    const near = t.match(/bonus[^0-9$]{0,20}(\$?\s*[0-9][0-9,]*(?:\.[0-9]+)?)/) ??
      t.match(/(\$?\s*[0-9][0-9,]*(?:\.[0-9]+)?)[^0-9]{0,20}bonus/)
    if (near) bonusMicros = amountIn(near[1])
  }

  const named = namedIn(t, roster)
  // "everyone else" means the complement of whoever has already been paid — resolved by the caller
  // against run history, so the phrase is recognised here but not silently expanded to "all".
  const everyoneElse = /\b(everyone|everybody|the rest|remaining|others?)\s*(else)?\b/.test(t)

  const who: 'all' | string[] =
    named.length > 0 && !everyoneElse ? named : 'all'

  return { kind: 'run_payroll', who, bonusMicros, maxBonus }
}

// ─────────────────────────────── Groq intent routing ───────────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'run_payroll',
      description:
        "Draft today's payroll run. Use when the user wants to pay salaries, optionally to a named subset and optionally with a bonus.",
      parameters: {
        type: 'object',
        properties: {
          who: {
            type: 'string',
            description:
              'Either the literal string "all", or a comma-separated list of recipient NAMES exactly as they appear in the roster.',
          },
          bonus_usdc: {
            type: 'number',
            description: 'Flat bonus per recipient in USDC. Omit if no explicit bonus was asked for.',
          },
          max_bonus: {
            type: 'boolean',
            description:
              'True when the user asked for the largest/maximum acceptable bonus rather than naming a figure. The system computes the actual amount from the control limits.',
          },
        },
        required: ['who'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'release_equity',
      description: 'Release vested RSU equity, which settles in USDC at the live oracle price.',
      parameters: {
        type: 'object',
        properties: { who: { type: 'string', description: '"all" or comma-separated roster names.' } },
        required: ['who'],
      },
    },
  },
  { type: 'function', function: { name: 'show_controls', description: 'Show the current payroll control limits.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'show_audit', description: 'Show the audit trail of past runs.', parameters: { type: 'object', properties: {} } } },
]

export function groqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY)
}

/**
 * Ask Groq to classify an instruction the parser could not read.
 *
 * Returns `null` on any failure — no throw, no retry storm. The caller already holds a
 * deterministic answer; the model is strictly an improvement attempt.
 */
async function classifyWithGroq(input: string, roster: RosterEntry[]): Promise<AgentAction | null> {
  const key = process.env.GROQ_API_KEY
  if (!key) return null

  const names = roster.map((r) => r.name).join(', ') || '(roster is empty)'
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0,
        tool_choice: 'auto',
        tools: TOOLS,
        messages: [
          {
            role: 'system',
            content:
              'You route payroll instructions to exactly one tool. You never decide amounts or ' +
              'whether a payment is allowed — a deterministic policy engine does that afterwards. ' +
              `The roster is: ${names}. Only use names from that roster. If the instruction is not ` +
              'about payroll, equity, controls or audit, call no tool.',
          },
          { role: 'user', content: input },
        ],
      }),
    })
    if (!res.ok) return null
    const json = await res.json()
    const call = json?.choices?.[0]?.message?.tool_calls?.[0]
    if (!call) return null

    const args = JSON.parse(call.function?.arguments || '{}')
    const resolveWho = (raw: unknown): 'all' | string[] => {
      const s = String(raw ?? 'all').trim()
      if (!s || s.toLowerCase() === 'all') return 'all'
      const wanted = s.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
      // Map model-supplied names back onto real roster addresses. Anything unmatched is dropped —
      // a hallucinated recipient must never reach a draft.
      const ids = roster
        .filter((r) => wanted.some((w) => r.name.toLowerCase().includes(w) || w.includes(r.name.toLowerCase().split(/[\s—-]+/)[0])))
        .map((r) => r.employee)
      return ids.length ? ids : 'all'
    }

    switch (call.function?.name) {
      case 'run_payroll':
        return {
          kind: 'run_payroll',
          who: resolveWho(args.who),
          bonusMicros:
            typeof args.bonus_usdc === 'number' && args.bonus_usdc > 0
              ? BigInt(Math.round(args.bonus_usdc * 1e6))
              : undefined,
          maxBonus: Boolean(args.max_bonus),
        }
      case 'release_equity':
        return { kind: 'release_equity', who: resolveWho(args.who) }
      case 'show_controls':
        return { kind: 'show_controls' }
      case 'show_audit':
        return { kind: 'show_audit' }
      default:
        return null
    }
  } catch {
    return null
  }
}

// ─────────────────────────────── the agent ───────────────────────────────

/**
 * Turn an instruction into a drafted, policy-evaluated run.
 *
 * Amounts are always derived here from the roster and live accrual — never from the instruction and
 * never from the model. A bonus is the only figure a user supplies, and it is still bounded by the
 * controls afterwards.
 */
export async function runAgent(input: {
  instruction: string
  roster: RosterEntry[]
  controls: PayrollControls
  alreadyPaidToday: boolean
  /** Recipients already paid in this period, for "pay everyone else". */
  alreadyPaid?: string[]
}): Promise<AgentResult> {
  const { instruction, roster, controls, alreadyPaidToday } = input

  let action = parseInstruction(instruction, roster)
  let via: 'parser' | 'groq' = 'parser'

  if (action.kind === 'unknown' && groqConfigured()) {
    const routed = await classifyWithGroq(instruction, roster)
    if (routed) {
      action = routed
      via = 'groq'
    }
  }

  if (action.kind === 'unknown') {
    return {
      action,
      via,
      reply:
        "I couldn't read that as a payroll instruction. Try “run today's payroll”, “pay just Maya”, " +
        '“run payroll with the maximum acceptable bonus”, or “release vested equity”.',
    }
  }

  if (action.kind === 'show_controls') {
    return {
      action,
      via,
      reply: `Run limit ${usd(controls.perRunSoftCapMicros)} (hard ceiling ${usd(controls.perRunHardCapMicros)}), per person ${usd(controls.perPersonSoftCapMicros)} (hard ${usd(controls.perPersonHardCapMicros)}), band ±${controls.bandBps / 100}%, ${controls.allowlist.length || 'no'} allowlisted recipient${controls.allowlist.length === 1 ? '' : 's'}.`,
    }
  }

  if (action.kind === 'show_audit') {
    return { action, via, reply: 'Opening the audit trail.' }
  }

  if (action.kind === 'release_equity') {
    const who = action.who === 'all' ? roster.map((r) => r.name) : action.who
    return {
      action,
      via,
      reply: `Ready to release vested equity for ${action.who === 'all' ? 'everyone' : who.join(', ')}. Vested shares are priced from the live oracle and settle in USDC.`,
    }
  }

  // ---- run_payroll: build the draft from roster + live accrual ----
  const paid = new Set((input.alreadyPaid ?? []).map((a) => a.toLowerCase()))
  let targets =
    action.who === 'all'
      ? roster
      : roster.filter((r) => (action.who as string[]).includes(r.employee))

  // "pay everyone else" — the parser flags the phrase; the complement is resolved here, against
  // real run history rather than by assuming.
  if (action.who === 'all' && paid.size > 0 && /\b(else|the rest|remaining|others?)\b/i.test(instruction)) {
    targets = roster.filter((r) => !paid.has(r.employee.toLowerCase()))
  }

  if (targets.length === 0) {
    return { action, via, reply: 'Nobody on the roster matches that — nothing to run.' }
  }

  // A run settles what has actually accrued. If the chain says a stream has earned less than the
  // roster expects, the accrued figure wins — a run can never settle pay that was not earned.
  const baseLines: DraftLine[] = targets.map((r) => ({
    employee: r.employee,
    name: r.name,
    amountMicros: r.accruedMicros < r.expectedMicros ? r.accruedMicros : r.expectedMicros,
    expectedMicros: r.expectedMicros,
  }))

  let bonus = 0n
  if (action.maxBonus) bonus = maxAcceptableBonusMicros(baseLines, controls)
  else if (action.bonusMicros) bonus = action.bonusMicros

  const lines: DraftLine[] = baseLines.map((l) => ({
    ...l,
    amountMicros: l.amountMicros + bonus,
  }))

  const verdict = evaluateRun({ lines, alreadyPaidToday, intent: instruction }, controls)

  const bonusNote =
    bonus > 0n
      ? action.maxBonus
        ? ` Largest bonus the controls allow is ${usd(bonus)} each — applied.`
        : ` Bonus of ${usd(bonus)} each applied.`
      : ''

  return {
    action,
    via,
    draft: { lines, alreadyPaidToday },
    verdict,
    reply: `${verdict.summary}${bonusNote}`,
  }
}
