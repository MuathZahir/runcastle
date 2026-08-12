import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

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
  try {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    } else {
      // Negative pid → the whole process group (pid == pgid for the pty leader).
      process.kill(-pid, 'SIGTERM')
    }
  } catch {
    // Tree already gone / pid reused — the caller's pty.kill() still fires onExit.
  }
}
