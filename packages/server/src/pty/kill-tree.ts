import { spawn } from 'node:child_process'

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

  // The pid is logged HERE, not by the registry one layer up, because this is the
  // only place that knows it. The registry logs `entry.pty.pid`; under the sidecar
  // backend the tree is rooted at the HOST pid the sidecar spawned, never that
  // inner node-pty pid, so the two differ on every real run. An investigator
  // self-locating a recurrence from these breadcrumbs must be handed the pid that
  // was actually killed, or they inspect an untouched stranger and conclude the
  // tree-kill missed. Same `[pty-teardown]` prefix as the registry's lines, so one
  // grep gets the whole teardown story in order.
  console.error(
    `[pty-teardown] killProcessTree: pid=${pid} branch=${isWin32 ? 'taskkill' : 'pgroup'} settled after ${Date.now() - started}ms`,
  )
}
