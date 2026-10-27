/**
 * Standalone hook client (SPEC §5.5). Runs INSIDE a Claude Code session, invoked
 * by the settings.json hooks as `bun run "<abs path>" <route-event>`.
 *
 * It reads the hook JSON from stdin, POSTs `{ event, sessionId, payload }` to
 * `RUNCASTLE_SERVER_URL/api/hooks/<event>`, and prints the server's response body
 * VERBATIM to stdout (the server returns the final hook JSON that Claude Code
 * consumes as context). Zero dependencies (plain `fetch`), 3s timeout (5s and
 * retried for `session-start`, see {@link postHook}). On ANY
 * error it prints `{}` and exits 0 — a hook must never break the user's session.
 */

const FETCH_TIMEOUT_MS = 3000
const STDIN_TIMEOUT_MS = 2500
/**
 * `session-start` is retried ({@link postHook}): 3 attempts of 5s with a 0.5s
 * pause stay inside the 20s its settings give it (`renderSettings`).
 */
const SESSION_START_ATTEMPTS = 3
const SESSION_START_FETCH_TIMEOUT_MS = 5000
const SESSION_START_RETRY_MS = 500

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

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const event = argv[0] ?? ''
  const serverUrl = process.env.RUNCASTLE_SERVER_URL ?? 'http://localhost:4512'
  const sessionId = process.env.RUNCASTLE_SESSION_ID

  const raw = await readStdin()
  let payload: unknown
  try {
    payload = raw.trim().length > 0 ? JSON.parse(raw) : {}
  } catch {
    payload = { raw }
  }

  const text = await postHook(serverUrl, event, { event, sessionId, payload })
  process.stdout.write(text.trim().length > 0 ? text : '{}')
}

export interface PostHookDeps {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

/**
 * POST one hook to the server and return its response body. `session-start` is
 * the one that records the conversation id every later resume needs, and its
 * handler is idempotent (it already fires once per source), so a failed or
 * timed-out attempt is retried: one slow server moment must not leave a session
 * unrecorded. Every other hook gets one attempt — it blocks a turn or a tool.
 */
export async function postHook(
  serverUrl: string,
  event: string,
  body: unknown,
  deps: PostHookDeps = {},
): Promise<string> {
  const doFetch = deps.fetch ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const startHook = event === 'session-start'
  const attempts = startHook ? SESSION_START_ATTEMPTS : 1
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await doFetch(`${serverUrl}/api/hooks/${event}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(startHook ? SESSION_START_FETCH_TIMEOUT_MS : FETCH_TIMEOUT_MS),
      })
      return await res.text()
    } catch (err) {
      if (attempt >= attempts) throw err
      await sleep(SESSION_START_RETRY_MS)
    }
  }
}

if (import.meta.main) {
  main().catch((err) => {
    // Never break the user's session: log, print `{}`, exit 0 (SPEC §5.5).
    console.error(err)
    console.log('{}')
    process.exit(0)
  })
}
