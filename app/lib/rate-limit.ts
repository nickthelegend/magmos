/**
 * Per-caller rate limiting for the authenticated API.
 *
 * Every write route here is gated by a wallet signature, and that signature is valid for a five
 * minute window with no nonce (see lib/auth). So one captured signature can be replayed as fast as
 * the network allows. Authentication answers "who", not "how often" — this answers "how often".
 *
 * It matters most on two routes. Drafting a run does live chain reads and may call Groq, so a loop
 * is both a bill and a self-inflicted RPC ban on a chain that already rejects concurrency. And
 * settlement broadcasts transactions; a burst there is real money moving faster than a human can
 * notice something is wrong.
 *
 * In-memory and per-process on purpose. A shared store would be more correct behind several
 * instances, but this is a hackathon deployment on one region, and an in-memory limiter that works
 * beats a Redis dependency that is one more thing to have down during a demo. The tradeoff is
 * written here rather than discovered later.
 */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

/** Stops the map growing without bound in a long-lived process. */
function sweep(now: number) {
  if (buckets.size < 5_000) return
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
}

export interface RateLimitResult {
  ok: boolean
  remaining: number
  /** Seconds until the window resets. Surfaced as Retry-After so a client can behave. */
  retryAfter: number
  limit: number
}

/**
 * Fixed-window counter.
 *
 * Fixed rather than sliding: a sliding window costs per-request bookkeeping to smooth a burst
 * boundary that does not matter here. The worst case is 2× the limit across a window edge, which for
 * these numbers is still far below anything harmful.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  sweep(now)

  const existing = buckets.get(key)
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, remaining: limit - 1, retryAfter: 0, limit }
  }

  existing.count += 1
  const ok = existing.count <= limit
  return {
    ok,
    remaining: Math.max(0, limit - existing.count),
    retryAfter: ok ? 0 : Math.ceil((existing.resetAt - now) / 1000),
    limit,
  }
}

/** Budgets chosen from what each route actually costs, not from a round number. */
export const LIMITS = {
  /** Chain reads + possibly an LLM call. Generous enough to iterate, tight enough to not loop. */
  draft: { limit: 20, windowMs: 60_000 },
  /** Broadcasts transactions. Deliberately the tightest thing here. */
  settle: { limit: 5, windowMs: 60_000 },
  /** Cheap reads. */
  read: { limit: 120, windowMs: 60_000 },
  /** Writes a key that payroll then depends on; no reason to do it in a loop. */
  register: { limit: 10, windowMs: 60_000 },
} as const

/** Standard headers so a client can back off without guessing. */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  return {
    'x-ratelimit-limit': String(r.limit),
    'x-ratelimit-remaining': String(r.remaining),
    ...(r.ok ? {} : { 'retry-after': String(r.retryAfter) }),
  }
}
