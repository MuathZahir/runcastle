import { execFileSync } from 'node:child_process'
import type { AppCtx } from '../db/types'
import { emitScoped, type EmitScope } from '../services/events'
import { ptyRegistry, type TerminalSink } from './registry'

/**
 * Test-drive dev pane (SPEC §7 / issue #41). A test drive spawns the project's
 * `devCommand` inside a server-owned PTY that the drive — not a session — owns:
 * it registers under a NON-session id (`drive:<featureId>`), so the one-live-
 * session guard, `--resume` semantics and session-end hooks (all keyed on
 * session ROWS) never apply to it. The in-app xterm view streams it over the
 * same `/ws/terminal/:id` endpoint the embedded session terminals use.
 *
 * On start we sniff the first localhost URL out of the PTY output (surfaced as a
 * plain "Open app" link, sticky per drive); on stop we kill the whole process
 * tree so the dev server frees its port with no orphan — on Windows (`taskkill
 * /T` from the pane's pid) and POSIX (process-group signal) alike.
 */

/** Registry-id prefix for drive-owned PTYs. Deliberately not a `sess_` id. */
const DRIVE_PREFIX = 'drive:'

/**
 * The registry id for a drive's dev pane (never a session id). Keyed on whatever
 * the drive belongs to: a feature for a test drive, a project for a preparation
 * dry run — the two id spaces are disjoint, and at most one drive is ever live.
 */
export function drivePaneId(ownerId: string): string {
  return `${DRIVE_PREFIX}${ownerId}`
}

/** True for a drive-owned PTY id (guards that never treat it as a session). */
export function isDrivePaneId(id: string): boolean {
  return id.startsWith(DRIVE_PREFIX)
}

/**
 * The first localhost dev URL in a chunk of PTY output, or `undefined`. Matches
 * `http(s)://` on `localhost` / `127.0.0.1` / `[::1]` (what dev servers print as
 * their "Local:" address), tolerating ANSI colour codes and OSC-8 hyperlink
 * wrappers around the address. Network/LAN URLs are intentionally ignored — the
 * link opens the app on THIS machine.
 */
export function sniffDevUrl(text: string): string | undefined {
  // \x1b excluded from the path segment too: an ANSI colour reset or an OSC-8
  // terminator butts directly against the URL with no whitespace between them,
  // and would otherwise be swallowed into the captured string.
  const m = text.match(
    /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/[^\s"'<>`\x1b]*)?/i,
  )
  return m ? m[0] : undefined
}

/**
 * The `{file, args}` to run a dev command inside a PTY. On Windows we go through
 * `cmd.exe /d /s /c <command>` — the generalized cmd shim — so script-shim dev
 * commands (`npm`/`vite`/… resolve to `.cmd`/`.bat`, which ConPTY cannot exec
 * directly) run correctly. On POSIX a plain `sh -c <command>` shell hosts it;
 * `forkpty` makes that shell a session + process-group leader, which `stopDevPane`
 * relies on to signal the whole tree.
 */
export function devSpawnTarget(devCommand: string): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', devCommand] }
  }
  return { file: '/bin/sh', args: ['-c', devCommand] }
}

/** How many trailing bytes of output we keep scanning for the dev URL. */
const SNIFF_WINDOW = 8192

export interface StartDevPaneInput {
  ctx: AppCtx
  /** The drive this pane belongs to — a feature's timeline, or a project's. */
  scope: EmitScope
  repoPath: string
  devCommand: string
  /**
   * Environment for the dev server. Defaults to this process's, which is what
   * makes a drive share the developer's dev database; the drive passes an
   * overlay here to point it somewhere branch-specific instead.
   */
  env?: NodeJS.ProcessEnv
  /** Called once, with the first sniffed localhost URL. */
  onUrl: (url: string) => void
}

/**
 * Spawn the dev command in a drive-owned PTY and start sniffing its output for a
 * localhost URL. Best-effort: a spawn failure emits `testdrive.dev_failed` and
 * returns `undefined` (the test drive itself still succeeds). Returns the pane
 * id so the caller can stream/stop it.
 */
export function startDevPane(input: StartDevPaneInput): string | undefined {
  const { ctx, scope, repoPath, devCommand, env, onUrl } = input
  const paneId = drivePaneId('featureId' in scope ? scope.featureId : scope.projectId)
  const { file, args } = devSpawnTarget(devCommand)

  try {
    ptyRegistry().create({
      sessionId: paneId,
      cmd: file,
      args,
      opts: { cwd: repoPath, env: env ?? process.env, cols: 80, rows: 24, useConpty: true },
    })
  } catch (err) {
    emitScoped(ctx, scope, {
      type: 'testdrive.dev_failed',
      message: `dev server failed to start: ${err instanceof Error ? err.message : String(err)}`,
      data: { paneId },
    })
    return undefined
  }

  // The URL sniffer is just another sink on the registry entry, so it sees the
  // exact byte stream the xterm view will. It keeps a sliding window (a URL line
  // can arrive split across chunks) and self-disarms once a URL is found.
  let scanned = ''
  let found = false
  const sniffer: TerminalSink = {
    sendData(chunk) {
      if (found) return
      scanned = (scanned + chunk.toString('utf8')).slice(-SNIFF_WINDOW)
      const url = sniffDevUrl(scanned)
      if (url) {
        found = true
        onUrl(url)
      }
    },
    sendControl() {
      // status/resize frames are irrelevant to the sniffer
    },
  }
  ptyRegistry().attach(paneId, sniffer)

  emitScoped(ctx, scope, {
    type: 'testdrive.dev_started',
    message: `dev server spawned: ${devCommand}`,
    data: { paneId },
  })
  return paneId
}

/** Whether a drive's dev pane is registered and its process still running. */
export function devPaneLive(paneId: string): boolean {
  const entry = ptyRegistry().get(paneId)
  return !!entry && !entry.exited
}

/**
 * Kill the process tree rooted at `pid`, best-effort. On POSIX the pane's shell
 * is a process-group leader (`forkpty` set it up), so one signal reaches the
 * group. On Windows nothing signals a tree, and killing the PTY is not enough:
 * ConPTY teardown reaches only its DIRECT child, which `devSpawnTarget` always
 * makes the `cmd.exe` shim — the dev server itself is a GRANDCHILD and survives,
 * holding its port and its file locks. `taskkill /T` walks the child list, so it
 * is the only teardown that actually frees the port.
 */
function killProcessTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      // Negative pid → the whole process group (pid == pgid for the pty leader).
      process.kill(-pid, 'SIGTERM')
    }
  } catch {
    // tree already gone / pid reused — the caller's pty.kill still fires onExit
  }
}

/**
 * Kill a drive's dev pane and forget it. Kills the WHOLE process tree so the dev
 * server frees its port with no orphan (`killProcessTree`). Idempotent — a no-op
 * for an unknown / already-dead pane.
 */
export function stopDevPane(paneId: string): void {
  const reg = ptyRegistry()
  const entry = reg.get(paneId)
  if (entry && !entry.exited) killProcessTree(entry.pty.pid)
  reg.kill(paneId)
  reg.remove(paneId)
}
