import { spawn } from 'node:child_process'
import { killProcessTree } from '../pty/kill-tree'
import { resolveSpawnTarget } from '../util/resolve-executable'
import type { ExecFn, ExecOutcome } from './doctor'

/**
 * How long one command may run before it is given up on. A backstop, not a
 * budget: everything that runs through here is a probe or a short engine call
 * that answers in seconds. What it guards against is a command that never
 * answers at all — a wedged Docker daemon leaves `docker info` blocked forever,
 * and with no bound the doctor query waiting on it never returned, which held
 * the whole app on its loading screen.
 */
export const DEFAULT_EXEC_TIMEOUT_MS = 60_000

/**
 * The production {@link ExecFn}: resolve the binary with the shared
 * PATHEXT-aware helper (so a Windows `.cmd`/`.ps1` shim does NOT ENOENT the way
 * a naive `spawn(name)` would — docs/research/PREREQS-NOTES.md §8), spawn it,
 * and fold the result into an {@link ExecOutcome}. Never throws: a spawn failure
 * (binary genuinely not found) becomes `{ ok: false }`, which the probes read as
 * "not installed".
 *
 * A command still running after `timeoutMs` has its process tree killed and
 * resolves at once as `{ ok: true, code: null, timedOut: true }` — present, but
 * not healthy, which is how every probe already reads a non-zero exit. It does
 * not wait for `close`: a shim's grandchild can hold the pipes open past the kill.
 *
 * Resolves via {@link resolveTool}, so `RUNCASTLE_CLAUDE_BIN` / `RUNCASTLE_NODE_BIN`
 * pin the path here exactly as they do for the session launcher — the probes and
 * the launcher must never disagree about whether a tool is present.
 */
export function createSystemExec(
  opts: { cwd?: string; timeoutMs?: number } = {},
): ExecFn {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS
  return (command, args) =>
    new Promise<ExecOutcome>((resolve) => {
      // A `.cmd`/`.bat`/`.ps1` shim can't be exec'd directly on Windows — each
      // needs its interpreter, shared with the launcher so probe and launch can
      // never disagree about whether a tool is runnable.
      const { file, args: spawnArgs } = resolveSpawnTarget(command, args)

      let stdout = ''
      let stderr = ''
      let settled = false
      const settle = (outcome: ExecOutcome): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(outcome)
      }
      const child = spawn(file, spawnArgs, { cwd: opts.cwd, windowsHide: true })
      const timer = setTimeout(() => {
        if (child.pid !== undefined) void killProcessTree(child.pid)
        const note = `${command} ${args.join(' ')} timed out after ${Math.round(timeoutMs / 1000)}s`
        settle({
          ok: true,
          code: null,
          stdout,
          stderr: stderr ? `${stderr}\n${note}` : note,
          timedOut: true,
        })
      }, timeoutMs)
      child.stdout?.on('data', (d: Buffer) => {
        stdout += d.toString()
      })
      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString()
      })
      child.on('error', (err) => {
        // ENOENT and friends: the binary is not runnable — treat as not present.
        settle({ ok: false, code: null, stdout, stderr: stderr || String(err) })
      })
      child.on('close', (code) => {
        settle({ ok: true, code: code ?? 0, stdout, stderr })
      })
    })
}
