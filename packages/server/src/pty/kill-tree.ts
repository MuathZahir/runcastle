import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'

/**
 * How long the win32 `taskkill` may run before we stop waiting on it. A backstop,
 * not a budget: the command itself returns in milliseconds, so this only ever
 * fires if a settlement event went missing.
 */
const TASKKILL_TIMEOUT_MS = 3000

/**
 * Run `taskkill /pid <pid> /T /F` and resolve once it settles, on `exit`/`close`/
 * `error` listeners WE attach, plus a timer backstop so even a lost event cannot
 * leave the promise pending. Never rejects.
 *
 * Deliberately not `promisify(execFile)`: under Bun on win32 that promise never
 * settled, hanging every drive stop indefinitely — while the identical `taskkill`
 * run by hand mid-hang finished instantly, and the event loop stayed alive
 * throughout (the server kept answering /health). The command was never the
 * problem; the await was. Owning the settlement removes the whole class.
 */
function taskkillTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(settle, TASKKILL_TIMEOUT_MS)
    // Never hold the process open on this backstop — teardown is best-effort.
    timer.unref?.()

    try {
      const child = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      // All three, because the one that arrives first is the one that counts:
      // 'error' when taskkill could not be spawned at all, 'exit' when it ran.
      child.on('exit', settle)
      child.on('close', settle)
      child.on('error', settle)
    } catch {
      // Synchronous spawn failure — nothing will ever fire; settle now.
      settle()
    }
  })
}

/**
 * Kill the process tree rooted at `pid`, best-effort. Shared by the PTY backends
 * behind `PtySession.killTree()`, each of which passes a pid it actually owns.
 *
 * On POSIX the pid must lead a process group (a `forkpty` shell does), so one
 * signal reaches every member. On Windows nothing signals a tree, and killing a
 * PTY reaches only its DIRECT child — which `devSpawnTarget` always makes the
 * `cmd.exe` shim, leaving the dev server itself, a GRANDCHILD, holding its port
 * and its file locks. `taskkill /T` walks the child list, so it is the only
 * teardown that actually frees the port.
 *
 * Async on purpose: the synchronous form froze the whole Bun event loop (1.5s UI
 * polling, live terminal WebSockets) on every drive stop. Never rejects — a tree
 * that is already gone, or a pid the OS has since reused, is normal at teardown.
 */
export async function killProcessTree(pid: number): Promise<void> {
  const started = Date.now()
  const isWin32 = process.platform === 'win32'

  if (isWin32) {
    await taskkillTree(pid)
  } else {
    try {
      // Negative pid → the whole process group (pid == pgid for the pty leader).
      process.kill(-pid, 'SIGTERM')
    } catch {
      // Tree already gone / pid reused — the caller's pty.kill() still fires onExit.
    }
  }

  // The pid is logged HERE, at the kill itself: an investigator self-locating a
  // recurrence from these breadcrumbs must be handed the pid that was actually
  // killed. Same `[pty-teardown]` prefix as the registry's lines, so one grep gets
  // the whole teardown story in order.
  console.error(
    `[pty-teardown] killProcessTree: pid=${pid} branch=${isWin32 ? 'taskkill' : 'pgroup'} settled after ${Date.now() - started}ms`,
  )
}

/** How long a stop waits after asking before it forces (stopping-a-session-kills-its-process decision 3). */
export const STOP_GRACE_MS = 5000

/** How long a stop keeps checking after the force before it calls the tree a survivor. */
const AFTER_FORCE_MS = 1000

/** How often a stop checks whether the tree is gone. */
const POLL_MS = 50

export interface StopTreeOptions {
  /**
   * Whether `pid` leads its own process group (POSIX: spawned `detached`), so one
   * signal reaches every process it started. Without one only `pid` itself is
   * signalled. Ignored on Windows, where `taskkill /T` walks the tree.
   */
  group: boolean
  /** How long to wait after asking before forcing; {@link STOP_GRACE_MS} by default. */
  graceMs?: number
  /** Who is stopping what, for the log line. */
  label?: string
}

export interface StopTreeResult {
  /** Nothing of the tree is left. */
  gone: boolean
  /** It had to be forced (`SIGKILL` / `taskkill /F`). */
  forced: boolean
}

/** Whether a signal reached anyone: ESRCH means nobody is there. */
function signal(target: number, sig: NodeJS.Signals | 0): boolean {
  try {
    process.kill(target, sig)
    return true
  } catch (err) {
    // EPERM: someone is there, just not ours to signal (a reused pid). Count it as alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Whether a live (not zombie) process is in group `pgid`, read from `/proc`. A
 * zombie still answers signal 0, and in a container with no init nobody reaps
 * the adapter's orphaned children, so on Linux the group check is confirmed here.
 * Undefined when `/proc` cannot be read.
 */
function liveInGroupLinux(pgid: number): boolean | undefined {
  let names: string[]
  try {
    names = readdirSync('/proc')
  } catch {
    return undefined
  }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue
    let stat: string
    try {
      stat = readFileSync(`/proc/${name}/stat`, 'utf8')
    } catch {
      continue
    }
    // `pid (comm) state ppid pgrp ...`; comm may hold spaces and parens, so read after the last ')'.
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    if (Number(rest[2]) === pgid && rest[0] !== 'Z' && rest[0] !== 'X') return true
  }
  return false
}

/** Whether anything of the target is still alive: signal 0, confirmed against zombies on Linux. */
function alive(target: number): boolean {
  if (!signal(target, 0)) return false
  if (target < 0 && process.platform === 'linux') return liveInGroupLinux(-target) ?? true
  return true
}

/** Resolves true once `alive()` says false, or false when `ms` runs out first. */
async function waitGone(alive: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms
  while (alive()) {
    if (Date.now() >= until) return false
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  return true
}

/**
 * Stop the process tree rooted at `pid`, and say whether it is gone. Unlike
 * {@link killProcessTree} (the PTY teardown's one signal, whose registry then
 * kills the PTY itself), this owns the whole stop:
 *
 *  - POSIX: `SIGTERM` to the group (or the pid), wait up to `graceMs` for it to
 *    empty, `SIGKILL`, then check again.
 *  - Windows: `taskkill /T /F` (the tree walk needs the root alive, so there is
 *    no polite step to wait on), then check the root is gone.
 *
 * Anything left is logged by pid. Never rejects: a tree already gone is normal.
 */
export async function stopProcessTree(pid: number, opts: StopTreeOptions): Promise<StopTreeResult> {
  const started = Date.now()
  const label = opts.label ? `${opts.label} ` : ''
  const report = (result: StopTreeResult, branch: string): StopTreeResult => {
    const line = `[process-stop] ${label}pid=${pid} branch=${branch} gone=${result.gone} forced=${result.forced} after ${Date.now() - started}ms`
    if (result.gone) console.error(line)
    else console.error(`${line} — a process survived its stop`)
    return result
  }

  if (process.platform === 'win32') {
    if (!signal(pid, 0)) return report({ gone: true, forced: false }, 'taskkill')
    await taskkillTree(pid)
    const gone = await waitGone(() => signal(pid, 0), AFTER_FORCE_MS)
    return report({ gone, forced: true }, 'taskkill')
  }

  // A group whose leader already exited can still hold members, so the group is
  // what is asked, checked and forced; with no group, the pid alone.
  let target = opts.group ? -pid : pid
  let branch = opts.group ? 'pgroup' : 'pid'
  if (!signal(target, 'SIGTERM')) {
    // No such group: the pid may still be there, just not leading one (the bug this replaced).
    if (!opts.group || !signal(pid, 'SIGTERM')) return report({ gone: true, forced: false }, branch)
    target = pid
    branch = 'pid (no group)'
  }
  if (await waitGone(() => alive(target), opts.graceMs ?? STOP_GRACE_MS)) return report({ gone: true, forced: false }, branch)
  signal(target, 'SIGKILL')
  const gone = await waitGone(() => alive(target), AFTER_FORCE_MS)
  return report({ gone, forced: true }, branch)
}
