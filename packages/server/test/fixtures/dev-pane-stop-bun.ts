import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { devSpawnTarget, drivePaneId, stopDevPane } from '../../src/pty/dev-pane'
import { ptyRegistry } from '../../src/pty/registry'

/**
 * Drive the REAL dev-pane stop path from inside a real Bun process, and report
 * what happened as one line of JSON evidence.
 *
 * This exists because the vitest suite cannot reach the runtime that broke. On
 * win32 production runs the server under Bun, `selectBackend()` auto-picks the
 * sidecar, and the tree-kill promise is awaited under Bun — which is precisely
 * where `promisify(execFile)` never settled and hung every drive stop. vitest
 * awaits it under node, where it always settled, so the node-side test stayed
 * green for the entire life of the bug. Only a Bun process can speak to it.
 *
 * Run BY `bun`, spawned from `dev-pane-stop-bun.test.ts`. Deliberately does NOT
 * set `RUNCASTLE_PTY_BACKEND`: backend selection is part of what is under test.
 *
 * The tree it builds is the production shape — PTY host → `cmd.exe /d /s /c`
 * shim (win32) or `/bin/sh -c` (POSIX) → a `bun` grandchild holding a real TCP
 * port — so a teardown that reaches only the direct child leaves the port bound.
 *
 * Exit 0 means: stop returned inside the deadline, the port is free, and every
 * pid in the tree is gone. Any other outcome exits non-zero with the evidence.
 */

/** The teardown deadline the registry promises. Stop must return inside it. */
const STOP_DEADLINE_MS = 5000
/** How long to wait for the grandchild to bind its port before giving up. */
const PORT_UP_TIMEOUT_MS = 20_000
/**
 * Hard stop for the whole fixture, so a hung stop still REPORTS rather than
 * hangs. Kept below the caller's test timeout so the evidence always escapes.
 */
const WATCHDOG_MS = 45_000

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** A port nothing is listening on, obtained by briefly binding port 0. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr === null || typeof addr === 'string') {
        srv.close(() => reject(new Error('no port assigned')))
        return
      }
      const { port } = addr
      srv.close(() => resolve(port))
    })
  })
}

/** Whether something answers HTTP on the port right now. */
async function portResponds(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) })
    await res.text()
    return true
  } catch {
    return false
  }
}

/** Poll until the port answers (or we give up), returning how long it took. */
async function awaitPort(port: number, timeoutMs: number): Promise<number | null> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await portResponds(port)) return Date.now() - started
    await delay(200)
  }
  return null
}

/**
 * Run `command` through the platform shell, redirecting its output to `outFile`,
 * and resolve with what it wrote.
 *
 * The redirection is not incidental. Reading a child's stdout through a PIPE is
 * the exact operation suspected of never settling under Bun on Windows (a failed
 * `uv_read_start` parking the loop — oven-sh/bun#32011, fixed on canary by
 * oven-sh/bun#35150). A diagnostic that hangs the same way as the bug it is
 * measuring is worse than useless, so this fixture never pipes: `stdio: 'ignore'`
 * throughout, output via a file, settlement on listeners it attaches itself.
 */
function shellCapture(command: string, outFile: string): Promise<string> {
  const { file, args } =
    process.platform === 'win32'
      ? { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', command] }
      : { file: '/bin/sh', args: ['-c', command] }

  return new Promise((resolve) => {
    let settled = false
    const done = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        resolve(readFileSync(outFile, 'utf8'))
      } catch {
        resolve('')
      }
    }
    const timer = setTimeout(done, 15_000)
    try {
      const child = spawn(file, args, { windowsHide: true, stdio: 'ignore' })
      child.on('exit', done)
      child.on('close', done)
      child.on('error', done)
    } catch {
      done()
    }
  })
}

/** Every live process as `{pid, ppid}` — the raw material for a tree walk. */
async function listProcesses(scratchDir: string): Promise<Array<{ pid: number; ppid: number }>> {
  const outFile = join(scratchDir, 'proclist.txt')
  const command =
    process.platform === 'win32'
      ? `powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Csv -NoTypeInformation" > "${outFile}"`
      : `ps -eo pid=,ppid= > "${outFile}"`
  const raw = await shellCapture(command, outFile)

  // CSV on win32 (`"1234","5678"`), two bare columns on POSIX — either way, the
  // first two integers on a line are pid and ppid. NULs are stripped first: a
  // PowerShell that redirects as UTF-16LE would otherwise read back as digits
  // separated by NUL, and `\d+` would match each digit as its own "pid".
  return raw
    .replace(/\0/g, '')
    .split(/\r?\n/)
    .map((line) => line.match(/\d+/g))
    .filter((m): m is RegExpMatchArray => m !== null && m.length >= 2)
    .map((m) => ({ pid: Number(m[0]), ppid: Number(m[1]) }))
    .filter((r) => Number.isInteger(r.pid) && Number.isInteger(r.ppid))
}

/** `root` plus every process descended from it, per a snapshot of the table. */
async function treePids(root: number, scratchDir: string): Promise<number[]> {
  const all = await listProcesses(scratchDir)
  const tree = new Set([root])
  // Repeat to depth: the table is unordered, so one pass can miss grandchildren.
  for (let i = 0; i < 8; i++) {
    const before = tree.size
    for (const { pid, ppid } of all) if (tree.has(ppid)) tree.add(pid)
    if (tree.size === before) break
  }
  return [...tree]
}

/** True while `pid` is still a live process. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** A scratch dir holding the port-holding grandchild, run by `bun`. */
function holderDir(port: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'rc-stopbun-'))
  writeFileSync(
    join(dir, 'holder.mjs'),
    `Bun.serve({ port: ${port}, hostname: '127.0.0.1', fetch: () => new Response('ok') })\n` +
      `console.log('HOLDER ' + process.pid)\n`,
  )
  return dir
}

async function main(): Promise<void> {
  const port = await freePort()
  const dir = holderDir(port)
  const paneId = drivePaneId('stopbun-fixture')
  // `bun` is resolved by the shim shell off PATH, exactly as a real devCommand
  // ("npm run dev") would be — the shell interposition is the point: it makes the
  // port-holder a GRANDCHILD, which is what only a tree-kill can reach.
  const devCommand = 'bun holder.mjs'
  const { file, args } = devSpawnTarget(devCommand)

  const evidence: Record<string, unknown> = {
    platform: process.platform,
    bun: process.versions.bun ?? null,
    isBun: typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined',
    ptyBackendOverride: process.env.RUNCASTLE_PTY_BACKEND ?? null,
    port,
    paneId,
    devCommand,
  }

  // process.exit skips `finally`, so cleanup belongs on the one exit path.
  const report = (ok: boolean): never => {
    evidence.ok = ok
    rmSync(dir, { recursive: true, force: true })
    process.stdout.write(`EVIDENCE ${JSON.stringify(evidence)}\n`)
    process.exit(ok ? 0 : 1)
  }

  const watchdog = setTimeout(() => {
    evidence.failure = `fixture exceeded ${WATCHDOG_MS}ms — the stop path most likely hung`
    report(false)
  }, WATCHDOG_MS)

  try {
    // The two-line core of `startDevPane`, minus its DB-bound event emit (which
    // would need an AppCtx). Everything below this point is production code.
    ptyRegistry().create({
      sessionId: paneId,
      cmd: file,
      args,
      opts: { cwd: dir, env: process.env, cols: 80, rows: 24, useConpty: true },
    })
    // Read on THIS tick: under the sidecar `pty.pid` is the host process we
    // spawned only until its async `ready` frame swaps in node-pty's inner pid.
    const hostPid = ptyRegistry().get(paneId)?.pty.pid ?? -1
    evidence.hostPid = hostPid

    const portUpMs = await awaitPort(port, PORT_UP_TIMEOUT_MS)
    evidence.portUpMs = portUpMs
    evidence.ptyPid = ptyRegistry().get(paneId)?.pty.pid ?? -1
    const before = await treePids(hostPid, dir)
    evidence.treePidsBefore = before
    if (portUpMs === null) {
      // Carry the tree anyway: what DID spawn under the host is the first thing
      // anyone debugging a fixture that never came up will want to see.
      evidence.failure = 'grandchild never bound the port'
      report(false)
    }

    const startedAt = Date.now()
    await stopDevPane(paneId)
    const stopMs = Date.now() - startedAt
    evidence.stopMs = stopMs
    evidence.stopWithinDeadline = stopMs < STOP_DEADLINE_MS

    // Windows reaps a taskkilled tree a beat after taskkill returns, and the port
    // lingers a moment longer. Give both a bounded grace before judging.
    for (let i = 0; i < 20; i++) {
      if (!before.some(pidAlive) && !(await portResponds(port))) break
      await delay(250)
    }

    const aliveAfter = before.filter(pidAlive)
    const portFreed = !(await portResponds(port))
    evidence.aliveAfter = aliveAfter
    evidence.portFreed = portFreed
    evidence.registryCleared = !ptyRegistry().has(paneId)

    clearTimeout(watchdog)
    report(stopMs < STOP_DEADLINE_MS && aliveAfter.length === 0 && portFreed)
  } catch (err) {
    clearTimeout(watchdog)
    evidence.failure = err instanceof Error ? err.message : String(err)
    report(false)
  }
}

void main()
