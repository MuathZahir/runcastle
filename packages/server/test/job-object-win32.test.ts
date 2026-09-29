import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveBun } from './helpers/bun'

/**
 * Terminal process trees live in a Windows Job Object — proven on real processes.
 *
 * vitest runs under node and `bun:ffi` exists only under Bun, so, as in
 * `dev-pane-stop-bun.test.ts`, the real work happens in Bun fixture children:
 * - session end: `fixtures/job-object-session-end.ts` judges itself and prints
 *   one `EVIDENCE {json}` line;
 * - crash: `fixtures/job-object-crash.ts` is a stand-in server that gets
 *   hard-killed, so the judging (port rebinds, no descendant survives) lives here.
 *
 * Skipped off win32 (POSIX teardown is process-group signalling, unchanged) and
 * when no `bun` can be found.
 */

const SESSION_END_FIXTURE = fileURLToPath(new URL('./fixtures/job-object-session-end.ts', import.meta.url))
const CRASH_FIXTURE = fileURLToPath(new URL('./fixtures/job-object-crash.ts', import.meta.url))

const BUN = resolveBun()
const RUNNABLE = process.platform === 'win32' && BUN !== null

/** Above the session-end fixture's own 45s watchdog, so its evidence always escapes. */
const TEST_TIMEOUT_MS = 90_000
/** How long the crash fixture may take to open its terminal and report READY. */
const READY_TIMEOUT_MS = 30_000
/** The acceptance bound: after a hard kill the port and the tree are gone within this. */
const CRASH_CLEANUP_MS = 5000

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Whether the port can be bound again right now. */
function portBindable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)))
  })
}

/** Pids a failed run may have left behind; taskkilled after each test. */
const leftovers: number[] = []

afterEach(() => {
  for (const pid of leftovers.splice(0)) {
    if (!pidAlive(pid)) continue
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  }
})

describe.skipIf(!RUNNABLE)('terminal Job Objects under Bun on Windows', () => {
  it(
    'ending a session kills the MCP server its exited claude orphaned',
    async () => {
      const output = await new Promise<string>((resolve) => {
        const child = spawn(BUN as string, [SESSION_END_FIXTURE], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        })
        let out = ''
        child.stdout?.setEncoding('utf8')
        child.stdout?.on('data', (c: string) => {
          out += c
        })
        child.stderr?.setEncoding('utf8')
        child.stderr?.on('data', (c: string) => {
          out += c
        })
        child.on('error', (err) => resolve(`${out}\nspawn error: ${err.message}`))
        child.on('close', () => resolve(out))
      })

      const line = output.split(/\r?\n/).find((l) => l.startsWith('EVIDENCE '))
      expect(line, `fixture printed no evidence line. Full output:\n${output}`).toBeDefined()
      const evidence = JSON.parse((line as string).slice('EVIDENCE '.length)) as {
        isBun: boolean
        ok: boolean
        selfExit?: { aliveAfter: number[] }
        killTree?: { orphanedBeforeKill: boolean; aliveAfter: number[] }
      }
      console.log('job-object session-end evidence:', JSON.stringify(evidence))

      expect(evidence.isBun, 'fixture did not run under Bun').toBe(true)
      expect(evidence.selfExit?.aliveAfter, `host exit left survivors. Output:\n${output}`).toEqual([])
      expect(evidence.killTree?.orphanedBeforeKill, `the MCP child was never orphaned. Output:\n${output}`).toBe(true)
      expect(evidence.killTree?.aliveAfter, `killTree left survivors. Output:\n${output}`).toEqual([])
      expect(evidence.ok, `fixture failed. Output:\n${output}`).toBe(true)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a hard-killed server frees its port and takes every terminal tree with it',
    async () => {
      const child: ChildProcess = spawn(BUN as string, [CRASH_FIXTURE], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let output = ''
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (c: string) => {
        output += c
      })
      const ready = await new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), READY_TIMEOUT_MS)
        child.stdout?.setEncoding('utf8')
        child.stdout?.on('data', (c: string) => {
          output += c
          const line = output.split(/\r?\n/).find((l) => l.startsWith('READY ') || l.startsWith('FAILED '))
          if (line) {
            clearTimeout(timer)
            resolve(line)
          }
        })
        child.on('close', () => resolve(null))
      })
      if (child.pid !== undefined) leftovers.push(child.pid)
      expect(ready?.startsWith('READY '), `fixture never became ready. Output:\n${output}`).toBe(true)

      const t = JSON.parse((ready as string).slice('READY '.length)) as {
        port: number
        hostPid: number
        nestPid: number
        stubPid: number
        mcpPid: number
      }
      const tree = [t.hostPid, t.nestPid, t.mcpPid]
      leftovers.push(...tree)
      expect(t.port).not.toBe(4512)

      // Wait out the stub so the MCP stand-in is a genuine orphan when we crash.
      for (let i = 0; i < 50 && pidAlive(t.stubPid); i++) await delay(100)
      expect(pidAlive(t.stubPid), 'stub never exited').toBe(false)
      expect(pidAlive(t.mcpPid), 'MCP stand-in died before the crash').toBe(true)

      // TerminateProcess on win32: no handler runs, nothing tears anything down.
      process.kill(child.pid as number)

      const started = Date.now()
      let bindable = false
      let alive = tree
      while (Date.now() - started < CRASH_CLEANUP_MS) {
        bindable = await portBindable(t.port)
        alive = tree.filter(pidAlive)
        if (bindable && alive.length === 0) break
        await delay(100)
      }
      console.log('job-object crash evidence:', JSON.stringify({ ...t, bindable, alive, ms: Date.now() - started }))

      expect(bindable, `port ${t.port} still bound ${CRASH_CLEANUP_MS}ms after the crash`).toBe(true)
      expect(alive, 'descendants survived the crash').toEqual([])
    },
    TEST_TIMEOUT_MS,
  )
})
