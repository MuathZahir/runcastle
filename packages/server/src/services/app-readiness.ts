/**
 * App readiness — the one wait the project's own setup script cannot perform
 * (decision 5).
 *
 * Service readiness belongs to `drive-setup`: it can `docker compose up --wait`
 * or loop on `pg_isready`, so its exit 0 already means the world is up. The dev
 * SERVER is the exception — it starts after setup exits, in a pane the script
 * never sees — and a dev server that has printed its URL is routinely a further
 * ten seconds from serving anything. "Open app" appearing in that window is a
 * dead link, which is the whole of what this module exists to prevent.
 *
 * So: poll the sniffed URL until something answers. ANY HTTP status counts —
 * 404 and 500 both mean a server accepted the connection and spoke HTTP, which
 * is exactly what the link needs. Only a transport failure (connection refused,
 * the server not yet listening) is "not yet".
 */

/** How long the poll keeps trying before it gives up and warns. Generous: a
 *  cold monorepo dev server can spend a minute-plus on its first compile. */
export const APP_READY_BUDGET_MS = 120_000

/** Gap between attempts. Cheap enough to be tight, tight enough to feel instant. */
export const APP_READY_INTERVAL_MS = 1_000

/** How long ONE attempt may hang before it is abandoned and retried. Without it
 *  a server that accepts the connection and never answers would eat the whole
 *  budget in a single attempt and the deadline would never be checked. */
const APP_READY_ATTEMPT_TIMEOUT_MS = 5_000

/**
 * How a poll ended. `cancelled` is not a failure — it is the drive being
 * stopped out from under it, and the caller reports nothing at all for it.
 */
export type AppReadyOutcome = 'ready' | 'timedOut' | 'cancelled'

/** The poll's timing, as the drive holds it (injected in tests to compress it). */
export interface AppReadyTiming {
  intervalMs: number
  budgetMs: number
}

export interface PollAppReadyOptions extends Partial<AppReadyTiming> {
  /** Aborted when the drive stops — resolves the poll as `cancelled`, no event. */
  signal?: AbortSignal
  /** Injected in tests; production uses the global `fetch`. */
  fetchFn?: typeof fetch
  now?: () => number
}

/**
 * Poll `url` until it responds, the budget runs out, or `signal` aborts.
 *
 * Never throws and never holds the event loop open: a poll outliving whatever
 * started it must not keep the process alive.
 */
export async function pollAppReady(
  url: string,
  opts: PollAppReadyOptions = {},
): Promise<AppReadyOutcome> {
  const intervalMs = opts.intervalMs ?? APP_READY_INTERVAL_MS
  const budgetMs = opts.budgetMs ?? APP_READY_BUDGET_MS
  const fetchFn = opts.fetchFn ?? fetch
  const now = opts.now ?? Date.now
  const { signal } = opts
  const deadline = now() + budgetMs

  while (!signal?.aborted) {
    if (await responds(fetchFn, url, signal)) return 'ready'
    if (now() >= deadline) return 'timedOut'
    await sleep(intervalMs, signal)
  }
  return 'cancelled'
}

/**
 * Did anything HTTP answer? A 404, a 500 and a redirect are all "yes" — the
 * question is whether the port is serving, not whether the app is happy.
 * `redirect: 'manual'` keeps that honest by not chasing a Location we would
 * then be judging instead.
 */
async function responds(fetchFn: typeof fetch, url: string, signal?: AbortSignal): Promise<boolean> {
  const attempt = AbortSignal.timeout(APP_READY_ATTEMPT_TIMEOUT_MS)
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      redirect: 'manual',
      signal: signal ? AbortSignal.any([signal, attempt]) : attempt,
    })
    // We want the status line, not the page. Dropping the body without reading
    // it leaves the connection dangling until GC.
    await res.body?.cancel().catch(() => {})
    return true
  } catch {
    return false
  }
}

/** `setTimeout` that also resolves the moment `signal` aborts, leaving no timer. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const done = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    timer.unref?.()
    signal?.addEventListener('abort', done, { once: true })
  })
}
