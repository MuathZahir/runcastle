import { tmpdir } from 'node:os'
import { createPtySession } from '../../src/pty/pty'

/**
 * Open a default-backend terminal from inside a real Bun process and report what
 * it delivered as one line of JSON evidence.
 *
 * Run BY `bun`, spawned from `pty-lifetime-bun.test.ts`. Under Bun on Linux the
 * in-process node-pty PTY exits with SIGHUP ~14ms after its first output, so a
 * terminal that prints, sleeps and prints again only ever shows its first line.
 * vitest runs under node, where native node-pty works, so only a Bun process can
 * see it. Backend selection is what is under test, so any inherited
 * `RUNCASTLE_PTY_BACKEND` is dropped before the terminal opens.
 *
 * This is `prototypes/linux-probe/pty-lifetime.ts` from the
 * session-process-trees feature, made into evidence.
 */

/** Hard stop, so a terminal that never exits still reports. Below the test timeout. */
const WATCHDOG_MS = 15_000

delete process.env.RUNCASTLE_PTY_BACKEND

const evidence: Record<string, unknown> = {
  platform: process.platform,
  bun: process.versions.bun ?? null,
  isBun: typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined',
}
const chunks: string[] = []

const report = (): never => {
  evidence.chunks = chunks
  process.stdout.write(`EVIDENCE ${JSON.stringify(evidence)}\n`)
  process.exit(0)
}

const watchdog = setTimeout(() => {
  evidence.exit = null
  report()
}, WATCHDOG_MS)

const pty = createPtySession('bash', ['-c', 'echo hi; sleep 1; echo one; sleep 1; echo two'], {
  cwd: tmpdir(),
  env: process.env,
})
pty.onData((data) => {
  chunks.push(data.toString('utf8'))
})
pty.onExit((exit) => {
  clearTimeout(watchdog)
  evidence.exit = exit
  report()
})
