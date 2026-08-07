/**
 * A transport that respects Arc's concurrency limit instead of fighting it.
 *
 * Arc's RPC rejects parallel requests outright — `-32011 request limit reached`, or
 * "Request exceeds defined limit". Measured: one call succeeds where twelve concurrent calls all
 * fail in about 250ms. Individually every caller here is already sequential, but the server has
 * several of them: a settlement in flight, the dashboard polling batches every 30 seconds, the audit
 * list every 15, a health check. Sequential-per-caller is not sequential-per-process, and the
 * collision only shows up under exactly the conditions that matter — someone actually using the app
 * while payroll runs.
 *
 * This serialises every Arc call in the process behind one queue and retries the rate-limit error
 * with backoff. It makes reads marginally slower and makes payroll not fail, which is the right
 * trade: a delivery that fails here leaves salary sitting in the treasury and a run marked for
 * redelivery.
 */

let chain: Promise<unknown> = Promise.resolve()

/** Run `fn` after every previously queued call has settled. */
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  // Swallow rejection on the chain itself, so one failed call cannot poison the queue for the next.
  chain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

const isRateLimit = (e: unknown) => {
  const m = (e as Error)?.message ?? ''
  return /request limit|exceeds defined limit|-32011|429|too many requests/i.test(m)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Wrap any Arc call so it is queued and retried.
 *
 * Used at the call site rather than inside the transport because viem's transport hooks cannot
 * defer a request — they observe it. Queueing has to happen above them.
 */
export async function arcCall<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  return serialize(async () => {
    let lastError: unknown
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn()
      } catch (e) {
        lastError = e
        if (!isRateLimit(e)) throw e
        // 250ms, 500ms, 1s, 2s — Arc's limiter is short-window, so this clears quickly.
        await sleep(250 * 2 ** i)
      }
    }
    throw lastError
  })
}
