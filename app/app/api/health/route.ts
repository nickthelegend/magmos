import { NextResponse } from 'next/server'
import { getDb } from '@/lib/mongo'
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
 * Operational readiness in one call: is the chain reachable, are the contracts actually deployed
 * at the addresses this build was compiled against, and is the metadata store answering.
 *
 * Exists because "the dashboard shows zeros" has three completely different causes (rate-limited
 * RPC, wrong/undeployed address, dead Mongo) and guessing between them wastes the most time
 * exactly when there is least of it — during a demo.
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail: string }> = {}

  // chain
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

  // contracts actually exist at the compiled-in addresses
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

  // metadata store
  try {
    const db = await getDb()
    await db.command({ ping: 1 })
    checks.mongo = { ok: true, detail: 'reachable' }
  } catch (e) {
    checks.mongo = { ok: false, detail: (e as Error).message.slice(0, 120) }
  }

  const ok = Object.values(checks).every((c) => c.ok)
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 })
}
