import { contain, type Containment } from '../pty/job-object'

/**
 * The default job containment for a host process the server spawns outside a
 * terminal: burn/review/research execs, drive hooks, doctor probes.
 *
 * Jobs are a win32 thing, so elsewhere this skips `contain()` altogether and
 * with it the per-pid "unavailable" line it logs — a line that would otherwise
 * follow every hook and probe on Linux and macOS, where nothing changed.
 * `null` means what it means from `contain()`: fall back to `killProcessTree`.
 */
export function containHostProcess(pid: number): Containment | null {
  return process.platform === 'win32' ? contain(pid) : null
}
