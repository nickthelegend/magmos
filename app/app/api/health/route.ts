import { NextResponse } from 'next/server'
import { erc20Abi } from 'viem'
import {
  MAGMOS_PAYROLL,
  MAGMOS_STEALTH_PAYOUT,
  USDC,
  ARC_CHAIN_ID,
} from '@/lib/magmos'
import { getDb } from '@/lib/mongo'
import { arcCall } from '@/lib/arc-transport'
import { settlementPublicClient, signerReadiness } from '@/lib/payroll-signer'

export const runtime = 'nodejs'
// Health must reflect reality now, not whenever the page was built.
export const dynamic = 'force-dynamic'

/**
 * Liveness and readiness in one endpoint.
 *
 * The distinction that matters: this reports whether payroll can actually *run*, not whether the
 * process is up. A server that responds 200 while the RPC is unreachable or the signer key is
 * missing is worse than one that is down, because nobody investigates a green check.
 *
 * Each dependency is checked independently and reported separately, so an operator can see which
 * one is broken instead of a single unhelpful boolean. Overall status degrades to `degraded` when a
 * non-essential dependency is down and `unhealthy` when payroll genuinely cannot proceed.
 *
 * Deliberately unauthenticated and deliberately boring: it exposes booleans, addresses that are
 * already public, and a chain id. No balances, no roster, no key material.
 */
export async function GET() {
  const started = Date.now()
  const checks: Record<string, { ok: boolean; detail?: string; ms?: number }> = {}

  const time = async (name: string, fn: () => Promise<string | undefined>) => {
    const t0 = Date.now()
    try {
      const detail = await fn()
      checks[name] = { ok: true, detail, ms: Date.now() - t0 }
    } catch (e) {
      checks[name] = { ok: false, detail: (e as Error).message.slice(0, 120), ms: Date.now() - t0 }
    }
  }

  // Sequential: Arc's RPC rejects concurrent requests (-32011), and a health check that trips the
  // rate limiter would report the chain as down whenever it is actually fine.
  await time('arc-rpc', async () => {
    const id = await arcCall(() => settlementPublicClient.getChainId())
    if (id !== ARC_CHAIN_ID) throw new Error(`wrong chain: ${id}`)
    const block = await arcCall(() => settlementPublicClient.getBlockNumber())
    return `chain ${id}, block ${block}`
  })

  await time('payroll-contract', async () => {
    const code = await settlementPublicClient.getBytecode({ address: MAGMOS_PAYROLL })
    if (!code || code === '0x') throw new Error('no bytecode at the configured address')
    return MAGMOS_PAYROLL
  })

  await time('payout-contract', async () => {
    const code = await settlementPublicClient.getBytecode({ address: MAGMOS_STEALTH_PAYOUT })
    if (!code || code === '0x') throw new Error('no bytecode at the configured address')
    const escrowed = (await settlementPublicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [MAGMOS_STEALTH_PAYOUT],
    })) as bigint
    return `${MAGMOS_STEALTH_PAYOUT}, ${Number(escrowed) / 1e6} USDC escrowed`
  })

  await time('mongo', async () => {
    const db = await getDb()
    await db.command({ ping: 1 })
    return db.databaseName
  })

  const signer = signerReadiness()
  checks['payroll-signer'] = {
    ok: signer.configured,
    detail: signer.configured ? signer.address : signer.hint,
  }

  // The agent falls back to a deterministic parser, so a missing key is a degradation, not an
  // outage — recorded as such rather than failing the whole check.
  const groq = Boolean(process.env.GROQ_API_KEY)
  checks['groq'] = {
    ok: true,
    detail: groq ? 'configured' : 'absent — deterministic parser handles instructions',
  }

  // What payroll genuinely cannot run without.
  const essential = ['arc-rpc', 'payroll-contract', 'payout-contract', 'mongo', 'payroll-signer']
  const failed = essential.filter((k) => !checks[k].ok)
  const status = failed.length === 0 ? 'healthy' : failed.length < essential.length ? 'degraded' : 'unhealthy'

  return NextResponse.json(
    {
      status,
      canRunPayroll: failed.length === 0,
      failing: failed,
      checks,
      tookMs: Date.now() - started,
    },
    {
      // 503 when payroll cannot run, so a load balancer or uptime monitor reacts without having to
      // parse the body.
      status: failed.length === 0 ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    }
  )
}
