import { NextResponse, type NextRequest } from 'next/server'
import { isAddress } from 'viem'
import { requireOwner } from '@/lib/auth'
import { DEFAULT_CONTROLS, type PayrollControls } from '@/lib/payroll-policy'
import { getControls, saveControls } from '@/lib/payroll-store'

export const runtime = 'nodejs'

type Params = { params: Promise<{ wallet: string }> }

const toUsdc = (m: bigint) => Number(m) / 1e6
const toMicros = (usdc: number) => BigInt(Math.round(usdc * 1e6))

/** The org's spending controls. These are what the gate enforces — not the agent's judgement. */
export async function GET(req: NextRequest, { params }: Params) {
  const { wallet } = await params
  if (!isAddress(wallet)) return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })

  const auth = await requireOwner(req, wallet)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const c = await getControls(wallet.toLowerCase())
  return NextResponse.json({
    perRunSoftCapUsdc: toUsdc(c.perRunSoftCapMicros),
    perRunHardCapUsdc: toUsdc(c.perRunHardCapMicros),
    perPersonSoftCapUsdc: toUsdc(c.perPersonSoftCapMicros),
    perPersonHardCapUsdc: toUsdc(c.perPersonHardCapMicros),
    bandBps: c.bandBps,
    allowlist: c.allowlist,
    requireApprovalForRepeatRun: c.requireApprovalForRepeatRun,
  })
}

/**
 * Update the controls. Owner-authenticated, and the change is audited with the wallet that made it.
 *
 * Validation here is not a formality. A hard cap below its soft cap, or a negative band, would
 * produce a gate that silently never fires — a control that looks configured and enforces nothing is
 * more dangerous than no control at all, so those are rejected rather than normalised.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const { wallet } = await params
  if (!isAddress(wallet)) return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })

  const auth = await requireOwner(req, wallet)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const current = await getControls(wallet.toLowerCase())
  const num = (k: string, fallback: number) => {
    const v = body[k]
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback
  }

  const next: PayrollControls = {
    perRunSoftCapMicros: toMicros(num('perRunSoftCapUsdc', toUsdc(current.perRunSoftCapMicros))),
    perRunHardCapMicros: toMicros(num('perRunHardCapUsdc', toUsdc(current.perRunHardCapMicros))),
    perPersonSoftCapMicros: toMicros(
      num('perPersonSoftCapUsdc', toUsdc(current.perPersonSoftCapMicros))
    ),
    perPersonHardCapMicros: toMicros(
      num('perPersonHardCapUsdc', toUsdc(current.perPersonHardCapMicros))
    ),
    bandBps: Math.round(num('bandBps', current.bandBps)),
    allowlist: Array.isArray(body.allowlist)
      ? (body.allowlist as unknown[]).filter((a): a is string => typeof a === 'string' && isAddress(a))
      : current.allowlist,
    requireApprovalForRepeatRun:
      typeof body.requireApprovalForRepeatRun === 'boolean'
        ? body.requireApprovalForRepeatRun
        : current.requireApprovalForRepeatRun,
  }

  const problems: string[] = []
  if (next.perRunSoftCapMicros <= 0n || next.perRunHardCapMicros <= 0n)
    problems.push('Caps must be positive.')
  if (next.perRunHardCapMicros < next.perRunSoftCapMicros)
    problems.push('The per-run hard ceiling cannot be below the soft cap — approval could never release a run.')
  if (next.perPersonHardCapMicros < next.perPersonSoftCapMicros)
    problems.push('The per-person hard ceiling cannot be below its soft cap.')
  if (next.bandBps < 0 || next.bandBps > 10_000)
    problems.push('bandBps must be between 0 and 10000 (±100%).')
  if (problems.length) return NextResponse.json({ error: problems.join(' ') }, { status: 400 })

  await saveControls(wallet.toLowerCase(), next, auth.address!)
  return NextResponse.json({ ok: true, bandBps: next.bandBps })
}

/** Restore the shipped defaults — an explicit action, never an implicit fallback. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { wallet } = await params
  if (!isAddress(wallet)) return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })

  const auth = await requireOwner(req, wallet)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  await saveControls(wallet.toLowerCase(), DEFAULT_CONTROLS, auth.address!)
  return NextResponse.json({ ok: true, reset: true })
}
