import { describe, expect, test } from 'bun:test'
import { LIMITS, rateLimit, rateLimitHeaders } from './rate-limit'

// Unique keys per test — the limiter is process-global by design, so sharing a key across tests
// would make them order-dependent.
let n = 0
const key = () => `test:${++n}:${Math.random()}`

describe('rateLimit', () => {
  test('allows up to the limit, then refuses', () => {
    const k = key()
    for (let i = 0; i < 5; i++) expect(rateLimit(k, 5, 60_000).ok).toBe(true)
    expect(rateLimit(k, 5, 60_000).ok).toBe(false)
  })

  test('reports remaining accurately', () => {
    const k = key()
    expect(rateLimit(k, 3, 60_000).remaining).toBe(2)
    expect(rateLimit(k, 3, 60_000).remaining).toBe(1)
    expect(rateLimit(k, 3, 60_000).remaining).toBe(0)
  })

  test('keys are independent — one caller cannot exhaust another', () => {
    const a = key()
    const b = key()
    for (let i = 0; i < 5; i++) rateLimit(a, 5, 60_000)
    expect(rateLimit(a, 5, 60_000).ok).toBe(false)
    expect(rateLimit(b, 5, 60_000).ok).toBe(true)
  })

  test('the window expires and the caller recovers', () => {
    const k = key()
    // A 1ms window that has already elapsed by the next call.
    expect(rateLimit(k, 1, 1).ok).toBe(true)
    const start = Date.now()
    while (Date.now() - start < 3) {
      /* spin briefly rather than sleep — this is a 3ms wait */
    }
    expect(rateLimit(k, 1, 1).ok).toBe(true)
  })

  test('a refusal reports a positive retryAfter, a success reports zero', () => {
    const k = key()
    expect(rateLimit(k, 1, 60_000).retryAfter).toBe(0)
    expect(rateLimit(k, 1, 60_000).retryAfter).toBeGreaterThan(0)
  })

  test('headers carry retry-after only when refused', () => {
    const k = key()
    expect(rateLimitHeaders(rateLimit(k, 1, 60_000))['retry-after']).toBeUndefined()
    expect(rateLimitHeaders(rateLimit(k, 1, 60_000))['retry-after']).toBeDefined()
  })
})

describe('budgets', () => {
  test('settle is the tightest — it broadcasts real transactions', () => {
    expect(LIMITS.settle.limit).toBeLessThan(LIMITS.draft.limit)
    expect(LIMITS.settle.limit).toBeLessThan(LIMITS.read.limit)
  })

  test('every budget is positive and windowed', () => {
    for (const [name, l] of Object.entries(LIMITS)) {
      expect(l.limit, name).toBeGreaterThan(0)
      expect(l.windowMs, name).toBeGreaterThan(0)
    }
  })
})
