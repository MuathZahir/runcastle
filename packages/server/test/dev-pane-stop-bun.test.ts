import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveBun } from './helpers/bun'

/**
 * The stop path under the runtime that actually broke (preparation-bug).
 *
 * Every other test of `stopDevPane` runs under node, because that is what vitest
 * is — and under node the tree-kill always settled. Production runs the server
 * under BUN on win32, where `promisify(execFile)` never settled and every drive
 * stop hung indefinitely. The node-side suite in `dev-pane.test.ts` was green
 * throughout, which is exactly why it could not be trusted: the runtime, not the
 * backend, was the variable.
 *
 * So this test does not test anything itself. It spawns a real `bun` child on the
 * fixture, which drives the real production stack from inside a real Bun process
 * — `devSpawnTarget` + `ptyRegistry().create` + `stopDevPane`, sidecar backend
 * auto-selected, a `cmd.exe`-shimmed grandchild holding a real TCP port — and
 * exits non-zero unless stop returned inside the deadline, the port was freed,
 * and every pid in the tree died. All this side does is run it and report.
 *
 * Skipped off win32 (the tree-kill this covers is the `taskkill /T` branch) and
 * when no `bun` can be found.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/dev-pane-stop-bun.ts', import.meta.url))

const BUN = resolveBun()
const RUNNABLE = process.platform === 'win32' && BUN !== null

/**
 * Comfortably above the fixture's own 45s watchdog, on purpose: if the stop path
 * hangs, we want the fixture to survive long enough to PRINT its evidence. A
 * vitest timeout that fired first would kill the one artifact worth having.
 */
const TEST_TIMEOUT_MS = 90_000

interface FixtureRun {
  code: number | null
  output: string
}

/** Run the fixture to completion, capturing everything it said. */
function runFixture(bun: string): Promise<FixtureRun> {
  return new Promise((resolve) => {
    const child = spawn(bun, [FIXTURE], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
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

describe.skipIf(!RUNNABLE)('stopDevPane under Bun on Windows (production runtime)', () => {
  it(
    'returns inside the deadline with the port freed and the whole tree dead',
    async () => {
      const { code, output } = await runFixture(BUN as string)

      const line = output.split(/\r?\n/).find((l) => l.startsWith('EVIDENCE '))
      expect(line, `fixture printed no evidence line. Full output:\n${output}`).toBeDefined()

      const evidence = JSON.parse((line as string).slice('EVIDENCE '.length)) as Record<
        string,
        unknown
      >
      // The evidence line is the artifact this test exists to produce — it is what
      // gets pasted into the work record, so surface it whatever the outcome.
      console.log('stopDevPane bun-runtime evidence:', JSON.stringify(evidence))

      expect(evidence.isBun, 'fixture did not run under Bun').toBe(true)
      expect(
        evidence.stopWithinDeadline,
        `stop took ${String(evidence.stopMs)}ms. Full output:\n${output}`,
      ).toBe(true)
      expect(evidence.portFreed, `port still answering. Full output:\n${output}`).toBe(true)
      expect(evidence.aliveAfter, `orphaned pids. Full output:\n${output}`).toEqual([])
      expect(code, `fixture exited ${String(code)}. Full output:\n${output}`).toBe(0)
    },
    TEST_TIMEOUT_MS,
  )
})
