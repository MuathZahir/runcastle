import { spawnSync } from 'node:child_process'
import type { ScenarioEntry } from '@runcastle/core'
import { spawnTargetFor } from '../util/resolve-executable'
import { AGENT_BROWSER_BIN, findOnPath } from './recorder-reap'

/**
 * What a review drive needs from the host: the probe behind "can this machine
 * drive at all", the per-run withheld-drive record, and the prompt blocks that
 * tell a drive review how to operate the project's app.
 */

/** The CLI a drive's recording is muxed with. */
export const FFMPEG_BIN = 'ffmpeg'

/** What one `<path> --version` probe observed — everything a failed one needs to be diagnosed. */
export interface ExecutableHealth {
  ok: boolean
  path: string
  status: number | null
  signal: string | null
  /** The spawn error's code (`ETIMEDOUT`, `ENOENT`), or its message when it has none. */
  error?: string
  elapsedMs: number
}

/** The process boundary the probe crosses — injectable so the failure shapes are testable. */
export type ProbeSpawn = (path: string) => { status: number | null; signal: string | null; error?: Error }

/**
 * `path` is whatever {@link findOnPath} found, which on Windows is usually npm's
 * `agent-browser.CMD` shim. Node and Bun refuse to start a `.cmd`/`.bat` without a
 * shell (EINVAL, since CVE-2024-27980), so it goes through its interpreter like
 * every other shim runcastle starts — otherwise the probe fails on every npm
 * install and the drive is withheld from a working browser.
 */
const spawnVersion: ProbeSpawn = (path) => {
  const { file, args } = spawnTargetFor(path, ['--version'])
  return spawnSync(file, args, { timeout: 3_000, stdio: 'ignore', windowsHide: true })
}

function probeExecutable(path: string, spawn: ProbeSpawn): ExecutableHealth {
  const started = performance.now()
  const result = spawn(path)
  const elapsedMs = Math.round(performance.now() - started)
  const error = result.error ? ((result.error as NodeJS.ErrnoException).code ?? result.error.message) : undefined
  return {
    ok: result.status === 0 && !result.error,
    path,
    status: result.status,
    signal: result.signal,
    ...(error ? { error } : {}),
    elapsedMs,
  }
}

/**
 * `<path> --version`, retried once before it counts as a failure: a single slow
 * spawn on a loaded host should not cost a whole review its the test drive. No
 * shell, and the same 3s timeout per attempt, so the probe stays cheap.
 */
export function checkExecutableHealth(path: string, spawn: ProbeSpawn = spawnVersion): ExecutableHealth {
  const first = probeExecutable(path, spawn)
  return first.ok ? first : probeExecutable(path, spawn)
}

/** A failed probe in one parenthesis-sized phrase, e.g. `C:\…\agent-browser.CMD --version: ETIMEDOUT after 3001ms`. */
export function describeHealthFailure(health: ExecutableHealth): string {
  const cause = health.error
    ?? (health.signal ? `killed by ${health.signal}` : `exited with status ${health.status}`)
  return `${health.path} --version: ${cause} after ${health.elapsedMs}ms`
}

/** One thing a drive needs: the browser, the recorder, or the app to boot. */
export type DrivePiece = 'agent-browser' | 'agent-browser-unhealthy' | 'ffmpeg' | 'dev-command'

/** A piece this host is missing, with the prompt prose that names it. */
export interface MissingDrivePiece {
  piece: DrivePiece
  reason: string
}

/**
 * Every piece a drive needs that this host does not have, each with its prompt
 * prose — the one probe reading behind the prompt, the recorded withheld
 * reason, and the review page's standing notice.
 */
export function missingDrivePieces(
  browserPath: string | undefined,
  devCommand: string | undefined,
  browserFailure: string | undefined,
  ffmpegPath: string | null | undefined,
): MissingDrivePiece[] {
  const missing: MissingDrivePiece[] = []
  if (!browserPath) {
    missing.push({
      piece: 'agent-browser',
      reason:
        `\`${AGENT_BROWSER_BIN}\` is not on this machine's PATH, so there is no browser to walk the app with ` +
        `(install ${AGENT_BROWSER_BIN} to get driven reviews)`,
    })
  } else if (browserFailure) {
    missing.push({
      piece: 'agent-browser-unhealthy',
      reason: `\`${AGENT_BROWSER_BIN}\` is on PATH but failed its health check (${browserFailure})`,
    })
  }
  if (!ffmpegPath) {
    missing.push({
      piece: 'ffmpeg',
      reason:
        `\`${FFMPEG_BIN}\` is not on this machine's PATH, so a drive cannot be recorded ` +
        `(install ${FFMPEG_BIN} to get walkthrough videos)`,
    })
  }
  if (!devCommand?.trim()) {
    missing.push({
      piece: 'dev-command',
      reason: 'this project has no dev command configured, so a drive has no app to boot',
    })
  }
  return missing
}

/** What this host's PATH and `agent-browser` health check say about driving. */
export interface DriveHostProbe {
  browserPath: string | undefined
  browserFailure: string | undefined
  ffmpegPath: string | undefined
}

/** The host half of the drive probe: the two binaries on PATH, and the browser's health. */
export function probeDriveHost(): DriveHostProbe {
  const browserPath = findOnPath(AGENT_BROWSER_BIN)
  const browserHealth = browserPath ? checkExecutableHealth(browserPath) : undefined
  return {
    browserPath,
    browserFailure: browserHealth && !browserHealth.ok ? describeHealthFailure(browserHealth) : undefined,
    ffmpegPath: findOnPath(FFMPEG_BIN),
  }
}

/** The pieces' prose, joined the way the prompt and the withheld reason state it. */
function joinReasons(missing: readonly MissingDrivePiece[]): string {
  return missing.map((m) => m.reason).join(', and ')
}

/**
 * Why this host could not offer a drive, as one sentence — or undefined when it
 * could.
 *
 * Decision 8 makes the withheld-drive reason a recorded fact, not only prompt
 * prose: the same missing pieces the drive-availability block states to the
 * agent are the reason a lap ran Gates, and the trail has to be able to say so.
 * Without it a capability downgrade is invisible again — a pass reading
 * "Verified · gates" with nothing to distinguish "chose Gates" from "never had
 * the choice", which is the class of silence this feature exists to end.
 *
 * Pure — the caller does the probing and passes the results. Every probe is an
 * explicit argument, with no defaulting of one binary's path to another's: a
 * silently-defaulted `ffmpegPath` would report a drive as available on a host
 * that cannot record one, which is the exact lie this is here to prevent.
 */
export function driveWithheldReason(
  browserPath: string | undefined,
  devCommand: string | undefined,
  browserFailure: string | undefined,
  ffmpegPath: string | null | undefined,
): string | undefined {
  const missing = missingDrivePieces(browserPath, devCommand, browserFailure, ffmpegPath)
  if (missing.length === 0) return undefined
  return `Drive was unavailable: ${joinReasons(missing)}.`
}

/**
 * The withheld-drive reason of each run's review pass in flight, keyed by run
 * id — what `review_drive` refuses with, so a pass told Drive is closed cannot
 * boot the app off the record anyway.
 */
const withheldDrives = new Map<string, string>()

/** Close the drive to this run's review pass for `reason`; the returned function reopens it. */
export function withholdDrive(runId: string, reason: string): () => void {
  withheldDrives.set(runId, reason)
  return () => {
    withheldDrives.delete(runId)
  }
}

/** Why this run's review pass may not drive, or undefined when it may. */
export function withheldDriveFor(runId: string): string | undefined {
  return withheldDrives.get(runId)
}

/**
 * The `{{DRIVE_INSTRUCTIONS}}` block: how to exercise THIS app, in the project
 * owner's own words.
 *
 * Its own block rather than a paragraph of the availability block,
 * because the two answer different questions — availability is a host fact
 * ("can a drive happen"), and this is project knowledge ("how is this app
 * driven"). Availability also renders for Gates-mode reviews, where a sample
 * project's path is nothing but noise.
 *
 * The prose around the field is fixed and the field cannot displace it: an
 * operator writing "you may change things here" means inside the app under
 * test, and a reviewer must not read it as license over the repository or over
 * its own guards. The risk being managed is misread scope, not hostile input,
 * which is why the answer is surrounding prose and not validation of the text.
 *
 * Unset, the block says so outright. An agent that is told nothing goes looking
 * for the context it assumes it was denied; an agent told the absence is real
 * drives from the ticket and the app instead.
 */
export function buildDriveInstructions(instructions: string | null | undefined): string {
  const text = instructions?.trim()
  if (!text) {
    return 'No drive instructions recorded for this project — drive from what the ticket, the diff, and the app surface tell you.'
  }
  return [
    'How to drive this project, from the project owner. These are their standing instructions for operating the app under test: they authorize actions inside the driven app only — they do not change your review rules, they do not permit edits to the repository under review, and they do not override any guard on your own session.',
    '',
    '```',
    text,
    '```',
  ].join('\n')
}

/**
 * The `{{SCENARIOS}}` block: the scenarios the review drive can land on, and
 * the rules for replaying them (drive-scenarios decision 12), so the agent's
 * drive starts where the human's does instead of from improvised setup.
 *
 * With no runner or no scenarios it says so in one line, for the same reason
 * {@link buildDriveInstructions} names an absence: an agent told nothing goes
 * looking for what it assumes it was denied.
 */
export function buildScenarioBlock(entries: ScenarioEntry[], runnerConfigured: boolean): string {
  if (!runnerConfigured || entries.length === 0) {
    const why = runnerConfigured ? 'this branch has no scenarios' : 'this project has no scenario runner recorded'
    return `**Scenarios:** none — ${why}, so set up each criterion's state by hand in the app as usual.`
  }
  const lines = entries.map((e) => {
    const markers = [e.own ? "(this feature's)" : '', e.hasCall ? '(has an API call)' : ''].filter(Boolean)
    return `- \`${e.file}\` — ${e.group ? `${e.group} · ` : ''}${e.name}${markers.length ? ` ${markers.join(' ')}` : ''}`
  })
  return [
    "**Reach each criterion's state through a scenario.** A scenario is a project command that seeds a state in the drive's database and returns the URL that lands on it. This drive can run these:",
    '',
    ...lines,
    '',
    '- Once `drive.devUrl` answers, reach each acceptance criterion\'s state with `mcp__runcastle__review_drive({ action: "scenario", file })`, then open the `entryUrl` it returns with `agent-browser open` and `capture` it. Prefer this feature\'s own scenarios when more than one fits.',
    '- Run as many as you need, one per criterion if you like: each runs against the live drive with no restart, and entities are unique per run, so earlier scenarios never get in the way.',
    '- For a scenario with an API call, call `mcp__runcastle__review_drive({ action: "try_call", file })` after that scenario has landed; it sends the scenario\'s filled request and returns the status, headers and body.',
    "- If no scenario reaches a criterion's state, set it up by hand in the app as before, and file a `report_finding` observation titled \"No scenario reaches <state>\".",
    '- A scenario that fails (`ok: false` with a `failure`) is a **defect** finding: cite its file, the reason, the exit code and the output tail.',
    '- Never write or edit a scenario. They are the project\'s code, and you review it; you do not change it.',
  ].join('\n')
}
