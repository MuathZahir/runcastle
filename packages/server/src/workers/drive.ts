import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  type DriveWorkerKind,
  type Feature,
  type Project,
  type PromptDisplay,
  type SessionKind,
  type SessionRow,
  type WorkerRow,
  DEFAULT_RUNTIME,
  isDriveWorkerKind,
  resolveModelEntry,
} from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { workers } from '../db/schema'
import type { AppCtx } from '../db/types'
import { GateError } from '../errors'
import { renderDriveFixPrompt, renderScenarioFollowUp, renderScenarioPrompt } from '../launcher/artifacts'
import { chatKickoffHeader } from '../launcher/launcher'
import {
  createSessionRow,
  getSessionRow,
  kickoffLineFor,
  newestThread,
  resumeCapExceeded,
  setSessionTitle,
  setThreadPurpose,
  transcriptBytes,
} from '../launcher/sessions'
import { requireNotDraft } from '../services/features'
import * as git from '../services/git'
import { deliverToLead } from '../services/lead-delivery'
import { tagRuncastlePrompt } from '../services/lead-prompt'
import { mainChatContext } from '../services/main-chat-excerpt'
import { rosterConfig } from '../services/model-discovery'
import { getFeatureRow, projectForFeature, requireProjectById, tryGetFeature } from '../services/repo'
import { listScenarioPaths } from '../services/scenarios'
import { hasThreadLog } from '../threads/log'
import { agentHost } from '../threads/types'
import { sandboxEngine } from './engine'
import { isHostReview } from './review'
import { emitWorker, getWorker, humanWrote, listProjectWorkers, listWorkers, setStatus, updateWorker } from './service'

/**
 * Drive workers (docs/features/drive-chats-become-workers): the Fix-drive chat
 * and the scenario chat docked beside a test drive, as workers of kind
 * `fix-drive` and `scenario`. They run on the host, in the human's checkout the
 * drive switched to (decision 1), under the drive chats' guards (decision 9);
 * only the human starts or talks to one (decision 6), and nothing of theirs
 * waits to land (decision 3).
 */

/** Why the lead's land, send back, drop and message tools refuse a drive worker (decisions 3, 6). */
export const DRIVE_WORKER_REFUSAL = 'a drive worker commits straight onto the driven branch and only the human talks to it'

/**
 * A worker that runs on the host, with no sandbox, branch or preview: a drive
 * review (burns-become-workers decision 3), or a drive worker (decision 1).
 */
export function isHostWorker(w: Pick<WorkerRow, 'kind' | 'reviewMode'>): boolean {
  return isHostReview(w) || isDriveWorkerKind(w.kind)
}

/** The drive worker a `worker` session is the conversation of, if it is one. */
export function driveWorkerOf(ctx: AppCtx, session: Pick<SessionRow, 'id' | 'kind'> | undefined): (WorkerRow & { kind: DriveWorkerKind }) | undefined {
  if (session?.kind !== 'worker') return undefined
  const w = ctx.db.select().from(workers).where(eq(workers.id, session.id)).get()
  return w && isDriveWorkerKind(w.kind) ? { ...w, kind: w.kind } : undefined
}

/**
 * The kind the edit, install and checkout guards judge a session as (decision
 * 9): a drive worker's conversation is guarded exactly as the drive chat it
 * replaces (`fix-drive` as `drive-fix`, `scenario` as `scenario`); every other
 * session as its own kind. The session's `purpose` still says `scenario-setup`.
 */
export function guardKindOf(ctx: AppCtx, session: Pick<SessionRow, 'id' | 'kind'>): SessionKind {
  const w = driveWorkerOf(ctx, session)
  if (!w) return session.kind
  return w.kind === 'fix-drive' ? 'drive-fix' : 'scenario'
}

// --- starting and resuming ------------------------------------------------------

/** What each drive worker is called, what it is for, and the button that starts it. */
const DRIVE_WORKER: Record<DriveWorkerKind, { label: string; purpose: string; button: string }> = {
  'fix-drive': { label: 'Fix drive', purpose: "Fixes this drive's setup", button: 'Fix drive' },
  scenario: { label: 'Scenarios', purpose: "Writes and fixes this drive's scenarios", button: 'New scenario' },
}

/** A drive button pressed (decision 5): "Fix drive" on a feature's failed drive, or "New scenario" / "Fix it" on a running one. */
export type DriveWorkerPress =
  | { kind: 'fix-drive'; featureId: string }
  | { kind: 'scenario'; projectId: string; description?: string; fixFile?: string }

/** The drive a press acts on, the feature that owns it (none on a project drive), and what the human asked. */
interface PressedDrive {
  project: Project
  feature?: Feature
  drive: git.DriveInfo
  /** What this press asks of the worker, said after any opening. */
  ask: string
  /** What the human reads of the press in the worker's chat. */
  summary: string
}

/** Today's guard of the Fix drive button: a drive of this very feature whose setup failed, whose failure is the whole ask. */
function fixDrivePress(ctx: AppCtx, featureId: string): PressedDrive {
  const feature = getFeatureRow(ctx, featureId)
  requireNotDraft(feature)
  const project = projectForFeature(ctx, feature)
  const drive = git.activeDriveInfo(project.id)
  if (drive?.featureId !== feature.id || !drive.hookFailure) {
    throw new GateError(
      `no failed drive to fix on ${feature.slug} — Fix drive works from a drive ` +
        'whose setup failed, and carries that failure as its whole brief. Start a drive first.',
    )
  }
  const f = drive.hookFailure
  const ask = [
    `The human pressed Fix drive: the \`${f.phase}\` hook of the drive on \`${drive.branch}\` failed ` +
      `(\`${f.command}\`, ${f.timedOut ? 'timed out' : `exited ${f.exitCode ?? 'without a code'}`}). Its output (tail):`,
    '',
    '```',
    f.output.length > 0 ? f.output : '(the command produced no output)',
    '```',
  ].join('\n')
  return { project, feature, drive, ask, summary: "The test drive's setup failed; you pressed Fix drive" }
}

/** Today's guard of New scenario and Fix it: a human feature drive or a project drive whose app answers. */
function scenarioPress(ctx: AppCtx, input: Extract<DriveWorkerPress, { kind: 'scenario' }>): PressedDrive {
  const project = requireProjectById(ctx, input.projectId)
  const drive = git.activeDriveInfo(project.id)
  const humanDrive = drive && (drive.projectDrive || (drive.featureId && drive.purpose === 'human'))
  if (!drive || !humanDrive || !drive.devReady || !git.scenarioDriveEnv(ctx, project.id)) {
    throw new GateError(
      'a scenario session lands scenarios on a running test drive, so it needs a human test drive ' +
        'or project drive whose app is answering — start one and wait for Open app.',
    )
  }
  const fixFailure = input.fixFile && drive.scenario?.file === input.fixFile ? drive.scenario.failure : undefined
  const asked = renderScenarioFollowUp({
    description: input.description,
    fix: input.fixFile ? { file: input.fixFile, failure: fixFailure } : undefined,
  })
  return {
    project,
    ...(drive.featureId ? { feature: getFeatureRow(ctx, drive.featureId) } : {}),
    drive,
    ask: asked ?? 'The human opened the scenario chat. Ask them what state they want to land in.',
    summary: input.fixFile
      ? `You pressed Fix it on ${input.fixFile}`
      : input.description
        ? `You asked for a new scenario: ${input.description}`
        : 'You opened the scenario chat',
  }
}

/**
 * A drive button pressed (decisions 2, 5, 13): find the drive's owner's worker
 * of that kind — the feature's on a feature drive, the project's on a project
 * drive — or start one, set it working and send it the ask. Every press, in
 * this drive or a later one, resumes the same worker and its conversation,
 * until its conversation grows past the resume cap and a fresh one takes over.
 * Refused while the owner's other drive worker is working (decision 13).
 *
 * The press is the human writing to it (decision 8): no silent hello, and an
 * account hold lifts. A drive worker takes no slot (decision 7).
 */
export async function startDriveWorker(ctx: AppCtx, press: DriveWorkerPress): Promise<{ sessionId: string; resumed: boolean }> {
  const pressed = press.kind === 'fix-drive' ? fixDrivePress(ctx, press.featureId) : scenarioPress(ctx, press)
  const { project, feature, drive } = pressed
  const owned = feature ? listWorkers(ctx, feature.id) : listProjectWorkers(ctx, project.id)
  const busy = owned.find((w) => isDriveWorkerKind(w.kind) && w.kind !== press.kind && w.status === 'working')
  if (busy) throw new GateError(`${busy.label} is working — wait for it to finish`)

  const prior = resumable(ctx, owned.filter((w) => w.kind === press.kind).at(-1))
  const w = prior ?? createDriveWorker(ctx, press.kind, project, feature, drive.branch)
  // A new drive starts its tally of commits afresh; a resumed one carries on (decision 5).
  const newDrive = !prior || prior.status === 'handed-back'
  setStatus(ctx, w, 'working')
  const working = updateWorker(ctx, w.id, {
    featureBranch: drive.branch,
    ...(newDrive ? { handbackCommits: [], handbackFiles: [] } : {}),
  })
  if (newDrive || !turnBases.has(w.id)) await noteTurnBase(project, working)
  const row = getSessionRow(ctx, w.id) as SessionRow
  if (press.kind === 'scenario') {
    // Setup mode (drive-scenarios decision 5), decided at each press: a project's first scenarios set up the folder.
    setThreadPurpose(ctx, w.id, existsSync(join(project.repoPath, '.runcastle', 'scenarios')) ? null : 'scenario-setup')
    // `run_scenario` lands only for the conversation docked beside the drive.
    git.attachScenarioSession(project.id, w.id)
  }
  emitWorker(ctx, working, prior ? 'worker.reopened' : 'worker.started', `worker "${w.label}" ${prior ? 'reopened' : 'started'} on the host, for the drive on ${drive.branch}`, {
    sessionId: w.id,
    kind: press.kind,
    startedBy: 'human',
    branch: drive.branch,
  })
  humanWrote(ctx, row)
  const opening = prior ? undefined : openingOf(ctx, press.kind, feature, row)
  const text = opening ? `${opening}\n\n${pressed.ask}` : pressed.ask
  await agentHost(ctx).prompt(w.id, { text }, { source: 'runcastle', display: { summary: pressed.summary } })
  return { sessionId: w.id, resumed: !!prior }
}

/**
 * The owner's latest drive worker of a kind, when it can carry on: neither
 * failed nor dropped, and its conversation not past the resume cap. One past
 * the cap is left in Done for a fresh one.
 */
function resumable(ctx: AppCtx, w: WorkerRow | undefined): WorkerRow | undefined {
  if (!w || w.status === 'failed' || w.status === 'dropped') return undefined
  const row = getSessionRow(ctx, w.id)
  // Only the transcript's size is judged: a worker's thread is one row for life, so there are no ended rows to count re-entries by.
  const capped = row?.ccSessionId ? resumeCapExceeded({ bytes: transcriptBytes(row), reentries: 0 }) : null
  if (!capped) return w
  const done = setStatus(ctx, w, 'handed-back')
  emitWorker(ctx, done, 'worker.resume_capped', `worker "${w.label}" starts fresh — ${capped.detail}`, { ...capped })
  return undefined
}

/** A new drive worker: its thread in the project's checkout on the drive chats' model, and its record. */
function createDriveWorker(ctx: AppCtx, kind: DriveWorkerKind, project: Project, feature: Feature | undefined, branch: string): WorkerRow {
  const { label, purpose } = DRIVE_WORKER[kind]
  // The drive chats' step (decision 9): host-side work in the developer's checkout.
  const model = resolveModelEntry('prepare', rosterConfig(ctx), project)
  const mainChat = feature ? newestThread(ctx, { featureId: feature.id }, 'chat') : null
  const session = createSessionRow(ctx, {
    ...(feature ? { featureId: feature.id } : { projectId: project.id }),
    kind: 'worker',
    worktreePath: project.repoPath,
    model,
    ...(mainChat ? { openedBeside: mainChat.id } : {}),
  })
  setSessionTitle(ctx, session.id, label)
  const now = Date.now()
  ctx.db
    .insert(workers)
    .values({
      id: session.id,
      featureId: feature?.id ?? null,
      projectId: project.id,
      label,
      purpose,
      kind,
      goal: purpose,
      doneWhen: null,
      model: model.id,
      runtime: model.runtime,
      startedBy: 'human',
      status: 'working',
      engine: sandboxEngine(ctx.config.sandbox).name,
      featureBranch: branch,
      handbackCommits: [],
      handbackFiles: [],
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return getWorker(ctx, session.id) as WorkerRow
}

/**
 * What a new drive worker's conversation opens with, ahead of the ask: today's
 * kickoff line of the chat it replaces, and on a feature drive's Scenarios
 * worker the feature's state and the lead's latest turns, as the scenario chat
 * opened.
 */
function openingOf(ctx: AppCtx, kind: DriveWorkerKind, feature: Feature | undefined, row: SessionRow): string {
  const runtime = row.runtime ?? DEFAULT_RUNTIME
  const line = kickoffLineFor(kind === 'fix-drive' ? 'drive-fix' : 'scenario', undefined, runtime)
  if (kind === 'fix-drive' || !feature) return line
  return mainChatContext(ctx, feature, row.id, chatKickoffHeader(ctx, feature, runtime, line))
}

// --- the briefing ---------------------------------------------------------------

/**
 * A drive worker's briefing on the host, written each time its process starts
 * (`acpLaunchInput`): today's drive-fix or scenario brief from the drive as it
 * stands, then the worker's rules. With no drive to read (the drive stopped,
 * the setup no longer fails) the brief says so instead of refusing the start.
 */
export async function driveWorkerBriefing(
  ctx: AppCtx,
  w: WorkerRow & { kind: DriveWorkerKind },
  row: Pick<SessionRow, 'purpose'>,
  project: Project,
): Promise<string> {
  const feature = w.featureId ? (tryGetFeature(ctx, w.featureId) ?? undefined) : undefined
  const drive = git.activeDriveInfo(project.id)
  const brief = w.kind === 'fix-drive' ? await fixDriveBrief(project, feature, drive) : await scenarioBrief(ctx, project, feature, drive, row)
  return `${brief}\n${workerRules(w, feature, drive, row)}`
}

async function fixDriveBrief(project: Project, feature: Feature | undefined, drive: git.DriveInfo | null): Promise<string> {
  if (!feature || drive?.featureId !== feature.id || !drive.hookFailure) {
    return [
      '# runcastle — fixing the test drive',
      '',
      "No drive of this feature is failing right now. Wait for the human's ask; Fix drive brings you the next failure.",
      '',
    ].join('\n')
  }
  return renderDriveFixPrompt({
    project,
    feature,
    failure: drive.hookFailure,
    envKeys: drive.envKeys ?? [],
    delta: await git.featureBranchDelta(project, feature),
  })
}

async function scenarioBrief(
  ctx: AppCtx,
  project: Project,
  feature: Feature | undefined,
  drive: git.DriveInfo | null,
  row: Pick<SessionRow, 'purpose'>,
): Promise<string> {
  const driveEnv = git.scenarioDriveEnv(ctx, project.id)
  if (!drive || !driveEnv) {
    return [
      '# runcastle — scenarios',
      '',
      "No test drive is running, so there is nothing to land a scenario on. Wait for the human's next drive.",
      '',
    ].join('\n')
  }
  return renderScenarioPrompt({
    project,
    ...(feature ? { feature } : {}),
    branch: drive.branch,
    identity: driveEnv.identity,
    envOverlay: driveEnv.envOverlay,
    driveUrl: drive.devUrl,
    runner: project.scenarioRunner ?? undefined,
    files: await listScenarioPaths(project.repoPath, 'HEAD'),
    setup: row.purpose === 'scenario-setup',
  })
}

/** How a drive worker works as a worker (decisions 3, 5, 6, 9): who talks to it, what it commits, naming the branch, handing back. */
function workerRules(
  w: WorkerRow & { kind: DriveWorkerKind },
  feature: Feature | undefined,
  drive: git.DriveInfo | null,
  row: Pick<SessionRow, 'purpose'>,
): string {
  const branch = drive?.branch ?? w.featureBranch
  const parent = feature ? "the feature's lead" : 'the project chat (the orchestrator)'
  const writes =
    w.kind === 'scenario' && row.purpose === 'scenario-setup'
      ? 'anywhere in this checkout, while you set scenarios up'
      : '`.runcastle/` and `.gitignore` only'
  return [
    '## You are a worker',
    `You are the "${w.label}" worker of ${feature ? `the feature ${feature.title}` : 'this project'}, started by the human from the drive's ` +
      `"${DRIVE_WORKER[w.kind].button}" button. You run on the human's own machine, in this checkout, on \`${branch}\`, the branch the drive holds.`,
    '',
    `- **Only the human talks to you.** ${parent[0]?.toUpperCase()}${parent.slice(1)} reads your handback and never writes to you.`,
    `- **Commit only what your guard allows**: ${writes}. Stage those files and commit; never switch branches, reset or push.`,
    `- **After every commit, say in the chat which branch it landed on** (\`${branch}\`)` +
      (drive?.projectDrive ? ': on a project drive that is the checkout\'s current branch, which may be the base branch.' : '.'),
    '- **When the human is done, or says so**, call `hand_back` with a short summary (what you did, what is left), then end your turn. ' +
      `Your commits are already on the branch: nothing waits to land, and ${parent} reads the handback when it next works.`,
    ...(w.kind === 'fix-drive' ? ['- **Once `retry_drive` has the app answering again**, tell the human it is up and call `hand_back`.'] : []),
    '',
  ].join('\n')
}

// --- the commits it made (decision 3) -------------------------------------------

/** Each drive worker's driven-branch tip when its current turn began: its commits are what the branch gained since. */
const turnBases = new Map<string, string>()

async function noteTurnBase(project: Project, w: WorkerRow): Promise<void> {
  const tip = await git.headSha(project.repoPath, w.featureBranch)
  if (tip) turnBases.set(w.id, tip)
  else turnBases.delete(w.id)
}

/** The checkout a drive worker works in: its project's. */
function projectOf(ctx: AppCtx, w: WorkerRow): Project {
  return requireProjectById(ctx, w.projectId)
}

/**
 * A drive worker's turn ended: add the commits the driven branch gained during
 * it, and the files they touched, to what the worker made in this drive (its
 * row's handback commits and files). Read off the branch, not the checkout's
 * HEAD, so a checkout switched back at the drive's end is never mistaken for
 * the worker's work. Without a recorded start (a server restart lost it) it
 * records nothing for that turn.
 */
export async function recordDriveTurnCommits(ctx: AppCtx, w: WorkerRow): Promise<WorkerRow> {
  const project = projectOf(ctx, w)
  const base = turnBases.get(w.id)
  await noteTurnBase(project, w)
  const tip = turnBases.get(w.id)
  if (!base || !tip || base === tip) return w
  const changes = await git.branchChangesAhead(project.repoPath, base, tip)
  if (!changes.commits.length) return w
  const commits = [...(w.handbackCommits ?? [])]
  for (const c of changes.commits) {
    const line = `${c.sha.slice(0, 7)} ${c.subject}`
    if (!commits.includes(line)) commits.push(line)
  }
  const files = [...new Set([...(w.handbackFiles ?? []), ...changes.files])]
  const next = updateWorker(ctx, w.id, { handbackCommits: commits, handbackFiles: files })
  emitWorker(ctx, next, 'worker.committed', `worker "${w.label}" committed ${changes.commits.length} on ${w.featureBranch}`, {
    branch: w.featureBranch,
    commits: changes.commits.length,
  })
  return next
}

/** Forget a drive worker's turn start (tests: as a restarted server has none). */
export function forgetDriveTurnBasesForTests(): void {
  turnBases.clear()
}

// --- the handback (decision 4) --------------------------------------------------

/** What the lead (or the project chat) reads of a drive worker's handback: the branch, its commits and files, and that nothing waits on it. */
function driveHandbackText(w: WorkerRow): string {
  const commits = w.handbackCommits ?? []
  const files = w.handbackFiles ?? []
  return [
    `Drive worker "${w.label}" handed back (worker ${w.id}). Its commits are already on ${w.featureBranch}: nothing waits to land, ` +
      'and only the human talks to it. Nothing to do unless it changes your plans.',
    '',
    w.handbackSummary ?? '',
    '',
    `Commits on ${w.featureBranch} during this drive:`,
    ...(commits.length ? commits.map((c) => `- ${c}`) : ['- none']),
    ...(files.length ? ['', `Files: ${files.join(', ')}`] : []),
  ].join('\n')
}

/**
 * Put a handed-back drive worker's card in its parent's chat without waking it
 * (decision 4): the feature's lead through its delivery, as news; a project
 * drive's worker in the project's newest orchestrator chat, held for its next
 * prompt. A project with no orchestrator chat under way keeps only the event.
 */
export async function deliverDriveHandback(ctx: AppCtx, w: WorkerRow): Promise<void> {
  const text = driveHandbackText(w)
  const display: PromptDisplay = {
    handback: {
      workerId: w.id,
      label: w.label,
      kind: w.kind,
      summary: w.handbackSummary ?? '',
      commits: w.handbackCommits ?? [],
      files: w.handbackFiles ?? [],
      threadId: w.id,
      branch: w.featureBranch,
    },
  }
  if (w.featureId !== null) {
    const feature = tryGetFeature(ctx, w.featureId)
    if (feature) await deliverToLead(ctx, feature, { text, source: 'runcastle', display, reason: 'news' })
    return
  }
  const chat = newestThread(ctx, { projectId: w.projectId }, 'project')
  if (!chat || !(chat.ccSessionId || hasThreadLog(chat.id))) return
  await agentHost(ctx).prompt(chat.id, { text: tagRuncastlePrompt(text) }, { source: 'runcastle', hold: true, display })
}
