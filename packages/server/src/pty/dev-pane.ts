import type { AppCtx } from '../db/types'
import { emit } from '../services/events'
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
 * tree so the dev server frees its port with no orphan — on Windows (ConPTY
 * teardown) and POSIX (process-group signal) alike.
 */

/** Registry-id prefix for drive-owned PTYs. Deliberately not a `sess_` id. */
const DRIVE_PREFIX = 'drive:'

/** The registry id for a feature's test-drive dev pane (never a session id). */
export function drivePaneId(featureId: string): string {
  return `${DRIVE_PREFIX}${featureId}`
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
  featureId: string
  repoPath: string
  devCommand: string
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
  const { ctx, featureId, repoPath, devCommand, onUrl } = input
  const paneId = drivePaneId(featureId)
  const { file, args } = devSpawnTarget(devCommand)

  try {
    ptyRegistry().create({
      sessionId: paneId,
      cmd: file,
      args,
      opts: { cwd: repoPath, env: process.env, cols: 80, rows: 24, useConpty: true },
    })
  } catch (err) {
    emit(ctx, featureId, {
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

  emit(ctx, featureId, {
    type: 'testdrive.dev_started',
    message: `dev server spawned: ${devCommand}`,
    data: { paneId },
  })
  return paneId
}

/**
 * Kill a drive's dev pane and forget it. Kills the WHOLE process tree so the dev
 * server frees its port with no orphan: on POSIX the pane's shell is a process-
 * group leader (`forkpty` set it up), so we signal the group; on Windows tearing
 * down the ConPTY already kills every attached process. Idempotent — a no-op for
 * an unknown / already-dead pane.
 */
export function stopDevPane(paneId: string): void {
  const reg = ptyRegistry()
  const entry = reg.get(paneId)
  if (entry && !entry.exited && process.platform !== 'win32') {
    try {
      // Negative pid → the whole process group (pid == pgid for the pty leader).
      process.kill(-entry.pty.pid, 'SIGTERM')
    } catch {
      // group already gone / pid reused — the pty.kill below still fires onExit
    }
  }
  reg.kill(paneId)
  reg.remove(paneId)
}
