import { spawn } from 'node:child_process'
import { resolveTool } from '../util/resolve-executable'
import type { ExecFn, ExecOutcome } from './doctor'

/**
 * The production {@link ExecFn}: resolve the binary with the shared
 * PATHEXT-aware helper (so a Windows `.cmd`/`.ps1` shim does NOT ENOENT the way
 * a naive `spawn(name)` would — docs/research/PREREQS-NOTES.md §8), spawn it,
 * and fold the result into an {@link ExecOutcome}. Never throws: a spawn failure
 * (binary genuinely not found) becomes `{ ok: false }`, which the probes read as
 * "not installed".
 *
 * Resolves via {@link resolveTool}, so `RUNCASTLE_CLAUDE_BIN` / `RUNCASTLE_NODE_BIN`
 * pin the path here exactly as they do for the session launcher — the probes and
 * the launcher must never disagree about whether a tool is present.
 */
export function createSystemExec(opts: { cwd?: string } = {}): ExecFn {
  return (command, args) =>
    new Promise<ExecOutcome>((resolve) => {
      const resolved = resolveTool(command)
      // A `.cmd`/`.bat` shim can't be exec'd directly on Windows — route it
      // through the command processor, mirroring the launcher's spawn target.
      const isShim = /\.(cmd|bat)$/i.test(resolved)
      const file = isShim ? (process.env.ComSpec ?? 'cmd.exe') : resolved
      const spawnArgs = isShim ? ['/c', resolved, ...args] : args

      let stdout = ''
      let stderr = ''
      const child = spawn(file, spawnArgs, { cwd: opts.cwd, windowsHide: true })
      child.stdout?.on('data', (d: Buffer) => {
        stdout += d.toString()
      })
      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString()
      })
      child.on('error', (err) => {
        // ENOENT and friends: the binary is not runnable — treat as not present.
        resolve({ ok: false, code: null, stdout, stderr: stderr || String(err) })
      })
      child.on('close', (code) => {
        resolve({ ok: true, code: code ?? 0, stdout, stderr })
      })
    })
}
