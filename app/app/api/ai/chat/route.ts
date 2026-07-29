// POST /api/ai/chat — Magmos AI payroll copilot.
//
// Uses Claude (Anthropic) when ANTHROPIC_API_KEY is set; otherwise falls back to
// a deterministic, context-aware responder that answers common payroll questions
// straight from the live on-chain stats the client passes in — so the assistant
// is useful in a demo even without a key. Metadata/analytics only; never signs.

import { NextResponse, type NextRequest } from 'next/server'

export const runtime = 'nodejs'

type Msg = { role: 'user' | 'assistant'; content: string }
type Ctx = {
  org?: string
  monthly?: number
  balance?: number
  runwayMonths?: number
  recipients?: { name: string; monthly: number; status: string }[]
  streamedToDate?: number
}

const money = (n: number) =>
  `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`

function heuristicReply(prompt: string, ctx: Ctx): string {
  const q = prompt.toLowerCase()
  const recips = ctx.recipients ?? []
  const active = recips.filter((r) => r.status === 'Streaming')
  const paused = recips.filter((r) => r.status === 'Paused')

  if (/runway|last|how long|deplete|run out/.test(q)) {
    if (!ctx.runwayMonths) return `The pool isn't funded yet, so there's no runway to report. Fund payroll from the Overview to start streaming.`
    return `At the current commitment of ${money(ctx.monthly ?? 0)}/month, your pool of ${money(ctx.balance ?? 0)} gives roughly **${ctx.runwayMonths.toFixed(1)} months** of runway. I'd top up before it drops under one month.`
  }
  if (/how much|monthly|commit|spend|cost|payroll total/.test(q)) {
    return `You're committing **${money(ctx.monthly ?? 0)} per month** across ${active.length} active stream${active.length === 1 ? '' : 's'}. Streamed to date: ${money(ctx.streamedToDate ?? 0)}.`
  }
  if (/who|recipient|employee|team|paused|list/.test(q)) {
    if (recips.length === 0) return `No recipients are streaming yet. Add people on the Employees page, then fund payroll.`
    const lines = recips.slice(0, 8).map((r) => `• ${r.name || 'Recipient'} — ${money(r.monthly)}/mo · ${r.status}`).join('\n')
    const pausedNote = paused.length ? `\n\n⚠️ ${paused.length} stream${paused.length === 1 ? ' is' : 's are'} paused — resume them on the Payroll page.` : ''
    return `Here's your roster (${recips.length}):\n\n${lines}${pausedNote}`
  }
  if (/balance|pool|funded|liquid/.test(q)) {
    return `The streaming pool holds **${money(ctx.balance ?? 0)}** right now, committing ${money(ctx.monthly ?? 0)}/month.`
  }
  if (/yield|earn|idle|apy|treasury/.test(q)) {
    return `Idle treasury can earn yield through the Magmos vault (ERC-4626, routing to Circle's USYC in production). Move idle USDC in from the Developer → API keys → Treasury panel, or the Yield page.`
  }
  if (/send home|cctp|bridge|remit/.test(q)) {
    return `Recipients can bridge claimed USDC home with Circle CCTP — burned on Arc, attested by Circle, minted on their home chain. It's on the recipient app's "Send home" flow.`
  }
  if (/hi|hello|hey|help|what can you/.test(q)) {
    return `Hi${ctx.org ? `, ${ctx.org}` : ''} 👋 I'm Magmos AI — your payroll copilot. Ask me things like *"how much am I streaming a month?"*, *"who's paused?"*, or *"what's my runway?"* and I'll answer from your live on-chain data.`
  }
  return `I can answer questions about your Magmos payroll — monthly commitment, runway, recipients, pool balance, coverage, early wage access, yield, and CCTP send-home. Try "what's my runway?", "am I fully covered?" or "who has drawn pay early?"`
}

async function claudeReply(messages: Msg[], ctx: Ctx): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  const system = `You are Magmos AI, a concise payroll copilot for a company running real-time USDC payroll on Circle's Arc chain (streaming salaries per second, claim anytime, CCTP send-home, ERC-4626 treasury yield).

Magmos also offers Earned Wage Access: a worker can draw pay they have ALREADY streamed-and-earned before payday. Be precise about this — it is not a loan and not an advance against future pay. A draw can never exceed accrued pay, it is deducted from the worker's next claim automatically, there is no debt and nothing to repay, and no credit check or employer guarantor is involved because the on-chain accrued balance is the collateral. The 0.5% access fee is normally paid out of yield on the idle payroll float, so the worker pays nothing.

One caveat you must state plainly if asked about risk: a pool's balance is shared across its recipients and coverage is NOT enforced on-chain — claim() reverts if the pool runs dry, first-come-first-served. Early draws do not create that risk but do surface it sooner. If the live context shows a shortfall, say so and recommend a top-up.

Answer from the live context; be specific and brief. Never offer to sign transactions — you are read-only analytics. Live context: ${JSON.stringify(ctx)}`
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const text = data?.content?.[0]?.text
    return typeof text === 'string' ? text : null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  let body: { messages?: Msg[]; context?: Ctx }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const messages = Array.isArray(body.messages) ? body.messages : []
  const ctx = body.context ?? {}
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''

  const viaClaude = await claudeReply(messages, ctx)
  const reply = viaClaude ?? heuristicReply(lastUser, ctx)
  return NextResponse.json({ reply, engine: viaClaude ? 'claude' : 'context' })
}
