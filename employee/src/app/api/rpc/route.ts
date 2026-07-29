import { NextResponse, type NextRequest } from 'next/server'

export const runtime = 'nodejs'

// Server-side JSON-RPC proxy for Arc.
//
// Why this exists: Arc's public RPC rate-limits per IP and rejects concurrent requests outright
// (HTTP 429, `-32011 request limit reached`). Every browser tab polling the dashboard was競 for
// that budget from the visitor's own IP, so reads degraded the moment two people opened the app.
// Routing reads through the server gives us three things a browser cannot do for itself:
//
//   1. a short-TTL response cache shared by every visitor,
//   2. in-flight coalescing, so N identical concurrent reads become ONE upstream call,
//   3. retry with backoff on 429 instead of surfacing a hole in the UI.
//
// Writes are not proxied: transactions are signed and broadcast by the user's wallet.

const UPSTREAM = process.env.ARC_RPC_UPSTREAM || 'https://rpc.testnet.arc.network'

// Read-only methods only. `eth_sendRawTransaction` is allowed so a wallet that has no direct RPC
// can still broadcast, but nothing here can move funds on its own.
const ALLOWED = new Set([
  'eth_call',
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_getCode',
  'eth_getLogs',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getTransactionCount',
  'eth_getBlockByNumber',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'net_version',
  'web3_clientVersion',
  'eth_sendRawTransaction',
])

// Per-method cache lifetime (ms). 0 = never cached.
const TTL: Record<string, number> = {
  eth_call: 2_000,
  eth_chainId: 3_600_000,
  net_version: 3_600_000,
  eth_blockNumber: 1_500,
  eth_getBalance: 4_000,
  eth_getCode: 600_000,
  eth_getLogs: 10_000,
  eth_getTransactionReceipt: 5_000,
  eth_getTransactionByHash: 5_000,
  eth_getBlockByNumber: 2_000,
  eth_gasPrice: 5_000,
  eth_maxPriorityFeePerGas: 5_000,
  eth_feeHistory: 5_000,
}

type Entry = { at: number; value: unknown }
const cache = new Map<string, Entry>()
const inflight = new Map<string, Promise<unknown>>()

// Survive HMR in dev so the cache isn't wiped on every edit.
const g = globalThis as unknown as { __magmosRpc?: { cache: typeof cache; inflight: typeof inflight } }
if (!g.__magmosRpc) g.__magmosRpc = { cache, inflight }
const CACHE = g.__magmosRpc.cache
const INFLIGHT = g.__magmosRpc.inflight

const keyOf = (method: string, params: unknown) => `${method}:${JSON.stringify(params ?? [])}`

function sweep() {
  if (CACHE.size < 500) return
  const now = Date.now()
  for (const [k, v] of CACHE) {
    const ttl = TTL[k.slice(0, k.indexOf(':'))] ?? 0
    if (now - v.at > ttl) CACHE.delete(k)
  }
}

async function upstream(method: string, params: unknown): Promise<unknown> {
  let lastErr: unknown
  // Arc answers a single call reliably but rejects bursts; back off rather than give up.
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 120 * 2 ** attempt))
    try {
      const res = await fetch(UPSTREAM, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }),
        cache: 'no-store',
      })
      if (res.status === 429) {
        lastErr = { code: -32011, message: 'request limit reached' }
        continue
      }
      const json = await res.json()
      if (json.error) {
        // A revert or bad-params error is deterministic — retrying cannot help.
        return { __error: json.error }
      }
      return json.result
    } catch (e) {
      lastErr = { code: -32603, message: (e as Error).message }
    }
  }
  return { __error: lastErr ?? { code: -32603, message: 'upstream unavailable' } }
}

async function handleOne(call: { id?: unknown; method?: string; params?: unknown }) {
  const id = call?.id ?? null
  const method = call?.method
  if (typeof method !== 'string' || !ALLOWED.has(method)) {
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not allowed: ${method}` } }
  }

  const ttl = TTL[method] ?? 0
  const key = keyOf(method, call.params)

  if (ttl > 0) {
    const hit = CACHE.get(key)
    if (hit && Date.now() - hit.at < ttl) {
      const v = hit.value as { __error?: unknown }
      return v && typeof v === 'object' && '__error' in v
        ? { jsonrpc: '2.0', id, error: v.__error }
        : { jsonrpc: '2.0', id, result: hit.value }
    }
    // Coalesce: a second identical request rides the first one's response.
    const pending = INFLIGHT.get(key)
    if (pending) {
      const v = (await pending) as { __error?: unknown }
      return v && typeof v === 'object' && '__error' in v
        ? { jsonrpc: '2.0', id, error: v.__error }
        : { jsonrpc: '2.0', id, result: v }
    }
  }

  const p = upstream(method, call.params).finally(() => INFLIGHT.delete(key))
  if (ttl > 0) INFLIGHT.set(key, p)
  const value = (await p) as { __error?: unknown }
  if (ttl > 0 && !(value && typeof value === 'object' && '__error' in value)) {
    CACHE.set(key, { at: Date.now(), value })
    sweep()
  }
  return value && typeof value === 'object' && '__error' in value
    ? { jsonrpc: '2.0', id, error: value.__error }
    : { jsonrpc: '2.0', id, result: value }
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } },
      { status: 400 }
    )
  }

  // viem may send a JSON-RPC batch; answer in kind, concurrently (all served from one cache).
  if (Array.isArray(body)) {
    if (body.length > 64) {
      return NextResponse.json(
        { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'batch too large' } },
        { status: 413 }
      )
    }
    const out = await Promise.all(body.map((c) => handleOne(c)))
    return NextResponse.json(out)
  }

  return NextResponse.json(await handleOne(body as Record<string, unknown>))
}

// Lightweight health probe: confirms the proxy can reach Arc and reports cache pressure.
export async function GET() {
  const started = Date.now()
  const r = await handleOne({ id: 1, method: 'eth_blockNumber', params: [] })
  const ok = 'result' in r
  return NextResponse.json(
    {
      ok,
      upstreamMs: Date.now() - started,
      blockNumber: ok ? (r as { result: string }).result : null,
      error: ok ? null : (r as { error: unknown }).error,
      cacheEntries: CACHE.size,
      inflight: INFLIGHT.size,
    },
    { status: ok ? 200 : 503 }
  )
}
