import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type Feature,
  type Project,
  type ReviewFinding,
  type ReviewFindingInput,
  type ReviewVerify,
  type ReviewWorkerMode,
  type RuncastleConfig,
  type WorkerRow,
  resolvePreparedSettings,
  workerFeatureId,
} from '@runcastle/core'
import { featureDocsRel, reviewWalkthroughPath, sessionDir } from '@runcastle/core/paths'
import { and, desc, eq } from 'drizzle-orm'
import { workers } from '../db/schema'
import type { AppCtx } from '../db/types'
import { GateError, InvalidInputError } from '../errors'
import { LINK_WHAT_YOU_NAME } from './link-rule'
import { resolveSkillsRoot } from '../launcher/skills-root'
import { releaseReviewDrive, reviewDrive, reviewDriveFor } from '../services/git'
import { reapRecorder } from '../services/recorder-reap'
import { listByFeature as listFindings, reportFinding } from '../services/review-findings'
import { startSaw } from '../services/review-saw'
import { listFeatureScenarios } from '../services/scenarios'
import { buildDriveInstructions, buildScenarioBlock, driveWithheldReason, probeDriveHost } from '../services/drive-host'
import type { HandbackNote } from './worker'

/**
 * The Review worker (burns-become-workers decisions 3–5): the end-of-feature
 * review as a worker of kind `review`. A **drive** review runs on the host, in
 * the human's checkout while the review drive holds the project's one drive
 * slot; a **gates** review runs on the host too, reading the feature's own
 * folder (workers-build-in-the-feature-s-folder decision 9). Either runs the
 * project's checks itself, reports findings as it goes, and hands back with the
 * Review Package. A **verify** review (either mode) is given only the findings
 * the lead fixed and the commits that fixed them.
 *
 * This file holds what is the review's own: its mode, the drive it holds, its
 * assignment and briefing, and the handback a host review writes. The worker
 * service runs its life.
 */

/** The label a Review worker shows under. */
export function reviewLabel(verify: ReviewVerify | null): string {
  return verify ? 'Review: verify' : 'Review'
}

/** A drive review: it runs in the human's checkout, with no branch or preview of its own. */
export function isHostReview(w: Pick<WorkerRow, 'kind' | 'reviewMode'>): boolean {
  return w.kind === 'review' && w.reviewMode === 'drive'
}

// --- the drive a host review holds ----------------------------------------------

/** Whether the review drive started: or why not, and whether waiting can clear it (another drive holds the slot). */
export type DriveTaken = { ok: true } | { ok: false; retriable: boolean; reason: string }

/**
 * The host a drive review runs on: whether it can drive at all, and the
 * project's drive slot it takes and gives back. The real one is the human's
 * machine (the review drive in `services/git.ts`); tests put in a fake.
 */
export interface ReviewDriveHost {
  /** Why this host cannot drive a review of `project` (no browser, recorder or dev command), or undefined when it can. */
  withheld(project: Project): string | undefined
  /** Take the project's drive slot with the feature branch checked out, its environment set up and its dev server started. */
  take(ctx: AppCtx, project: Project, feature: Feature): Promise<DriveTaken>
  /** Give the slot back if this feature's review drive holds it, and stop the review's recorder (keyed by `passId`). */
  give(project: Project, feature: Feature, passId: string): Promise<void>
}

const machine: ReviewDriveHost = {
  withheld(project) {
    const probe = probeDriveHost()
    return driveWithheldReason(probe.browserPath, project.devCommand, probe.browserFailure, probe.ffmpegPath)
  },
  async take(ctx, project, feature) {
    const started = await reviewDrive(ctx, project, feature, 'start', driveReviewOf(ctx, feature.id))
    if (started.ok) return { ok: true }
    return { ok: false, retriable: started.retriable ?? false, reason: started.deniedReason ?? 'the review drive would not start' }
  },
  async give(project, feature, passId) {
    await reapRecorder(passId)
    if (reviewDriveFor(project.id, feature.id)) await releaseReviewDrive(project.id)
  },
}

/**
 * The feature's drive review still at work, which is the one taking the drive
 * (triage-batch decision 5): the drive names it and opens its chat. The newest,
 * should an older one linger.
 */
export function driveReviewOf(ctx: AppCtx, featureId: string): { id: string; label: string } | undefined {
  const w = ctx.db
    .select({ id: workers.id, label: workers.label, reviewMode: workers.reviewMode, status: workers.status })
    .from(workers)
    .where(and(eq(workers.featureId, featureId), eq(workers.kind, 'review')))
    .orderBy(desc(workers.createdAt))
    .all()
    .find((row) => row.reviewMode === 'drive' && (row.status === 'working' || row.status === 'queued' || row.status === 'needs-you'))
  return w ? { id: w.id, label: w.label } : undefined
}

let host: ReviewDriveHost = machine

/** Put a fake host behind drive reviews (`undefined` restores the human's machine). */
export function setReviewDriveHostForTests(fake: ReviewDriveHost | undefined): void {
  host = fake ?? machine
}

export function reviewDriveHost(): ReviewDriveHost {
  return host
}

/**
 * The mode a review starts in: the one the lead picked (one-file-per-feature
 * decision 9), with no default. A drive asked for on a host that cannot drive
 * the project is refused with why.
 */
export function chooseReviewMode(project: Project, requested: ReviewWorkerMode): ReviewWorkerMode {
  if (requested === 'gates') return 'gates'
  const withheld = host.withheld(project)
  if (withheld) throw new GateError(`a drive review cannot run here: ${withheld} Start a gates review (read the diff) instead.`)
  return 'drive'
}

// --- the assignment ---------------------------------------------------------------

function reviewAsset(file: string): string {
  return join(resolveSkillsRoot(dirname(fileURLToPath(import.meta.url))), 'review', file)
}

/** Fill `{{KEY}}` placeholders; a key the template names and `values` lacks is a bug, so it throws. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => {
    const value = values[key]
    if (value === undefined) throw new Error(`review template placeholder {{${key}}} has no value`)
    return value
  })
}

/** Drop the leading `<!-- … -->` note a template carries for its maintainers. */
function withoutNote(template: string): string {
  return template.replace(/^<!--[\s\S]*?-->\s*/, '')
}

/**
 * The `{{CHECKS}}` block: the project's verify commands and the failures it
 * already has, for the reviewer to run itself (decision 5). Resolved project
 * first, as every prepared setting is.
 */
export function buildChecksBlock(
  config: Pick<RuncastleConfig, 'setupCommand' | 'verifyCommands' | 'knownFailures'>,
  project: Pick<Project, 'verifyCommands' | 'knownFailures'>,
): string {
  const { verifyCommands, knownFailures } = resolvePreparedSettings(config, project)
  const commands = verifyCommands
    ? ['```', verifyCommands, '```']
    : [
        'This project has no verify commands recorded. Find its checks the way its own docs and scripts say (the typecheck and the tests ' +
          'its `package.json`, `Makefile` or CI config name), run those, and say in your hand-back which you ran.',
      ]
  const baseline = knownFailures
    ? ["These already fail on this repo, before this feature: subtract them. A failure inside this list is not the feature's.", '', '```', knownFailures, '```']
    : ["No known failures are recorded, so a red check may predate this feature: check whether the failure touches the feature's diff before reporting it as the feature's."]
  return [...commands, '', ...baseline].join('\n')
}

/** The lead's full checks, green on a clean tree apart from the known failures: the commit they ran on and the commands. */
export interface ChecksPassed {
  commit: string
  commands: string[]
}

/**
 * The `{{PRIOR_CHECKS}}` block (faster-cheaper-reviews decisions 3, 7, 8): how a
 * review tells whether the lead's pass still holds for its checkout, and what it
 * runs either way. The server checks nothing; the review runs the git commands.
 * Empty without a pass, so the section reads as it always did.
 */
export function buildPriorChecksBlock(checksPassed: ChecksPassed | null | undefined, featureSlug: string): string {
  if (!checksPassed) return ''
  const sha = checksPassed.commit.trim()
  const docs = `${featureDocsRel(featureSlug)}/`
  return [
    '',
    '',
    "### The lead's checks already passed",
    '',
    `The lead ran these commands on commit \`${sha}\`, on a clean tree, and they were green apart from the known failures:`,
    '',
    '```',
    ...checksPassed.commands.map((c) => c.trim()),
    '```',
    '',
    'Before you run any check, see whether that pass holds for your checkout. Run:',
    '',
    '```',
    'git rev-parse HEAD',
    'git status --porcelain --untracked-files=no',
    `git diff --quiet ${sha} HEAD -- . ':!${docs}'`,
    '```',
    '',
    `The pass holds when \`git status\` prints nothing (the tree is clean) and either HEAD is \`${sha}\` or the \`git diff\` exits 0 (nothing changed since, outside this feature's docs folder \`${docs}\`). ` +
      'Then run only the typecheck among the checks above, and none if no check is a typecheck. ' +
      `Say in your hand-back that the other checks were not run, citing the lead's pass on \`${sha}\`. ` +
      'Never describe a check you cite as one you saw pass.',
    '',
    "Otherwise the pass does not hold: run every check in full, as above, and say in your hand-back why the lead's pass did not apply.",
  ].join('\n')
}

/** The findings a verify review is given, each with what it needs to re-run it. */
function findingsBlock(findings: ReviewFinding[]): string {
  return findings
    .map((f) =>
      [
        `### ${f.title} (\`${f.id}\`, ${f.severity})`,
        '',
        `- Location: ${f.location}`,
        `- Citation: ${f.citation}`,
        `- Detail: ${f.detail}`,
        `- Repro step: ${f.reproStep || '(none recorded)'}`,
      ].join('\n'),
    )
    .join('\n\n')
}

/** The findings a verify review names, each of this feature; refused when one is not. */
export function verifyFindings(ctx: AppCtx, featureId: string, verify: ReviewVerify): ReviewFinding[] {
  const all = listFindings(ctx, featureId)
  return verify.findingIds.map((id) => {
    const finding = all.find((f) => f.id === id)
    if (!finding) throw new InvalidInputError(`no finding ${id} on this feature — get_feature_context lists its findings`)
    return finding
  })
}

/** Where a review runs, as its assignment names its tools and paths. */
export interface ReviewSite {
  mode: ReviewWorkerMode
  /** The pass id its walkthrough is kept under: the worker's own id. */
  passId: string
}

/**
 * A Review worker's assignment: the review template (or, for a verify review,
 * the verify template carrying only its findings and fix commits) with the
 * mode's block, the project's checks and the feature filled in. Sent as its
 * first prompt.
 */
export async function renderReviewAssignment(
  ctx: AppCtx,
  feature: Feature,
  project: Project,
  site: ReviewSite,
  verify: ReviewVerify | null,
  checksPassed?: ChecksPassed | null,
): Promise<string> {
  const base = feature.baseBranch ?? 'main'
  const shared = {
    FEATURE_BRANCH: feature.branch,
    BASE_BRANCH: base,
    CHECKS: buildChecksBlock(ctx.config, project),
    PRIOR_CHECKS: buildPriorChecksBlock(checksPassed, feature.slug),
    PRIOR_CHECKS_UNLESS: checksPassed ? ", unless the lead's pass below lets you cite it" : '',
    MODE_NAME: site.mode === 'drive' ? 'Drive' : 'Gates',
  }
  const mode =
    site.mode === 'drive'
      ? fill(readFileSync(reviewAsset('review-drive.md'), 'utf8'), {
          ...shared,
          DRIVE_INSTRUCTIONS: buildDriveInstructions(project.driveInstructions),
          SCENARIOS: await listFeatureScenarios(project, feature).then(({ scenarios, runnerConfigured }) =>
            buildScenarioBlock(scenarios, runnerConfigured),
          ),
          WALKTHROUGH_PATH: reviewWalkthroughPath(site.passId),
        })
      : fill(readFileSync(reviewAsset('review-gates.md'), 'utf8'), shared)
  if (verify) {
    return fill(withoutNote(readFileSync(reviewAsset('verify.md'), 'utf8')), {
      ...shared,
      MODE: mode.trim(),
      FINDINGS: findingsBlock(verifyFindings(ctx, feature.id, verify)),
      FIX_COMMITS: verify.commits.length ? verify.commits.map((c) => `- ${c}`).join('\n') : '- none named',
    })
  }
  return fill(withoutNote(readFileSync(reviewAsset('review.md'), 'utf8')), {
    ...shared,
    MODE: mode.trim(),
    FEATURE: `**${feature.title}** (\`${feature.slug}\`): ${feature.oneLiner}`,
    READ_FEATURE: site.mode === 'drive' ? 'get_feature_context' : 'read_feature',
  })
}

/** Where a Review worker's assignment is kept, beside its thread log: its first prompt, and its opening again should its conversation start over. */
function assignmentPath(workerId: string): string {
  return join(sessionDir(workerId), 'review-assignment.md')
}

/** Keep a Review worker's assignment, and open the log its pictures are kept in. */
export function keepReviewAssignment(workerId: string, assignment: string): void {
  mkdirSync(sessionDir(workerId), { recursive: true })
  writeFileSync(assignmentPath(workerId), assignment, 'utf8')
  startSaw(workerId)
}

/** A Review worker's assignment as it was given; a line pointing at the feature when it is gone. */
export function reviewAssignment(workerId: string): string {
  const path = assignmentPath(workerId)
  return existsSync(path) ? readFileSync(path, 'utf8') : 'Review this feature: read it with your tools, run its checks, report what you find and hand back.'
}

/** Where a drive review waiting for the drive slot keeps the prompt it sends once it has it: beside its thread log. */
function driveWaitPath(workerId: string): string {
  return join(sessionDir(workerId), 'drive-wait.txt')
}

/** Keep the prompt a drive review waits to send, so a restart that loses the wait can arm it again. */
export function keepDriveWait(workerId: string, text: string): void {
  mkdirSync(sessionDir(workerId), { recursive: true })
  writeFileSync(driveWaitPath(workerId), text, 'utf8')
}

/** The prompt a drive review was waiting to send, or undefined when it was not waiting. */
export function driveWaitOf(workerId: string): string | undefined {
  const path = driveWaitPath(workerId)
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

/** The drive review stopped waiting: it took the drive, failed or was dropped. */
export function forgetDriveWait(workerId: string): void {
  rmSync(driveWaitPath(workerId), { force: true })
}

// --- the briefing -----------------------------------------------------------------

/**
 * A gates review's briefing on the host (workers-build-in-the-feature-s-folder
 * decision 9): it reads the committed feature branch in the feature's own
 * folder, where the lead works too, and writes no code.
 */
export function hostGatesReviewBriefing(w: Pick<WorkerRow, 'label' | 'featureBranch'>, folder: string): string {
  return [
    `# You are a runcastle worker: ${w.label}`,
    '',
    `Your lead (the agent running this feature) started you to review it. You run on the human's own machine, in the feature's folder, ${folder}, on ${w.featureBranch}. ` +
      'The human can open this conversation at any time and type to you.',
    '',
    '## How you work',
    "- You write no code and make no commits: leave the folder exactly as you found it. Never switch its branch, reset it, or use git stash: your lead works in this folder too, and runcastle refuses them.",
    "- Runcastle's tools for you: report_finding (one review finding), hand_back, show_file (a file into this chat), get_feature_context and read_feature_doc (the feature's state and docs).",
    `- ${LINK_WHAT_YOU_NAME}`,
    "- Your assignment says what to review and how. Run the project's checks yourself, as it says.",
    '- To hand back, call hand_back with your account, as your assignment says. Then end your turn.',
  ].join('\n')
}

/** A drive review's briefing on the host: its system prompt. */
export function hostReviewBriefing(w: Pick<WorkerRow, 'label' | 'featureBranch'>, repoPath: string): string {
  return [
    `# You are a runcastle worker: ${w.label}`,
    '',
    "Your lead (the agent running this feature) started you to review it. You run on the human's own machine, in the project's checkout, " +
      `${repoPath}, which runcastle's review drive holds on ${w.featureBranch} for you. The human can open this conversation at any time and type to you.`,
    '',
    '## How you work',
    "- You write no code and make no commits: leave the human's checkout exactly as you found it, and never switch its branch.",
    "- Runcastle's tools for you: review_drive (the running app: status, scenarios, calls and screenshots), report_finding (one review finding), " +
      "hand_back, show_file (a file into this chat), get_feature_context and read_feature_doc (the feature's state and docs).",
    `- ${LINK_WHAT_YOU_NAME}`,
    "- Your assignment says what to review and how. Run the project's checks yourself, as it says.",
    '- To hand back, call hand_back with your account, as your assignment says. Then end your turn: runcastle gives the drive back.',
  ].join('\n')
}

/**
 * What a drive review's agent process runs with beyond its session: the browser
 * session its screenshots are taken from, and nothing else of agent-browser's.
 *
 * Any other agent-browser setting here would differ from the server's own calls
 * on the same session (the capture, the recorder's stop and close), and
 * agent-browser 0.41 relaunches a session whose launch settings differ: an idle
 * timeout set only here made every capture shoot a fresh blank page and cut the
 * walkthrough short. The daemon's own idle default (1h) is what both sides use.
 */
export function hostReviewEnv(workerId: string): Record<string, string> {
  return { AGENT_BROWSER_SESSION: `review-${workerId}` }
}

// --- its findings -----------------------------------------------------------------

/**
 * `report_finding` from a Review worker: recorded
 * against the worker (decision 4), refused unless it is a review at work. It
 * mints no fix ticket: the lead decides what each defect becomes.
 */
export function reportReviewFinding(ctx: AppCtx, workerId: string, input: ReviewFindingInput): { finding: ReviewFinding } {
  const w = ctx.db.select().from(workers).where(eq(workers.id, workerId)).get()
  if (!w || w.kind !== 'review') throw new GateError('report_finding belongs to a Review worker, and this caller is not one')
  if (w.status !== 'working' && w.status !== 'needs-you') {
    throw new GateError(`report_finding needs a review at work, and "${w.label}" is ${w.status}`)
  }
  return reportFinding(ctx, { featureId: workerFeatureId(w), reviewWorker: w, input })
}

// --- a host review's handback -------------------------------------------------------

/** Where a drive review's `hand_back` leaves its account until its turn ends: beside its thread log. */
function hostHandbackPath(workerId: string): string {
  return join(sessionDir(workerId), 'handback.json')
}

/** Record a drive review's handback, read when its turn ends. */
export function writeHostHandback(workerId: string, summary: string): void {
  mkdirSync(sessionDir(workerId), { recursive: true })
  writeFileSync(hostHandbackPath(workerId), JSON.stringify({ summary, at: Date.now() } satisfies HandbackNote), 'utf8')
}

/** The handback a drive review wrote since the last one taken, removed as it is read so one handback wakes the lead once. */
export function takeHostHandback(workerId: string): HandbackNote | undefined {
  const path = hostHandbackPath(workerId)
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as HandbackNote
  } catch {
    return undefined
  } finally {
    rmSync(path, { force: true })
  }
}

// --- what the lead reads of it ----------------------------------------------------

/** What the lead reads when a Review worker hands back: its account, its findings, and what to do with them. */
export function reviewHandbackText(w: Pick<WorkerRow, 'id' | 'label' | 'handbackSummary'>, findings: ReviewFinding[]): string {
  const defects = findings.filter((f) => f.kind === 'defect')
  return [
    `Review worker "${w.label}" handed back (worker ${w.id}); its Review Package is in your chat.`,
    '',
    w.handbackSummary ?? '',
    '',
    `Findings it reported (${findings.length}):`,
    ...(findings.length ? findings.map((f) => `- [${f.kind}, ${f.severity}] ${f.title} (${f.id})`) : ['- none']),
    '',
    defects.length
      ? 'Next: fix the defects you judge real (yourself or with workers) and close each with resolve_finding (`addressed` or `dismissed`, with a note). ' +
        'Only after a large fix set (more than a handful of findings, or fixes that reached into code the feature had not touched) ' +
        'start a verify review, start_review({ mode, verify: { findingIds, commits } }); after a small one, passing checks and your skim are enough. ' +
        `send_back_worker({ workerId: "${w.id}", note }) asks this review for more; drop_worker({ workerId: "${w.id}" }) closes it.`
      : `Next: nothing to fix. send_back_worker({ workerId: "${w.id}", note }) asks this review for more; drop_worker({ workerId: "${w.id}" }) closes it.`,
  ].join('\n')
}
