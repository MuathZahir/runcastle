import { spawn } from 'node:child_process'

/**
 * Test-drive hooks — the project's own "bring my environment up / take it down"
 * commands, run around a drive.
 *
 * The design constraint that produced this file: runcastle cannot know what a
 * project's environment IS. Bringing one up spans Postgres, MySQL, SQLite,
 * Mongo, hosted databases, docker-compose stacks, seed scripts and projects with
 * no data layer at all, and every attempt to model that generically ends up
 * encoding one vendor's idea of a database (a `TEMPLATE` clone, a `pg_dump`)
 * into a tool that has to work for the rest. So we model none of it: the project
 * supplies a string, we run it, and we report what happened. Preparation can
 * PROPOSE the string by reading the repo's config; it is still just a string.
 *
 * Best-effort by construction — a failing hook never fails the drive. By the
 * time setup runs the checkout has already switched, and reverting it would
 * strand the user somewhere they did not ask to be. A loud, quoted failure with
 * the command's own output is more useful than a refusal.
 */

/** How long a hook may run before it is killed. Generous: a cold `docker compose
 *  up` can pull images for minutes, and killing that early is worse than waiting. */
export const DRIVE_HOOK_TIMEOUT_MS = 10 * 60_000

/** How much of a hook's output we keep — enough for the error, not a whole build log. */
const OUTPUT_TAIL_LINES = 40

/** How long a killed hook gets to close its pipes before we resolve regardless. */
const KILL_GRACE_MS = 2_000

export interface DriveHookResult {
  /** Exit code 0, not merely "spawned". */
  ok: boolean
  /** `null` when the process was killed or never started. */
  exitCode: number | null
  timedOut: boolean
  /** Trailing lines of combined stdout+stderr (interleaved as received). */
  output: string
  durationMs: number
}

/** A failed hook, as the drive result carries it to the UI. */
export interface DriveHookFailure {
  /** Which hook: the pre-drive setup or the post-drive teardown. */
  phase: 'setup' | 'teardown'
  command: string
  exitCode: number | null
  timedOut: boolean
  output: string
}

/** The last `max` lines of `text`, trimmed. Pure. */
export function tailLines(text: string, max = OUTPUT_TAIL_LINES): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop()
  return lines.slice(-max).join('\n').trim()
}

/**
 * How to hand one hook command to a shell.
 *
 * The shell CHOICE mirrors `devSpawnTarget` (dev-pane.ts) deliberately: a
 * command a user verified next to their dev command must not behave differently
 * here because we picked a different shell, and an `&&` chain needs a shell to
 * mean anything at all.
 *
 * The QUOTING cannot be shared with it. `child_process.spawn` escapes an
 * embedded `"` as `\"` — a C-runtime convention `cmd.exe` does not implement,
 * so any command containing quotes (a redirect to a path with spaces, a `-m`
 * message) arrives at the shell mangled. `windowsVerbatimArguments` turns that
 * escaping off and hands cmd the line we actually wrote; `/s` then means "strip
 * the outer quotes, take the rest literally", which is the documented way to
 * pass a command that quotes things. node-pty does not share this problem, so
 * the dev pane does not share this code.
 */
export function hookSpawnTarget(command: string): {
  file: string
  args: string[]
  verbatim: boolean
} {
  if (process.platform === 'win32') {
    return {
      file: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', `"${command}"`],
      verbatim: true,
    }
  }
  return { file: '/bin/sh', args: ['-c', command], verbatim: false }
}

export interface RunDriveHookOptions {
  cwd: string
  /**
   * Environment for the hook. The setup hook and the dev pane get the SAME one,
   * which is what lets `createdb myapp_{{id}}` and the connection string that
   * follows it agree about which database this drive uses.
   */
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  /** Injected in tests; production uses `node:child_process.spawn`. */
  spawnFn?: typeof spawn
  now?: () => number
}

/**
 * Run one hook command to completion in the repo.
 *
 * Hosted through {@link hookSpawnTarget}, which picks the same shell the dev
 * pane uses. `&&`-chained hooks (`docker compose up -d && bunx prisma migrate
 * deploy`) need a shell to mean anything at all.
 *
 * Never throws — a hook that cannot even spawn resolves as a failure carrying
 * the spawn error as its output.
 */
export function runDriveHook(
  command: string,
  opts: RunDriveHookOptions,
): Promise<DriveHookResult> {
  const spawnFn = opts.spawnFn ?? spawn
  const now = opts.now ?? Date.now
  const timeoutMs = opts.timeoutMs ?? DRIVE_HOOK_TIMEOUT_MS
  const startedAt = now()
  const { file, args, verbatim } = hookSpawnTarget(command)

  return new Promise<DriveHookResult>((resolve) => {
    let output = ''
    let timedOut = false
    let settled = false
    // Declared before `finish` because the spawn-failure path calls it before
    // the timer is ever armed.
    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({
        ok: !timedOut && exitCode === 0,
        exitCode,
        timedOut,
        output: tailLines(output),
        durationMs: now() - startedAt,
      })
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawnFn(file, args, {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        windowsHide: true,
        windowsVerbatimArguments: verbatim,
      })
    } catch (err) {
      output = err instanceof Error ? err.message : String(err)
      finish(null)
      return
    }

    timer = setTimeout(() => {
      timedOut = true
      child.kill()
      // `close` waits for every stdio pipe to shut, which a grandchild that
      // survived the kill (a detached `ping`, a service the shell spawned) can
      // hold open forever. Normal completion still resolves on `close` so the
      // output is complete; a killed hook gets this grace window and then gives
      // up, because hanging the drive is worse than a truncated log.
      const grace = setTimeout(() => finish(null), KILL_GRACE_MS)
      grace.unref?.()
    }, timeoutMs)
    // A hook can outlive a short-lived caller; do not hold the event loop open.
    timer.unref?.()

    child.stdout?.on('data', (d: Buffer) => {
      output += d.toString()
    })
    child.stderr?.on('data', (d: Buffer) => {
      output += d.toString()
    })
    child.on('error', (err) => {
      output += `\n${err instanceof Error ? err.message : String(err)}`
      finish(null)
    })
    child.on('close', (code) => {
      finish(code)
    })
  })
}

/** One-line summary of a hook outcome, for an event message. */
export function describeHookResult(command: string, result: DriveHookResult): string {
  const secs = Math.max(1, Math.round(result.durationMs / 1000))
  if (result.timedOut) return `\`${command}\` timed out after ${secs}s`
  if (result.ok) return `\`${command}\` finished in ${secs}s`
  return `\`${command}\` exited ${result.exitCode ?? 'without a code'} after ${secs}s`
}
