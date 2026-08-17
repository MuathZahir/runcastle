import { spawn, spawnSync } from 'node:child_process'
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
 * Exit 0 means: the tree was genuinely OBSERVED (at least {@link MIN_TREE_PIDS}
 * pids, so the walk saw the shim and the grandchild and not just the root), stop
 * returned inside the deadline, the port is free, and every pid in that tree is
 * gone. Any other outcome exits non-zero with a `failure` field in the evidence
 * naming which of those went wrong — a capture that cannot see the tree is a
 * failure here, not a small tree, because it was silently the latter for all of
 * lap 1 and made the `aliveAfter` assertion vacuous.
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
/** How long the process-table capture may take before it is called a failure. */
const CAPTURE_TIMEOUT_MS = 15_000
/** How long a bail-path tree-kill may block before the fixture gives up on it. */
const BAIL_KILL_TIMEOUT_MS = 3000
/**
 * The smallest tree the pane can legitimately have — anything less means the
 * process-table capture is lying, not that teardown had less to do.
 *
 * On win32 production's shape is three deep: the sidecar HOST we spawned → the
 * `cmd.exe /d /s /c` shim `devSpawnTarget` always interposes → the `bun`
 * grandchild holding the port. On POSIX node-pty's `forkpty` leader IS the
 * `/bin/sh -c` shim, so there is no separate host and the legitimate floor is two.
 */
const MIN_TREE_PIDS = process.platform === 'win32' ? 3 : 2

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Best-effort tree-kill of `pid`, synchronously and bounded.
 *
 * Synchronous because the only caller ends in `process.exit`, which would abandon
 * an async spawn before it ever ran — and the likeliest reason we are bailing is a
 * stop that hung, so an awaited teardown could hang the report too. `spawnSync`
 * with a timeout gets the kill actually executed without risking either.
 */
function killTreeBestEffort(pid: number): void {
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        timeout: BAIL_KILL_TIMEOUT_MS,
      })
    } else {
      // Negative pid → the process group the pty leader heads.
      process.kill(-pid, 'SIGKILL')
    }
  } catch {
    // Already gone, or the pid was reused — best-effort by design.
  }
}

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
 * Spawn `file` with `args` DIRECTLY — an args array, no shell interposed on win32,
 * nothing piped — have the CHILD write `outFile`, then read that file back.
 *
 * Two hard constraints shaped this, both learned the expensive way.
 *
 * NEVER route it through `cmd.exe /d /s /c` with a `>` redirect. `cmd /s` strips
 * the FIRST and LAST quote of the whole command string; when the command ends in a
 * quoted redirect target, that closing quote IS the last character, so the path is
 * left unbalanced, cmd exits 1 with "The filename, directory name, or volume label
 * syntax is incorrect", and no file is ever written. That is precisely how this
 * capture failed — silently — for all of lap 1: `readFileSync` threw, the old
 * helper swallowed it and resolved `''`, the tree degenerated to `[root]`, and the
 * test's `aliveAfter: []` assertion became vacuous.
 *
 * NEVER pipe the child's stdout/stderr either. A failed `uv_read_start` on a child
 * PIPE parks Bun's event loop forever (oven-sh/bun#35150) — the exact bug class
 * this feature fixed. A diagnostic that hangs the same way as the bug it measures
 * is worse than useless. So: `stdio: 'ignore'`, output via a file the child writes
 * itself, settlement on listeners we attach ourselves plus a timer backstop.
 *
 * Rejects — loudly — if the child cannot be spawned, exits non-zero, times out, or
 * leaves nothing readable behind. Silence is what hollowed out lap 1's proof.
 */
function captureToFile(file: string, args: string[], outFile: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (err: Error | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err !== null) {
        reject(err)
        return
      }
      try {
        resolve(readFileSync(outFile, 'utf8'))
      } catch (readErr) {
        reject(new Error(`${file} wrote no readable file at ${outFile}: ${String(readErr)}`))
      }
    }
    const timer = setTimeout(
      () => finish(new Error(`${file} did not settle within ${CAPTURE_TIMEOUT_MS}ms`)),
      CAPTURE_TIMEOUT_MS,
    )
    try {
      const child = spawn(file, args, { windowsHide: true, stdio: 'ignore' })
      child.on('error', (err) => finish(new Error(`could not spawn ${file}: ${err.message}`)))
      // No pipes to drain, so `exit` is the whole story — and it carries the code.
      child.on('exit', (code) =>
        finish(code === 0 ? null : new Error(`${file} exited ${String(code)}`)),
      )
    } catch (err) {
      finish(new Error(`could not spawn ${file}: ${String(err)}`))
    }
  })
}

/**
 * Every live process as `{pid, ppid}` — the raw material for a tree walk. Throws
 * rather than returning an empty list: a process table with no rows in it is
 * impossible, so an empty parse means the capture or its format broke.
 */
async function listProcesses(scratchDir: string): Promise<Array<{ pid: number; ppid: number }>> {
  const outFile = join(scratchDir, 'proclist.txt')
  // The child writes `outFile` itself. On win32 that is PowerShell's `Set-Content`
  // — spawned directly, so there is no `cmd /s` to mangle the quotes and no shell
  // redirect at all. The path is single-quoted inside the PowerShell command, which
  // is safe because it comes from `mkdtempSync(tmpdir())` and so contains no quote.
  // On POSIX a directly-spawned `/bin/sh` redirects `ps`: `sh` does not do `cmd`'s
  // first-and-last-quote stripping, and POSIX was never the broken path.
  const { file, args } =
    process.platform === 'win32'
      ? {
          file: 'powershell.exe',
          args: [
            '-NoProfile',
            '-Command',
            `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Csv -NoTypeInformation | Set-Content -LiteralPath '${outFile}'`,
          ],
        }
      : { file: '/bin/sh', args: ['-c', `ps -eo pid=,ppid= > '${outFile}'`] }

  const raw = await captureToFile(file, args, outFile)

  // CSV on win32 (`"1234","5678"`), two bare columns on POSIX — either way, the
  // first two integers on a line are pid and ppid. NULs are stripped first: a
  // PowerShell that writes UTF-16LE would otherwise read back as digits separated
  // by NUL, and `\d+` would match each digit as its own "pid".
  const rows = raw
    .replace(/\0/g, '')
    .split(/\r?\n/)
    .map((line) => line.match(/\d+/g))
    .filter((m): m is RegExpMatchArray => m !== null && m.length >= 2)
    .map((m) => ({ pid: Number(m[0]), ppid: Number(m[1]) }))
    .filter((r) => Number.isInteger(r.pid) && Number.isInteger(r.ppid))

  if (rows.length === 0) {
    throw new Error(`parsed 0 processes from ${outFile} (${raw.length} bytes) — format changed?`)
  }
  return rows
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

  // Set as soon as the pane exists, so every bail path below can reach the tree
  // it needs to clean up — including the watchdog's.
  let hostPid = -1

  // process.exit skips `finally`, so cleanup belongs on the one exit path.
  const report = (ok: boolean): never => {
    evidence.ok = ok
    // Never leak the tree we built. On a bail, `pty.kill()` alone is not enough:
    // on win32 it reaps the sidecar host but leaves the port-holding GRANDCHILD
    // orphaned behind the cmd.exe shim, and only a tree walk reaches that. The
    // order is the same one the registry's teardown documents — tree FIRST,
    // because reaping the direct child breaks the parent → child link
    // `taskkill /T` walks. Both steps are synchronous and bounded: the failure
    // most likely being reported here is a stop that hangs, and the report is the
    // whole point.
    if (!ok && hostPid > 0) killTreeBestEffort(hostPid)
    try {
      ptyRegistry().get(paneId)?.pty.kill()
    } catch {
      // Already gone, or the backend refused — best-effort by design.
    }
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
    hostPid = ptyRegistry().get(paneId)?.pty.pid ?? -1
    evidence.hostPid = hostPid

    const portUpMs = await awaitPort(port, PORT_UP_TIMEOUT_MS)
    evidence.portUpMs = portUpMs
    evidence.ptyPid = ptyRegistry().get(paneId)?.pty.pid ?? -1

    // The tree walk is load-bearing evidence, so its failures are fatal and named
    // rather than swallowed. Record what we got BEFORE judging it: a short list is
    // the first thing anyone debugging the capture will want to read.
    let before: number[] = []
    let captureError: string | null = null
    try {
      before = await treePids(hostPid, dir)
    } catch (err) {
      captureError = err instanceof Error ? err.message : String(err)
    }
    evidence.treePidsBefore = before

    if (portUpMs === null) {
      // Carry the tree anyway: what DID spawn under the host is the first thing
      // anyone debugging a fixture that never came up will want to see.
      evidence.failure = 'grandchild never bound the port'
      report(false)
    }
    if (captureError !== null) {
      evidence.failure = `process-table capture failed, so the tree claim cannot be trusted: ${captureError}`
      report(false)
    }
    if (before.length < MIN_TREE_PIDS) {
      // The lap-1 hole, now fatal. A tree of one is what a broken capture returns,
      // and it makes `aliveAfter: []` mean only "the host died" while reading as
      // "the whole tree died" — so it must never again pass for proof.
      evidence.failure =
        `pane tree resolved to ${before.length} pid(s) [${before.join(', ')}], expected at least ` +
        `${MIN_TREE_PIDS} (host + shim + port-holding grandchild). The capture is not seeing the ` +
        `tree, so aliveAfter would prove nothing.`
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
