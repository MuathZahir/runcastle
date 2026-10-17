/**
 * Standalone hook client (SPEC §5.5). Runs INSIDE a Claude Code session, invoked
 * by the settings.json hooks as `bun run "<abs path>" <route-event>`.
 *
 * It reads the hook JSON from stdin, POSTs `{ event, sessionId, payload }` to
 * `RUNCASTLE_SERVER_URL/api/hooks/<event>`, and prints the server's response body
 * VERBATIM to stdout (the server returns the final hook JSON that Claude Code
 * consumes as context). Zero dependencies (plain `fetch`), 3s timeout. On ANY
 * error it prints `{}` and exits 0 — a hook must never break the user's session.
 *
 * One argument is not a route event: `wait-messages`, the background message
 * waiter of the orchestrator and of a feature's lead (see {@link waitMessages}).
 */

const FETCH_TIMEOUT_MS = 3000
const STDIN_TIMEOUT_MS = 2500

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  return await new Promise<string>((resolvePromise) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      resolvePromise(Buffer.concat(chunks).toString('utf8'))
    }
    const stdin = process.stdin
    stdin.on('data', (c: Buffer | string) => {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
    })
    stdin.on('end', finish)
    stdin.on('error', finish)
    // Safety net: never hang if stdin is a TTY that never closes.
    const t = setTimeout(finish, STDIN_TIMEOUT_MS)
    if (typeof t.unref === 'function') t.unref()
  })
}

/** The hook-client argument that runs the orchestrator's message waiter. */
export const WAIT_MESSAGES_MODE = 'wait-messages'

/** Longer than the server's hold, so a held poll is answered rather than cut off. */
const WAIT_FETCH_TIMEOUT_MS = 40_000
/** The pause after a failed poll (server restarting, network blip) before the next. */
const WAIT_RETRY_MS = 3000

export interface WaitMessagesDeps {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  waiterId?: string
}

/**
 * `wait-messages` mode (`whole-cuts-plan-themselves` decision 20). Runs as an
 * orchestrate session's `asyncRewake` hook: long-polls
 * `GET /api/hooks/orchestrator-messages` until the server hands it lines, then
 * resolves exit code 2 with them joined by newlines — Claude Code wakes the
 * session with that output as one system reminder. `superseded` (a newer waiter
 * took over) and `ended` (the session is over) resolve 0 with nothing to say. A
 * hold that ran out polls again; a failed poll waits and retries. Never 2
 * without lines.
 */
export async function waitMessages(
  serverUrl: string,
  sessionId: string | undefined,
  deps: WaitMessagesDeps = {},
): Promise<{ code: 0 | 2; output: string }> {
  if (!sessionId) return { code: 0, output: '' }
  const doFetch = deps.fetch ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const waiter = deps.waiterId ?? crypto.randomUUID()
  const url =
    `${serverUrl}/api/hooks/orchestrator-messages` +
    `?sessionId=${encodeURIComponent(sessionId)}&waiter=${encodeURIComponent(waiter)}`
  for (;;) {
    let answer: { status?: string; lines?: unknown }
    try {
      const res = await doFetch(url, { signal: AbortSignal.timeout(WAIT_FETCH_TIMEOUT_MS) })
      answer = (await res.json()) as typeof answer
    } catch {
      await sleep(WAIT_RETRY_MS)
      continue
    }
    if (answer.status === 'superseded' || answer.status === 'ended') return { code: 0, output: '' }
    const lines = Array.isArray(answer.lines) ? answer.lines.filter((l) => typeof l === 'string') : []
    if (answer.status === 'lines' && lines.length > 0) return { code: 2, output: lines.join('\n') }
    // Anything but a hold that ran out answered at once: never spin on it.
    if (answer.status !== 'empty') await sleep(WAIT_RETRY_MS)
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const event = argv[0] ?? ''
  const serverUrl = process.env.RUNCASTLE_SERVER_URL ?? 'http://localhost:4512'
  const sessionId = process.env.RUNCASTLE_SESSION_ID

  if (event === WAIT_MESSAGES_MODE) {
    const { code, output } = await waitMessages(serverUrl, sessionId)
    if (output) process.stderr.write(output)
    process.exit(code)
  }

  const raw = await readStdin()
  let payload: unknown
  try {
    payload = raw.trim().length > 0 ? JSON.parse(raw) : {}
  } catch {
    payload = { raw }
  }

  const res = await fetch(`${serverUrl}/api/hooks/${event}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event, sessionId, payload }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  const text = await res.text()
  process.stdout.write(text.trim().length > 0 ? text : '{}')
}

if (import.meta.main) {
  main().catch((err) => {
    // Never break the user's session: log, print `{}`, exit 0 (SPEC §5.5).
    console.error(err)
    console.log('{}')
    process.exit(0)
  })
}
