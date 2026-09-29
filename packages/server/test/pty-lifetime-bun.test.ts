import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveBun } from './helpers/bun'

/**
 * A terminal outlives its first line under Bun on POSIX.
 *
 * Under Bun, in-process node-pty on Linux hangs up (SIGHUP) ~14ms after the
 * PTY's first output, killing every runcastle terminal at once — which is why
 * `chooseBackend` routes every Bun runtime to the node-hosted sidecar. vitest
 * runs under node, where native node-pty works, so this spawns a real `bun`
 * child on the fixture and only reads its evidence: the default backend, a
 * program that prints, sleeps and prints again, and how it exited.
 *
 * Skipped on win32 (its Bun breakage is the input pipe, covered by
 * `pty.test.ts`) and when no `bun` can be found.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/pty-lifetime-bun.ts', import.meta.url))

const BUN = resolveBun()

/** Above the fixture's own 15s watchdog, so a hung terminal still reports. */
const TEST_TIMEOUT_MS = 30_000

interface FixtureRun {
  code: number | null
  output: string
}

/** Run the fixture to completion, capturing everything it said. */
function runFixture(bun: string): Promise<FixtureRun> {
  return new Promise((resolve) => {
    const child = spawn(bun, [FIXTURE], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (c: string) => {
      output += c
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (c: string) => {
      output += c
    })
    child.on('error', (err) => {
      output += `\nspawn error: ${err.message}`
      resolve({ code: null, output })
    })
    child.on('close', (code) => resolve({ code, output }))
  })
}

describe.skipIf(process.platform === 'win32' || BUN === null)(
  'terminal lifetime under Bun (POSIX)',
  () => {
    it(
      'keeps delivering output after the first line and exits normally',
      async () => {
        const { code, output } = await runFixture(BUN as string)

        const line = output.split(/\r?\n/).find((l) => l.startsWith('EVIDENCE '))
        expect(line, `fixture printed no evidence line. Full output:\n${output}`).toBeDefined()
        const evidence = JSON.parse((line as string).slice('EVIDENCE '.length)) as {
          isBun: boolean
          chunks: string[]
          exit: { exitCode: number; signal?: number } | null
        }

        expect(evidence.isBun, 'fixture did not run under Bun').toBe(true)
        expect(output, 'default backend under Bun was not the sidecar').toContain(
          '[pty] backend=sidecar',
        )

        const text = evidence.chunks.join('')
        const hi = text.indexOf('hi')
        expect(hi, `no first line. Output:\n${output}`).toBeGreaterThanOrEqual(0)
        expect(text.indexOf('one'), `terminal died after its first line:\n${output}`).toBeGreaterThan(hi)
        expect(text.indexOf('two'), `terminal died before its last line:\n${output}`).toBeGreaterThan(
          text.indexOf('one'),
        )

        expect(evidence.exit, `terminal never exited. Output:\n${output}`).not.toBeNull()
        expect(evidence.exit?.signal || 0, 'terminal exited on a signal (SIGHUP?)').toBe(0)
        expect(evidence.exit?.exitCode).toBe(0)
        expect(code).toBe(0)
      },
      TEST_TIMEOUT_MS,
    )
  },
)
