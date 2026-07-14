/**
 * Standalone hook client (SPEC §5.5). Runs INSIDE a Claude Code session, invoked
 * by the settings.json hooks as `bun run "<abs path>" <route-event>`.
 *
 * It reads the hook JSON from stdin, POSTs `{ event, sessionId, payload }` to
 * `RUNCASTLE_SERVER_URL/api/hooks/<event>`, and prints the server's response body
 * VERBATIM to stdout (the server returns the final hook JSON that Claude Code
 * consumes as context). Zero dependencies (plain `fetch`), 3s timeout. On ANY
 * error it prints `{}` and exits 0 — a hook must never break the user's session.
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
