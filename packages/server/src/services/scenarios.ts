import { randomBytes } from 'node:crypto'
import type { ScenarioEntry, ScenarioFailure } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { runDriveHook, tailLines } from './drive-hooks'
import { driveProcessEnv } from './drive-env'

/**
 * Drive scenarios (drive-scenarios spec, "The scenario contract"): a file under
 * `.runcastle/scenarios/` that seeds a drive's database and prints
 * `ENTRY_URL=<url>`. Runcastle lists the paths from git and runs the project's
 * one runner command against a file — it never reads a scenario's contents,
 * which is what keeps this language-agnostic.
 */

/** Where scenarios live in a project repo; fixed, never configurable. */
export const SCENARIOS_DIR = '.runcastle/scenarios'

/** How long a scenario may run before it is killed and fails. */
export const SCENARIO_TIMEOUT_MS = 120_000

/** The placeholder the runner command carries for the scenario's path. */
export const SCENARIO_FILE_PLACEHOLDER = '{file}'

/** `expired-coupon` → `Expired coupon`: separators to spaces, first letter up. */
function readable(segment: string): string {
  const spaced = segment.replace(/[-_]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** A file name without its last extension (`expired-coupon.ts` → `expired-coupon`). */
function stem(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/**
 * The scenario a repo path names, or null for shared code: any segment under
 * `scenarios/` starting with `_` (`_fixtures/`) is a helper, never listed.
 * Dot-names (`.gitkeep`) are not scenarios either.
 */
function toEntry(file: string, own: boolean): ScenarioEntry | null {
  const rel = file.slice(SCENARIOS_DIR.length + 1)
  const segments = rel.split('/')
  if (segments.some((s) => s === '' || s.startsWith('_') || s.startsWith('.'))) return null
  const name = readable(stem(segments[segments.length - 1] ?? ''))
  if (name === '') return null
  return {
    file,
    ...(segments.length > 1 ? { group: readable(segments[0] ?? '') } : {}),
    name,
    own,
  }
}

async function gitLines(repoPath: string, args: string[]): Promise<string[]> {
  const out = await simpleGit(repoPath).raw(args)
  return out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')
}

/**
 * The scenarios at `ref`, read from git rather than the working tree so a
 * feature's scenarios list before its drive has checked the branch out. `own`
 * marks the files `ref` added or changed against `baseBranch`; own sort first,
 * each half in path order. A ref with no scenarios directory (or no such ref)
 * lists nothing.
 */
export async function listScenarios(
  repoPath: string,
  opts: { ref: string; baseBranch?: string },
): Promise<ScenarioEntry[]> {
  let files: string[]
  try {
    files = await gitLines(repoPath, ['ls-tree', '-r', '--name-only', opts.ref, '--', SCENARIOS_DIR])
  } catch {
    return []
  }
  let changed = new Set<string>()
  if (opts.baseBranch) {
    try {
      changed = new Set(
        await gitLines(repoPath, [
          'diff', '--name-only', `${opts.baseBranch}...${opts.ref}`, '--', SCENARIOS_DIR,
        ]),
      )
    } catch {
      // An unreachable base leaves nothing marked own; the list still stands.
    }
  }
  const entries = files
    .map((file) => toEntry(file, changed.has(file)))
    .filter((e): e is ScenarioEntry => e !== null)
  const byPath = (a: ScenarioEntry, b: ScenarioEntry): number =>
    a.file < b.file ? -1 : a.file > b.file ? 1 : 0
  return [
    ...entries.filter((e) => e.own).sort(byPath),
    ...entries.filter((e) => !e.own).sort(byPath),
  ]
}

/** The readable name of a scenario file, as the picker shows it. */
export function scenarioName(file: string): string {
  const base = file.split('/').pop() ?? file
  return readable(stem(base))
}

/** A fresh per-run discriminator scenarios use to keep entities unique (`buyer_7f3a`). */
export function scenarioRunId(): string {
  return randomBytes(3).toString('hex')
}

export type ScenarioRunResult =
  | { ok: true; entryUrl: string; outputTail: string }
  | { ok: false; failure: ScenarioFailure }

export interface RunScenarioOptions {
  /** The project's scenario runner; unset fails as `no-runner`. */
  runner: string | undefined
  /** Repo-relative path of the scenario. */
  file: string
  /** The drive's checkout. */
  cwd: string
  /** Drive identity plus the `drive.env` overlay; `RUNCASTLE_SCENARIO_RUN` is added per run. */
  env: Record<string, string>
  /** The drive's URL, which a relative `ENTRY_URL` resolves against. */
  driveUrl: string
  timeoutMs?: number
  /** The live output tail, each time the scenario prints. */
  onOutput?: (outputTail: string) => void
}

/** The last `ENTRY_URL=` line on stdout, or undefined. Later lines win. */
function lastEntryUrl(stdout: string): string | undefined {
  let found: string | undefined
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^ENTRY_URL=(.+)$/.exec(line.trim())
    if (m?.[1]) found = m[1].trim()
  }
  return found
}

/**
 * Run one scenario once: no retry, no fallback. Success is exit 0 together
 * with an `ENTRY_URL` line; anything else fails with the reason and the tail of
 * the combined output, which is what the human is shown. Never throws.
 */
export async function runScenario(opts: RunScenarioOptions): Promise<ScenarioRunResult> {
  if (!opts.runner?.trim()) {
    return { ok: false, failure: { reason: 'no-runner', exitCode: null, outputTail: '' } }
  }
  const command = opts.runner.split(SCENARIO_FILE_PLACEHOLDER).join(`"${opts.file}"`)
  let live = ''
  const result = await runDriveHook(command, {
    cwd: opts.cwd,
    env: driveProcessEnv({ ...opts.env, RUNCASTLE_SCENARIO_RUN: scenarioRunId() }),
    timeoutMs: opts.timeoutMs ?? SCENARIO_TIMEOUT_MS,
    ...(opts.onOutput
      ? {
          onData: (chunk: string) => {
            live += chunk
            opts.onOutput?.(tailLines(live))
          },
        }
      : {}),
  })
  const outputTail = result.output
  if (result.timedOut) {
    return { ok: false, failure: { reason: 'timeout', exitCode: null, outputTail } }
  }
  if (result.exitCode !== 0) {
    return { ok: false, failure: { reason: 'exit', exitCode: result.exitCode, outputTail } }
  }
  const raw = lastEntryUrl(result.stdout)
  let entryUrl: string | undefined
  try {
    entryUrl = raw === undefined ? undefined : new URL(raw, opts.driveUrl).toString()
  } catch {
    entryUrl = undefined
  }
  if (entryUrl === undefined) {
    return { ok: false, failure: { reason: 'no-entry-url', exitCode: 0, outputTail } }
  }
  return { ok: true, entryUrl, outputTail }
}
