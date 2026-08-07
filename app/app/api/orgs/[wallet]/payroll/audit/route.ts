import { NextResponse, type NextRequest } from 'next/server'
import { isAddress } from 'viem'
import { requireOwner } from '@/lib/auth'
import { auditToCsv, listAudit } from '@/lib/payroll-store'
import { ensureIndexes } from '@/lib/mongo-indexes'
import { LIMITS, rateLimit, rateLimitHeaders } from '@/lib/rate-limit'

export const runtime = 'nodejs'

type Params = { params: Promise<{ wallet: string }> }

/**
 * The employer's audit trail — "open the envelope".
 *
 * This is the other half of the privacy bargain, and it is why confidential payroll is
 * compliance-correct rather than merely opaque: the public sees nothing, the employer keeps a
 * complete, portable record of every run, every policy decision and every settlement reference.
 *
 * `?format=csv` streams it as a download. Owner-authenticated — an audit export that anyone can
 * fetch would leak exactly the payroll data the sealed rail exists to protect.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { wallet } = await params
  if (!isAddress(wallet)) return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })

  const auth = await requireOwner(req, wallet)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const rl = rateLimit(`audit:${auth.address}`, LIMITS.read.limit, LIMITS.read.windowMs)
  if (!rl.ok) {
    return NextResponse.json({ error: 'Slow down.' }, { status: 429, headers: rateLimitHeaders(rl) })
  }
  await ensureIndexes()

  const rows = await listAudit(wallet.toLowerCase(), 500)

  if (req.nextUrl.searchParams.get('format') === 'csv') {
    const stamp = new Date().toISOString().slice(0, 10)
    return new NextResponse(auditToCsv(rows), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="magmos-payroll-audit-${stamp}.csv"`,
        // An audit export must never be served from a shared cache.
        'cache-control': 'no-store',
      },
    })
  }

  return NextResponse.json(
    rows.map((r) => ({
      at: r.at,
      event: r.event,
      actor: r.actor,
      runId: r.runId,
      employee: r.employee,
      amountUsdc: r.amountMicros !== undefined ? Number(r.amountMicros) / 1e6 : undefined,
      detail: r.detail,
      refs: r.refs,
    }))
  )
}
