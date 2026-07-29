import { NextResponse } from 'next/server'
import { MAGMOS_PAYROLL, MAGMOS_ADVANCE, ARC_CHAIN_ID } from '@/lib/magmos'

export const runtime = 'nodejs'

const UPSTREAM = process.env.ARC_RPC_UPSTREAM || 'https://rpc.testnet.arc.network'

async function rpc(method: string, params: unknown[] = []) {
  const r = await fetch(UPSTREAM, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
  })
  const j = await r.json()
  if (j.error) throw new Error(j.error.message)
  return j.result
}

/**
 * Readiness for the recipient portal. Parity with the org app's /api/health — the worker-facing
 * surface deserves the same "is this actually wired up" answer, and it has no Mongo dependency.
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail: string }> = {}

  try {
    const [block, chainId] = await Promise.all([rpc('eth_blockNumber'), rpc('eth_chainId')])
    const id = parseInt(chainId as string, 16)
    checks.chain = {
      ok: id === ARC_CHAIN_ID,
      detail:
        id === ARC_CHAIN_ID
          ? `Arc ${id} @ block ${parseInt(block as string, 16)}`
          : `unexpected chainId ${id} (expected ${ARC_CHAIN_ID})`,
    }
  } catch (e) {
    checks.chain = { ok: false, detail: (e as Error).message.slice(0, 120) }
  }

  for (const [name, address] of [
    ['payroll', MAGMOS_PAYROLL],
    ['advance', MAGMOS_ADVANCE],
  ] as const) {
    try {
      const code = (await rpc('eth_getCode', [address, 'latest'])) as string
      const bytes = code && code !== '0x' ? code.length / 2 - 1 : 0
      checks[name] = {
        ok: bytes > 0,
        detail: bytes > 0 ? `${address} · ${bytes} bytes` : `NO CODE at ${address}`,
      }
    } catch (e) {
      checks[name] = { ok: false, detail: (e as Error).message.slice(0, 120) }
    }
  }

  const ok = Object.values(checks).every((c) => c.ok)
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 })
}
