import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { resolvePreparedSettings } from '@runcastle/core'
import type { GateCommandResult, ModelEntry, ReviewGateRun, RuncastleConfig, Ticket, WorkflowCtx } from '@runcastle/core'
import { logsDir, reviewDir, reviewGateLogPath, reviewWalkthroughPath } from '@runcastle/core/paths'
import { run } from '@ai-hero/sandcastle'
import type { AgentStreamEvent, RunOptions } from '@ai-hero/sandcastle'
import { noSandbox } from '@ai-hero/sandcastle/sandboxes/no-sandbox'
import { renderRunMcpConfig } from '../launcher/artifacts'
import { appendTranscript, beginTranscript, endTranscript } from '../services/agent-stream'
import { headSha, releaseReviewDrive } from '../services/git'
import { AUTO_FIX_CAP } from '../services/review-findings'
import { killRegistry, registerHostChildren } from './kill-registry'
import type { runReviewGates } from './review-gates'
import { AGENT_BROWSER_BIN, findOnPath, reapRecorder } from './recorder-reap'
export { AGENT_BROWSER_BIN, findOnPath } from './recorder-reap'
import type { BurnAgentMcp, HarvestedDigest, TicketOutcome } from './ticket-burner'
import {
  buildBurnAgent,
  buildFeatureBrief,
  buildLapDigestsBlock,
  buildTicketJson,
  buildTicketTiming,
  burnerAssetPath,
  createStreamThrottle,
  createToolTimer,
  emitTicketTiming,
  errorHeadline,
  harvestDigest,
  readAgentFile,
  registerTicketAbort,
  releaseTicketAbort,
  renderTemplate,
} from './ticket-burner'

/**
 * The burn's second execution kind (improve-workflow spec, "Per-kind execution
 * in the burner"): a `review` ticket, run HOST-SIDE against the integrated
 * feature branch once every implementation ticket is terminal.
 *
 * Everything the implementation path does to keep concurrent agents apart is
 * absent here on purpose — no per-ticket branch, no container, no merge-queue
 * entry — because a review has nothing to land. It runs `claude --print` in the
 * project's real checkout, with the runcastle MCP wired in under the run's
 * identity, so the agent can boot the app through `review_drive`, walk it, and
 * report what it finds through `report_finding` — one typed row per finding,
 * each defect minting the fix ticket this same run goes on to burn.
 *
 * Semantics, from decision 6: **findings are not failure.** The ticket is done
 * when the review ran to completion, however many bugs it wrote up. It fails
 * only when the review could not run at all — an unresolvable base, an agent
 * that crashed — and that reason rides the ticket's digest into the run digest,
 * because "review could not run: X" is the one thing the human arriving at the
 * review screen needs to know.
 *
 * A review runs in exactly ONE of two modes, never both: a browser **Drive** of
 * the app against the ticket's acceptance criteria, or **Gates** — the server's
 * run of the project's verify commands on the branch, plus a two-axis read of
 * the branch's diff. Measured across a
 * burn's worth of reviews, the ones that did exactly one delivered in around
 * half an hour and the ones that attempted both ran long or died having
 * delivered neither. The prompt makes the choice in its first step; this path
 * supplies the half of it the agent cannot cheaply observe — whether a drive is
 * available at all ({@link buildDriveAvailability}) — and the gate results both
 * modes are handed ({@link buildGateNotes}).
 *
 * So neither a missing `agent-browser` nor a drive that refused is a failure:
 * both just mean Gates mode. The template tells the agent to say `could not
 * drive: <reason>` in its digest, fall back to Gates, and forbids it from
 * building an environment of its own — a worktree, an install, a codegen — to
 * drive in instead: that improvisation was the most expensive single act
 * observed in any review, and it verified nothing, because an app the agent
 * assembled for itself is not the app the human runs.
 */

/** The prompt the review agent is spawned with. */
export function reviewTemplatePath(ticket?: Pick<Ticket, 'passKind'>): string {
  return burnerAssetPath(ticket?.passKind === 'verification' ? 'verify-fixes.md' : 'review-ticket.md')
}

const PLACEHOLDERS = [
  'TICKET_JSON',
  'FEATURE_BRIEF',
  'DOCS_DIGEST',
  'LAP_DIGESTS',
  'FEATURE_BRANCH',
  /** The ref the branch forked from — the feature's own base, not a shell guess. */
  'BASE_BRANCH',
  /** Whether Drive mode is open at all, decided host-side (see {@link buildDriveAvailability}). */
  'DRIVE_AVAILABILITY',
  /** How to drive THIS app, in the project's own words (see {@link buildDriveInstructions}). */
  'DRIVE_INSTRUCTIONS',
  /** The server's gate run on the branch and the known-failure baseline. */
  'GATE_NOTES',
  'DIGEST_PATH',
  'BLOCKED_PATH',
  'WALKTHROUGH_PATH',
  'LANDED_FIXES',
  'VERIFIES_PASS',
  'AUTO_FIX_CAP',
] as const

/** {@link renderTemplate} over the review template's fixed key set. */
export function renderReviewPrompt(
  templateOrTicket: string | Pick<Ticket, 'passKind'>,
  values: Record<(typeof PLACEHOLDERS)[number], string>,
): string {
  const template = typeof templateOrTicket === 'string'
    ? templateOrTicket
    : readFileSync(reviewTemplatePath(templateOrTicket), 'utf8')
  return renderTemplate(template, values)
}

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

const spawnVersion: ProbeSpawn = (path) => spawnSync(path, ['--version'], { timeout: 3_000, stdio: 'ignore' })

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
 * spawn on a loaded host should not cost a whole review its Drive mode. No
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
 * prose: the same missing pieces {@link buildDriveAvailability} states to the
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
 * The `{{DRIVE_AVAILABILITY}}` block: whether Drive mode is open at all.
 *
 * The prompt's first step asks two questions — does this lap have a surface a
 * human could operate, and is a drive available. The first is a judgement only
 * the agent can make from the ticket and the diff; the second is a host fact it
 * would otherwise pay a `review_drive` start to discover, on the human's real
 * checkout. So it is answered here, and when the answer is no the block says so
 * flatly: the mode is already decided, and the agent should not call the tool.
 *
 * Pure — the caller does the PATH probe and passes the result.
 */
export function buildDriveAvailability(
  browserPath: string | undefined,
  devCommand: string | undefined,
  inheritedMode?: 'drive' | 'gates',
  browserFailure?: string,
  ffmpegPath: string | null | undefined = browserPath,
): string {
  if (inheritedMode === 'gates') {
    return 'Inherited mode: **Gates**. The pass being verified recorded Gates mode, so run Gates mode; do not choose Drive mode or call `review_drive`.'
  }
  const missing = missingDrivePieces(browserPath, devCommand, browserFailure, ffmpegPath)
  if (inheritedMode === 'drive' && missing.length === 0) {
    return 'Inherited mode: **Drive**. The pass being verified recorded Drive mode, so run Drive mode and record the full tour; do not choose Gates mode.'
  }
  if (missing.length === 0) {
    return (
      `A drive **is** available: \`${AGENT_BROWSER_BIN}\` is on this machine's PATH and the ` +
      'project has a dev command, so `review_drive` can boot the app and you can walk it. Drive ' +
      'mode is open to you — take it if, and only if, this lap has a surface a human could operate.'
    )
  }
  return (
    `A drive is **not** available: ${joinReasons(missing)}. So the mode is already decided — ` +
    'run Gates mode, whatever this lap touched, and do not call `review_drive`. This is not a ' +
    'degraded review; it is the whole review this lap gets.'
  )
}

/** A verification inherits the mode recorded by the pass it follows. */
export function inheritedReviewMode(reviewMode: 'drive' | 'gates' | null | undefined): 'drive' | 'gates' {
  return reviewMode ?? 'gates'
}

export interface ReviewResolution {
  reviewMode?: 'drive' | 'gates'
  reviewVerdict: 'verified' | 'unverified'
  reason: string
}

// The REVIEW-REASON line is optional: the template only requires it when a pass
// is unverified, so a clean pass often ends the digest at the verdict line.
const DECLARATION =
  /(?:^|\n)REVIEW-MODE:\s*(drive|gates)\s*\nREVIEW-VERDICT:\s*(verified|unverified)\b(?:\s*\nREVIEW-REASON:[ \t]*([^\r\n]*))?/i

/**
 * The pass's recorded outcome, from what the agent declared and what the host
 * knows.
 *
 * `driveWithheldReason` is the host's half (decision 8). The template only
 * mandates a `REVIEW-REASON` when a pass is unverified, so the ordinary
 * capability downgrade — Gates ran because ffmpeg is missing, and then honestly
 * verified — declares an empty one. The reason the server composed before the
 * spawn fills that gap; it never overwrites a reason the reviewer wrote.
 */
export function resolveReviewDeclaration(
  digestText: string | undefined,
  facts: { webmExists: boolean; offeredMode: 'drive' | 'gates'; driveWithheldReason?: string },
): ReviewResolution {
  const match = digestText?.match(DECLARATION)
  if (!match) return { reviewVerdict: 'unverified', reason: 'Review declaration missing or unparseable.' }
  const reviewMode = match[1]!.toLowerCase() as 'drive' | 'gates'
  const declared = match[2]!.toLowerCase() as 'verified' | 'unverified'
  const declaredReason = (match[3] ?? '').trim()
  if (declared === 'unverified') {
    return {
      reviewMode,
      reviewVerdict: 'unverified',
      reason: declaredReason || 'Reviewer declared this pass unverified.',
    }
  }
  if (reviewMode === 'drive' && facts.offeredMode !== 'drive') {
    // Still unverified — no recording is no evidence — but when the host knew
    // which prerequisite was missing, the trail names it (decision 8).
    return {
      reviewMode,
      reviewVerdict: 'unverified',
      reason: facts.driveWithheldReason
        ? `${facts.driveWithheldReason} The reviewer drove anyway, so nothing was recorded.`
        : 'Drive was declared even though Drive mode was unavailable.',
    }
  }
  if (reviewMode === 'drive' && !facts.webmExists) {
    return {
      reviewMode,
      reviewVerdict: 'unverified',
      reason: 'Drive was declared verified but no walkthrough recording was produced.',
    }
  }
  return { reviewMode, reviewVerdict: 'verified', reason: declaredReason || facts.driveWithheldReason || '' }
}

/**
 * The digest a pass is stored under, headed by runcastle's own line when it
 * verified nothing (decision 5).
 *
 * The headline of an unverified pass is a template the server fills, never the
 * agent's prose — the prose keeps every word it wrote, one line down, where it
 * can no longer read as a clean bill of health to anything that lifts a first
 * line out (the run aggregate, the review page's account, the outcome doc). A
 * verified pass is left exactly as the agent wrote it.
 *
 * A pass whose declaration block was missing or unparseable has no mode to
 * name, so the template says that instead of inventing one: the point of the
 * line is that nothing here is being claimed on the agent's behalf.
 */
export function composeReviewDigest(
  lap: number,
  resolution: ReviewResolution,
  agentDigest: string | undefined,
): string | undefined {
  if (resolution.reviewVerdict !== 'unverified') return agentDigest
  const mode = resolution.reviewMode
  const headline =
    `Lap ${lap} · ${mode ? `${mode} mode` : 'mode unrecorded'} · ` +
    `${mode ? `${mode.toUpperCase()} FAILED` : 'NO DECLARATION'} · nothing verified` +
    (resolution.reason ? ` — ${resolution.reason}` : '')
  return agentDigest ? `${headline}\n\n${agentDigest}` : headline
}

/**
 * The `{{DRIVE_INSTRUCTIONS}}` block: how to exercise THIS app, in the project
 * owner's own words.
 *
 * Its own block rather than a paragraph of {@link buildDriveAvailability},
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

/** The 7-char form a sha is quoted in, matching the review page's Checks. */
function shortCommit(sha: string): string {
  return sha.slice(0, 7)
}

/** One verify command's line in the `ran` block. */
function gateCommandNote(ticketId: string, result: GateCommandResult): string {
  const outcome =
    result.outcome === 'passed'
      ? 'passed'
      : result.outcome === 'failed'
        ? `FAILED (exit ${result.exitCode ?? 'unknown'})`
        : `couldn't run (${result.reason ?? 'no reason recorded'})`
  return `- \`${result.command}\` — ${outcome} · output: \`${reviewGateLogPath(ticketId, result.log)}\``
}

/**
 * The `{{GATE_NOTES}}` block: what the server's own gate run found on the
 * feature branch (gates-mode-review decisions #1, #5, #7), and the failures the
 * project already produces without this lap's help.
 *
 * The reviewer used to be told to run the verify commands itself — in the
 * human's checkout, which is still on the base branch, so every "gates passed"
 * proved only that the base was green. The server now runs them against the
 * branch's tip in a sandbox before the agent starts, and this block hands over
 * that record instead: the reviewer runs nothing, and reads the captured output
 * and the branch to explain a failure.
 *
 * The implementers were handed the same baseline through `buildVerifyNotes`,
 * but in the opposite voice — theirs says which failures are "yours to fix", and
 * a reviewer fixes nothing. Same facts, read for a different purpose: what the
 * reviewer needs from the baseline is what to subtract.
 *
 * `knownFailures` is resolved project-first ({@link resolvePreparedSettings}),
 * exactly as the gate run's commands are: it is normally stored on the project
 * row, so reading the global config alone would lose it.
 */
export function buildGateNotes(
  gateRun: ReviewGateRun,
  ticketId: string,
  config: Pick<RuncastleConfig, 'verifyCommands' | 'knownFailures'>,
  project?: { verifyCommands?: string | null; knownFailures?: string | null } | null,
): string {
  const failures = resolvePreparedSettings(config, project).knownFailures
  const out: string[] = []

  switch (gateRun.status) {
    case 'none_configured':
      out.push(
        'This project has no verify commands configured, so there are no gates and the server ran none. Do not go hunting for them — say so in one line of your digest and spend the whole of Gates mode on the diff.',
      )
      break
    case 'couldnt_run':
      out.push(
        `The server could not run the gates on the feature branch${gateRun.commit ? ` at \`${shortCommit(gateRun.commit)}\`` : ''}: ${gateRun.reason}.`,
        ...(gateRun.log ? [`Its captured output is at \`${reviewGateLogPath(ticketId, gateRun.log)}\`.`] : []),
        '',
        "That is an observation about the environment, not a defect against the branch: report it as an observation, say plainly in your digest that the gates did not run, and carry on with the review. Never describe the gates as passed.",
      )
      break
    case 'ran':
      out.push(
        `Before you started, the server ran this project's verify commands once each on the feature branch at \`${shortCommit(gateRun.commit)}\`, in a sandbox with the branch checked out and its dependencies installed:`,
        '',
        ...gateRun.commands.map((result) => gateCommandNote(ticketId, result)),
        '',
        "A failed command is a defect against the branch, with the command as its repro: read its output file, then read the branch (`git diff` / `git show`) to explain what broke it. A command that couldn't run is an observation, not a defect.",
      )
      break
  }

  out.push('')

  if (failures) {
    out.push(
      "These already fail on this repo without this lap's help:",
      '',
      '```',
      failures,
      '```',
      '',
      "Subtract that baseline: a failure inside it is not this lap's and is not a finding. A failure outside it is one this lap introduced, and it is the finding worth the human's attention above every other.",
    )
  } else {
    out.push(
      "No pre-existing-failure baseline is configured, so a red gate may well predate this lap. Check whether the failure touches the diff before writing it up as this lap's.",
    )
  }

  out.push(
    '',
    "**Do not run any verify command yourself.** You are in the human's checkout, on the base branch outside a drive, so anything you run there tests the base's code, not this branch's. The server's run above is the gate result.",
  )

  return out.join('\n')
}

/**
 * Everything the review agent reports back through, kept OUT of the repo: the
 * agent works in the human's real checkout, so a `DIGEST.md` written at its root
 * would be an untracked file in their tree — and the drive refuses to start on a
 * dirty tree.
 */
interface ReviewArtifacts {
  dir: string
  /** The run-scoped runcastle MCP server, in both the forms a runtime can take it. */
  mcp: BurnAgentMcp
  digestPath: string
  blockedPath: string
  /** Where a browser review points `agent-browser record start`. */
  walkthroughPath: string
}

export interface ReviewDirectoryFs {
  readonly mkdir: (path: string, options: { recursive: true }) => unknown
  readonly readDir: (path: string) => string[]
  readonly rename: (oldPath: string, newPath: string) => unknown
  readonly remove: (path: string, options: { recursive: true; force: true }) => unknown
}

export interface PrepareReviewDirectoryOptions {
  readonly now?: () => number
  readonly fs?: Partial<ReviewDirectoryFs>
}

const REVIEW_DIRECTORY_FS: ReviewDirectoryFs = {
  mkdir: mkdirSync,
  readDir: readdirSync,
  rename: renameSync,
  remove: rmSync,
}

/** Wipe one attempt's artifacts, preserving progress when Windows locks a child file. */
export function prepareReviewDirectory(
  dir: string,
  options: PrepareReviewDirectoryOptions = {},
): void {
  const fs = { ...REVIEW_DIRECTORY_FS, ...options.fs }
  const parent = dirname(dir)
  const stalePrefix = `${basename(dir)}.stale-`

  try {
    for (const sibling of fs.readDir(parent)) {
      if (!sibling.startsWith(stalePrefix)) continue
      try {
        fs.remove(join(parent, sibling), { recursive: true, force: true })
      } catch {
        // A previous recorder may still hold this corpse; the next pass retries it.
      }
    }
  } catch {
    // The parent need not exist on the first review attempt.
  }

  try {
    fs.remove(dir, { recursive: true, force: true })
  } catch (removeError) {
    const staleDir = `${dir}.stale-${(options.now ?? Date.now)()}`
    try {
      fs.rename(dir, staleDir)
    } catch (renameError) {
      throw new Error(
        `Review directory ${dir} is held open by another process and could not be moved aside. ` +
        'Kill the agent-browser daemon with taskkill /PID <pid> /T /F, then retry.',
        { cause: renameError instanceof Error ? renameError : removeError },
      )
    }
  }
  fs.mkdir(dir, { recursive: true })
}

export interface PrepareReviewArtifactsDirectoryOptions extends PrepareReviewDirectoryOptions {
  readonly recorderReap?: typeof reapRecorder
}

/** Reap the deterministic session before touching the directory it may hold open. */
export async function prepareReviewArtifactsDirectory(
  ticketId: string,
  dir: string = reviewDir(ticketId),
  options: PrepareReviewArtifactsDirectoryOptions = {},
): Promise<void> {
  await (options.recorderReap ?? reapRecorder)(ticketId)
  prepareReviewDirectory(dir, options)
}

async function writeReviewArtifacts(
  ticket: Ticket,
  runId: string,
  config: RuncastleConfig,
  recorderReap: typeof reapRecorder = reapRecorder,
): Promise<ReviewArtifacts> {
  const dir = reviewDir(ticket.id)
  // A re-burn of the same ticket must not inherit the last attempt's DIGEST.md
  // or BLOCKED.md — that is how a failed review reports success.
  await prepareReviewArtifactsDirectory(ticket.id, dir, { recorderReap })
  const mcpConfigPath = join(dir, 'mcp.json')
  const mcpConfig = renderRunMcpConfig(runId, config)
  writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), 'utf8')
  return {
    dir,
    // The file is what Claude Code reads; the values are what Codex takes as
    // `-c` overrides. Same server, same `X-Runcastle-Run` header, either way.
    mcp: { path: mcpConfigPath, config: mcpConfig },
    digestPath: join(dir, 'DIGEST.md'),
    blockedPath: join(dir, 'BLOCKED.md'),
    walkthroughPath: reviewWalkthroughPath(ticket.id),
  }
}

/**
 * Whether a stream event means the pass has already delivered and is now
 * re-deriving it. Sandcastle numbers iterations from 1, so an event tagged 2 or
 * higher is a fresh `claude --print` against the same prompt, and a `DIGEST.md`
 * on disk says the iteration before it finished the review.
 *
 * It exists because the completion signal is a marker the agent has to PRINT:
 * one that writes it into its digest instead of its final message leaves
 * sandcastle nothing to see, and the loop re-runs the whole pass up to
 * `burnMaxIterations` times — observed as a verification re-deriving everything
 * three times over, full test suite each time. The digest is the evidence
 * sandcastle cannot read, so this path watches for it and fires the ticket's own
 * abort; the harvest below then reads success off the file exactly as it would
 * have, because it already treats what the agent LEFT as the outcome.
 *
 * Review-side only. On the implementation path a second iteration is the point —
 * an implementer picks up its own half-done work — so nothing there may stop on
 * a digest.
 *
 * The existence check is injected so the decision can be unit-tested; the caller
 * passes nothing. Iteration is checked first, so iteration 1's every text chunk
 * costs no filesystem call.
 */
export function shouldStopAfterDigest(
  iteration: number,
  digestPath: string,
  fileExists: (path: string) => boolean = existsSync,
): boolean {
  return iteration >= 2 && fileExists(digestPath)
}

/**
 * Give the drive slot back, whatever happened. The agent is told to stop what it
 * started, but an agent that crashed — or that ended its turn holding the slot —
 * would otherwise leave the human's checkout parked on the feature branch with a
 * dev server running and the machine-wide slot taken.
 *
 * Never fails the ticket: the review's outcome is what it is, and a teardown
 * that could not complete is the drive's problem to report, not this path's.
 */
async function releaseDriveQuietly(): Promise<void> {
  try {
    await releaseReviewDrive()
  } catch {
    /* best-effort — the ticket's outcome stands */
  }
}

export interface ReviewDeps {
  config: RuncastleConfig
  token: string | undefined
  model: ModelEntry
  /**
   * The run's docs digest, already built (and already charged to the timeline)
   * once for the whole burn. Re-reading it here would be the thirteenth
   * transmission of the same bytes in one run.
   */
  docsDigest: string
  /**
   * What every implementer in this burn said it did. The template used to tell
   * the reviewer it was "the only agent in the burn that can answer" what
   * landed; it never was, and the two things a diff cannot express — what
   * surprised each implementer, and what each left undone — live only here.
   */
  lapDigests: readonly HarvestedDigest[]
  /** System boundaries overridden only by seam-level workflow tests. */
  runAgent?: (options: RunOptions) => Promise<unknown>
  runGates?: typeof runReviewGates
  recorderReap?: typeof reapRecorder
  releaseDrive?: () => Promise<void>
}

/**
 * The server's gate run for this pass, against the feature branch's tip as it
 * stands now (gates-mode-review decisions #1, #4). Never throws for a broken
 * environment — a branch that will not resolve comes back `couldnt_run`, like a
 * sandbox that will not open, and the review proceeds on the diff (decision 3).
 */
async function runBranchGates(ctx: WorkflowCtx, ticket: Ticket, deps: ReviewDeps): Promise<ReviewGateRun> {
  const { project, feature } = ctx
  const sha = await headSha(project.repoPath, feature.branch)
  if (!sha) {
    return {
      status: 'couldnt_run',
      commit: '',
      reason: `\`${feature.branch}\` did not resolve to a commit`,
      log: null,
    }
  }
  // Loaded lazily: review-gates imports ticket-burner, which imports this file,
  // so a static import evaluates review-gates before ticket-burner's constants
  // exist whenever ticket-burner is the one loaded first (as at server boot).
  try {
    const runGates = deps.runGates ?? (await import('./review-gates')).runReviewGates
    return await runGates({ config: deps.config, project, ticketId: ticket.id, sha })
  } catch (err) {
    // The runner records its own failures; anything that still escapes it is
    // no less an environment fault, and must not stop the reviewer launching.
    return {
      status: 'couldnt_run',
      commit: sha,
      reason: `the gate run failed: ${err instanceof Error ? err.message : String(err)}`,
      log: null,
    }
  }
}

/**
 * Run one review ticket to a terminal outcome, and put its `ticket.timing` on
 * the event log however it ends — including the two refusals below, which end
 * the ticket before an agent ever starts. A review used to emit no timing at
 * all, which left every reader of a review's duration reconstructing it from
 * the append-only log file (see {@link buildTicketTiming}).
 */
export async function executeReviewTicket(
  ctx: WorkflowCtx,
  ticket: Ticket,
  deps: ReviewDeps,
): Promise<TicketOutcome> {
  const startedAt = Date.now()
  const timer = createToolTimer(deps.model.runtime)
  try {
    return await reviewTicketOutcome(ctx, ticket, deps, timer)
  } finally {
    emitTicketTiming(ctx, ticket, buildTicketTiming(timer.summary(), startedAt, Date.now()))
  }
}

/**
 * The review itself. The sandcastle boundary, so not exercised by unit tests —
 * the pure units around it (prompt rendering, the artifacts the agent is handed,
 * the PATH probe, the outcome shapes) are.
 */
async function reviewTicketOutcome(
  ctx: WorkflowCtx,
  ticket: Ticket,
  deps: ReviewDeps,
  timer: ReturnType<typeof createToolTimer>,
): Promise<TicketOutcome> {
  const { project, feature } = ctx

  // The diff is taken against the branch this feature forked from, so without a
  // recorded base there is no diff to review — and no main line to substitute,
  // which is precisely the substitution that used to review the wrong commits.
  if (!feature.baseBranch) {
    return couldNotReview(
      ticket,
      `feature ${feature.slug} has no recorded base branch, so there is nothing to diff \`${feature.branch}\` against.`,
    )
  }

  const artifacts = await writeReviewArtifacts(ticket, ctx.runId, deps.config, deps.recorderReap)
  // After the directory wipe above (its logs live inside it) and before the
  // prompt, so every pass — review or verification, Drive or Gates — is handed
  // the branch's gate record at its tip as it stands now.
  const gateRun = await runBranchGates(ctx, ticket, deps)
  ctx.updateTicket(ticket.id, { reviewGateRun: gateRun })
  const allTickets = ctx.listTickets?.() ?? ctx.tickets
  const verifies = allTickets
    .filter((candidate) => candidate.kind === 'review' && candidate.id !== ticket.id && candidate.status === 'done')
    .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0) || a.seq - b.seq)
    .at(-1)
  const inheritedMode = ticket.passKind === 'verification' ? inheritedReviewMode(verifies?.reviewMode) : undefined
  const { browserPath, browserFailure, ffmpegPath } = probeDriveHost()
  if (browserFailure) console.error(`[review] ${AGENT_BROWSER_BIN} failed its health check: ${browserFailure}`)
  // The one sentence that serves both the prompt and the pass's record: the
  // agent is told why Drive is closed, and the ticket row keeps the same reason
  // so the trail can say why the lap ran Gates (decision 8).
  const withheldReason = driveWithheldReason(browserPath, project.devCommand, browserFailure, ffmpegPath)
  const offeredMode: 'drive' | 'gates' = inheritedMode === 'gates' || withheldReason ? 'gates' : 'drive'
  const prompt = renderReviewPrompt(ticket, {
    TICKET_JSON: buildTicketJson(ticket),
    FEATURE_BRIEF: buildFeatureBrief(feature),
    DOCS_DIGEST: deps.docsDigest,
    LAP_DIGESTS: buildLapDigestsBlock(deps.lapDigests),
    FEATURE_BRANCH: feature.branch,
    // The base the branch forked from, read off the feature rather than guessed
    // — a feature cut from `develop` used to be diffed against main, which reads
    // every commit develop is behind main as this feature's work. The agent runs
    // with `branchStrategy: {type:'head'}` in the human's own checkout, where
    // HEAD is still the base branch at step 1 — the merge that landed the lap
    // fast-forwards the feature REF without any checkout, and the runner detached
    // the talk worktree — so the template's old `<base>...HEAD` diff was empty on
    // a perfectly healthy lap, and its own failure criterion then made it report
    // "could not review".
    BASE_BRANCH: feature.baseBranch,
    DRIVE_AVAILABILITY: buildDriveAvailability(browserPath, project.devCommand, inheritedMode, browserFailure, ffmpegPath),
    DRIVE_INSTRUCTIONS: buildDriveInstructions(project.driveInstructions),
    GATE_NOTES: buildGateNotes(gateRun, ticket.id, deps.config, project),
    DIGEST_PATH: artifacts.digestPath,
    BLOCKED_PATH: artifacts.blockedPath,
    WALKTHROUGH_PATH: artifacts.walkthroughPath,
    LANDED_FIXES: ticket.context,
    VERIFIES_PASS: verifies ? `#${verifies.seq} · ${inheritedMode === 'drive' ? 'Drive' : 'Gates'} mode` : 'no earlier review in this run · Gates mode',
    AUTO_FIX_CAP: String(AUTO_FIX_CAP),
  })

  mkdirSync(logsDir(), { recursive: true })
  const throttle = createStreamThrottle((e) => ctx.emitEvent({ ...e, ticketId: ticket.id }))
  beginTranscript(ticket.id)
  const ticketAbort = registerTicketAbort(ticket.id)
  const onStreamEvent = (event: AgentStreamEvent): void => {
    throttle.onEvent(event)
    timer.onEvent(event)
    if (event.type === 'text') {
      appendTranscript(ticket.id, { kind: 'text', text: event.message })
    } else if (event.type === 'toolCall') {
      appendTranscript(ticket.id, {
        kind: 'tool',
        text: event.formattedArgs ?? '',
        name: event.name,
      })
    }
    if (!ticketAbort.signal.aborted && shouldStopAfterDigest(event.iteration, artifacts.digestPath)) {
      ticketAbort.abort(new Error('the review already wrote its digest'))
    }
  }

  const signal = AbortSignal.any([ctx.signal, ticketAbort.signal])

  const options: RunOptions = {
    // Always the host build, whatever `config.sandbox` says about implementation
    // tickets: the app, its database and its browser only exist out here.
    agent: buildBurnAgent(deps.config, deps.token, deps.model, {
      onHost: true,
      mcp: artifacts.mcp,
      hostEnv: {
        AGENT_BROWSER_SESSION: `review-${ticket.id}`,
        AGENT_BROWSER_IDLE_TIMEOUT_MS: '1800000',
      },
    }),
    // What a stop actually kills. The abort above only interrupts sandcastle's
    // fiber; the `claude.cmd` shim it spawned — and the node grandchild doing
    // the work — keep running. Released in the `finally` below, when there is
    // nothing left to kill.
    sandbox: noSandbox({ onChildSpawn: registerHostChildren(ticket.id, { runId: ctx.runId }) }),
    cwd: project.repoPath,
    prompt,
    // `head`: no worktree, no temp branch, no merge — sandcastle runs the agent
    // in the checkout as it stands, which is where the review drive puts the
    // integrated feature branch.
    branchStrategy: { type: 'head' },
    signal,
    name: `ticket-${ticket.seq}-review`,
    maxIterations: deps.config.burnMaxIterations,
    logging: {
      type: 'file',
      path: join(logsDir(), `review-${feature.id}-${ticket.seq}.log`),
      onAgentStreamEvent: onStreamEvent,
    },
  }

  let runError: unknown
  let cancellationError: unknown
  let recorderConfirmed = true
  const reopenDrive = withheldReason ? withholdDrive(ctx.runId, withheldReason) : undefined
  try {
    await (deps.runAgent ?? run)(options)
  } catch (err) {
    if (ctx.signal.aborted) cancellationError = err // run cancelled — the runner finalizes it
    else runError = err
  } finally {
    reopenDrive?.()
    releaseTicketAbort(ticket.id)
    killRegistry().release(ticket.id)
    throttle.flush()
    endTranscript(ticket.id)
    try {
      recorderConfirmed = (await (deps.recorderReap ?? reapRecorder)(ticket.id)).confirmed
    } catch {
      // The real reap never rejects; preserve that contract for injected/system failures too.
      recorderConfirmed = false
    }
    // Before the harvest below, so the review is never read off a machine the
    // drive still holds.
    if (deps.releaseDrive) await deps.releaseDrive()
    else await releaseDriveQuietly()
  }

  const recorderNote = recorderConfirmed ? '' : '; recorder may still be running'
  if (cancellationError !== undefined) {
    if (!recorderConfirmed) {
      throw new Error(
        `${errorHeadline(cancellationError instanceof Error ? cancellationError.message : String(cancellationError))}${recorderNote}`,
        { cause: cancellationError },
      )
    }
    throw cancellationError
  }

  // The outcome is read off what the agent LEFT, not off how its process ended
  // — the same rule the implementation path applies to commits. An agent that
  // wrote its digest reviewed the feature, whatever `run()` did on the way out.
  const blocked = readAgentFile([artifacts.dir], 'BLOCKED.md')?.trim()
  const digest = harvestDigest([artifacts.dir])
  if (blocked) return couldNotReview(ticket, `${blocked}${recorderNote}`, digest)
  if (runError !== undefined && digest === undefined) {
    return couldNotReview(
      ticket,
      ticketAbort.signal.aborted
        ? `stopped by user${recorderNote}`
        : `the review agent died: ${errorHeadline(runError instanceof Error ? runError.message : String(runError))}${recorderNote}`,
    )
  }
  // Ran to completion: done, with no commits, because a review never writes
  // code. Its findings are already stored, each defect's fix ticket already
  // minted — the scheduler admits them the moment this outcome lands.
  const resolution = resolveReviewDeclaration(digest, {
    webmExists: existsSync(reviewWalkthroughPath(ticket.id)),
    offeredMode,
    ...(withheldReason ? { driveWithheldReason: withheldReason } : {}),
  })
  const composedDigest = composeReviewDigest(ticket.lap, resolution, digest)
  const storedDigest = recorderConfirmed
    ? composedDigest
    : composedDigest
      ? `${composedDigest}\n\n**Recorder may still be running.**`
      : '**Recorder may still be running.**'
  return {
    status: 'done',
    commits: [],
    ...(storedDigest ? { digest: storedDigest } : {}),
    reviewMode: resolution.reviewMode,
    reviewVerdict: resolution.reviewVerdict,
    reviewVerdictReason: resolution.reason,
  }
}

/**
 * The failure shape, and the only one this path has: the review could not run.
 * The reason goes in the digest as well as the error so it survives into the run
 * digest, where the human reads what the burn produced.
 */
function couldNotReview(ticket: Ticket, reason: string, digest?: string): TicketOutcome {
  const headline = `Review could not run: ${reason}`
  return {
    status: 'failed',
    error: `ticket ${ticket.seq}: ${headline}`,
    digest: digest ? `${digest}\n\n**${headline}**` : `**${headline}**`,
  }
}
