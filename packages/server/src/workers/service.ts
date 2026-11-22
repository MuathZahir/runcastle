import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { and, count, eq, inArray, isNull, ne } from 'drizzle-orm'
import {
  type Ask,
  type Feature,
  type ModelEntry,
  type PromptDisplay,
  type ReviewVerify,
  type ReviewWorkerMode,
  type SessionRow,
  type ThreadEvent,
  type WorkerKind,
  type WorkerRow,
  type WorkerStartedBy,
  type WorkerStatus,
  type ShownWorkerStatus,
  shownWorkerStatus,
  IN_PLAY_WORKER_STATUSES,
  isDriveWorkerKind,
  isUsageLimitText,
  workerFeatureId,
  workerPlacement,
  type Project,
  modelEntryFor,
  resolveBurnCacheMode,
  resolveModelEntry,
  resolvePreparedSettings,
  resolveSandboxImage,
} from '@runcastle/core'
import { envPath, sessionDir } from '@runcastle/core/paths'
import { features, projects, sessions, workers } from '../db/schema'
import type { AppCtx } from '../db/types'
import { GateError, NotFoundError } from '../errors'
import { chatKickoffHeader, ensureFeatureWorktree } from '../launcher/launcher'
import { createSessionRow, getLimitHold, getSessionRow, newestThread, setSessionTitle } from '../launcher/sessions'
import { type AgentErrorClass, classifyAgentError, retryDelayMs } from '../services/agent-errors'
import { agentSlots } from '../services/agent-slots'
import { emit, emitProject, listAfter } from '../services/events'
import { activeTestDriveFeatureId, addWorkerWorktree, branchChangesAhead, deleteTempBranch, discardWorktree, mergeTempBranch, type TempBranchMergeResult } from '../services/git'
import { featureLandingQueue } from '../services/landing-queue'
import { deliverToLead } from '../services/lead-delivery'
import { clearWait, setWait } from '../services/waits'
import { mainChatExcerpt } from '../services/main-chat-excerpt'
import { rosterConfig } from '../services/model-discovery'
import { getFeatureRow, projectForFeature, tryGetFeature } from '../services/repo'
import { requireAnnotatedModels } from '../services/tickets'
import type { AgentTransport, StallBounds, TurnEnding } from '../threads/host'
import type { StopReason } from '../threads/types'
import { claudeTranscriptPath } from '../threads/side-channels'
import { agentHost, readThreadEvents } from '../threads/types'
import { appendThreadEvent } from '../threads/log'
import { seedFromTranscript } from '../threads/read'
import { isOverwritable } from '../services/findings'
import { adoptProjectImage, releaseProjectImage } from '../services/project-image'
import { readTranscriptUsage } from '../services/usage'
import { detectPackageManager, readRepoToolchain } from '../services/repo-toolchain'
import { burnCacheDirectories, burnCacheEnv, burnCacheVolumeName } from './burn-cache'
import type { BurnImageCtx } from './burn-image'
import { sandboxEngine } from './engine'
import { type WorkerPreviews, workerPreviewPath } from '../routes/design-pass-paths'
import { phoneDesignPort } from '../services/phone-link'
import { IDLE_STOP_MS } from '../threads/host'
import type { WorkerPermissionMode } from './permissions'
import { codexHomeDir } from '../services/codex-auth'
import { codexSetup } from './codex-setup'
import { pickFreePort, workerMcpServer } from './sandbox'
import { type WorkerSetup, claudeSetup, setupFingerprint } from './setup-copy'
import { workerTools } from './tools'
import {
  type ChecksPassed,
  chooseReviewMode,
  driveWaitOf,
  forgetDriveWait,
  isHostReview,
  keepDriveWait,
  keepReviewAssignment,
  renderReviewAssignment,
  reviewAssignment,
  reviewDriveHost,
  reviewHandbackText,
  reviewLabel,
  takeHostHandback,
  verifyFindings,
} from './review'
import { listByFeature as listFindings } from '../services/review-findings'
import { DRIVE_WORKER_REFUSAL, deliverDriveHandback, isHostWorker, noteWorkerTurnBase, recordDriveTurnCommits } from './drive'
import { type HandbackNote, type HostWorkerPlace, type NewSandboxInput, type WorkerBrief, type WorkerSandbox, workerBriefing, workerOrigin, workersDir } from './worker'
import { WORKER_CONTAINER_PREFIX } from './ownership'
import { mayStartInBackground } from '../services/database-copy'
import { threadNeed } from '../threads/read'

/**
 * Interactive workers (docs/features/interactive-workers): a feature's lead
 * hands a piece of work to a worker, a thread of kind `worker` whose agent runs
 * in its own sandbox on its own branch. The record is a `workers` row keyed by
 * the thread's session id. A handback read at turn end wakes the lead once; the
 * lead lands the worker's branch, sends the work back, or drops the worker.
 * Every mutation here emits a `worker.*` event with the worker's id and status.
 */

// --- the record -----------------------------------------------------------------

// The table's columns are typed by core's worker enums, so a selected row is a `WorkerRow` as it stands.

export function getWorker(ctx: AppCtx, id: string): WorkerRow | undefined {
  return ctx.db.select().from(workers).where(eq(workers.id, id)).get()
}

/**
 * Where a worker's chat lives (chats-link-to-what-they-name): its feature's id
 * and slug, for a `worker:<id>` link in an agent's chat. Null for an id the app
 * has no record of, for a project's own worker (owned by no feature), and for
 * a worker of another project, whose link must not open inside this one. A
 * landed or dropped worker keeps its row, so it still resolves.
 */
export function locateWorker(ctx: AppCtx, projectId: string, id: string): { featureId: string; slug: string } | null {
  const w = getWorker(ctx, id)
  if (!w?.featureId) return null
  const f = tryGetFeature(ctx, w.featureId)
  return f && f.projectId === projectId ? { featureId: f.id, slug: f.slug } : null
}

function requireWorker(ctx: AppCtx, id: string): WorkerRow {
  const w = getWorker(ctx, id)
  if (!w) throw new NotFoundError(`no worker ${id}`)
  return w
}

/** A feature's workers, oldest first. */
export function listWorkers(ctx: AppCtx, featureId: string): WorkerRow[] {
  return ctx.db.select().from(workers).where(eq(workers.featureId, featureId)).orderBy(workers.createdAt).all()
}

/** The project's own workers, owned by no feature (a project drive's Scenarios worker, drive-chats-become-workers decision 2), oldest first. */
export function listProjectWorkers(ctx: AppCtx, projectId: string): WorkerRow[] {
  return ctx.db
    .select()
    .from(workers)
    .where(and(eq(workers.projectId, projectId), isNull(workers.featureId)))
    .orderBy(workers.createdAt)
    .all()
}

/** How many workers of each feature of the project are working or queued: what the feature list shows as at work. */
export function workersWorkingByFeature(ctx: AppCtx, projectId: string): Map<string, number> {
  const rows = ctx.db
    .select({ featureId: workers.featureId, n: count() })
    .from(workers)
    .innerJoin(features, eq(features.id, workers.featureId))
    .where(and(eq(features.projectId, projectId), inArray(workers.status, ['working', 'queued'])))
    .groupBy(workers.featureId)
    .all()
  // The join keeps feature-owned rows only, so every `featureId` here is set.
  return new Map(rows.flatMap((r) => (r.featureId ? [[r.featureId, r.n] as const] : [])))
}

/**
 * Every feature's live workers in the project, oldest first
 * (workers-nest-under-their-feature decision 2): those not handed back, landed
 * or dropped, which the sidebar nests under each feature's row. The project's
 * own workers, owned by no feature, are not among them.
 */
export function listLiveWorkers(ctx: AppCtx, projectId: string): WorkerRow[] {
  return ctx.db
    .select({ w: workers })
    .from(workers)
    .innerJoin(features, eq(features.id, workers.featureId))
    .where(and(eq(features.projectId, projectId), inArray(workers.status, [...IN_PLAY_WORKER_STATUSES])))
    .orderBy(workers.createdAt)
    .all()
    .map((r) => r.w)
}

/**
 * Each feature's build workers for its progress pie: those that carry its work
 * (with you, on its own), not dropped, and how many of them landed. The Review
 * worker and "+" workers carry no share of the build.
 */
export function workerProgressByFeature(ctx: AppCtx, projectId: string): Map<string, { counted: number; landed: number }> {
  const rows = ctx.db
    .select({ featureId: workers.featureId, status: workers.status, n: count() })
    .from(workers)
    .innerJoin(features, eq(features.id, workers.featureId))
    .where(and(eq(features.projectId, projectId), inArray(workers.kind, ['with-you', 'on-its-own'])))
    .groupBy(workers.featureId, workers.status)
    .all()
  const out = new Map<string, { counted: number; landed: number }>()
  for (const r of rows) {
    if (r.status === 'dropped' || !r.featureId) continue
    const p = out.get(r.featureId) ?? { counted: 0, landed: 0 }
    p.counted += r.n
    if (r.status === 'landed') p.landed += r.n
    out.set(r.featureId, p)
  }
  return out
}

/** A worker of `featureId`: refuses another feature's, so a lead acts only on its own workers. */
export function requireFeatureWorker(ctx: AppCtx, featureId: string, id: string): WorkerRow {
  const w = getWorker(ctx, id)
  if (!w || w.featureId !== featureId) throw new NotFoundError(`no worker ${id} on this feature — get_feature_context lists its workers`)
  return w
}

export function updateWorker(ctx: AppCtx, id: string, patch: Partial<Omit<WorkerRow, 'id' | 'createdAt'>>): WorkerRow {
  ctx.db
    .update(workers)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(workers.id, id))
    .run()
  return requireWorker(ctx, id)
}

/** Emit `type` for `w` on its feature's timeline (its project's, for a project-owned worker), with its id and status. */
export function emitWorker(ctx: AppCtx, w: WorkerRow, type: string, message: string, data: Record<string, unknown> = {}): void {
  const e = { type, message, data: { workerId: w.id, label: w.label, status: w.status, ...data } }
  if (w.featureId === null) emitProject(ctx, w.projectId, e)
  else emit(ctx, w.featureId, e)
}

/** The worker's feature, or null when it is the project's own or its feature is gone. */
function featureOf(ctx: AppCtx, w: WorkerRow): Feature | null {
  return w.featureId === null ? null : tryGetFeature(ctx, w.featureId)
}

/** Set a worker's status and say so (`worker.status`); a no-op when it is already there. */
export function setStatus(ctx: AppCtx, w: WorkerRow, status: WorkerStatus): WorkerRow {
  if (w.status === status) return w
  const next = updateWorker(ctx, w.id, { status })
  emitWorker(ctx, next, 'worker.status', `worker "${w.label}" is ${status}`, { from: w.status })
  return next
}

/** A worker thread: the lifecycle hooks and the transport key off the record. */
export function isWorkerThread(ctx: AppCtx, id: string): boolean {
  return getWorker(ctx, id) !== undefined
}

/** The worker's sandbox, once it is up. */
export function sandboxOf(ctx: AppCtx, w: WorkerRow): WorkerSandbox | null {
  if (!w.container || !w.branch || w.previewPort === null) return null
  const feature = getFeatureRow(ctx, workerFeatureId(w))
  return {
    id: w.id,
    engine: w.engine,
    runtime: w.runtime,
    container: w.container,
    repoPath: projectForFeature(ctx, feature).repoPath,
    featureBranch: w.featureBranch,
    branch: w.branch,
    port: w.previewPort,
    previewUrl: humanPreviewUrl(ctx, w.id),
  }
}

/**
 * Where the human opens a worker's preview (decision 15): through runcastle's
 * design pass-through, never the sandbox's own port, so the address works
 * wherever runcastle runs. The web puts the listener's origin as the page
 * sees it in front of {@link workerPreviewPath}; a worker's agent is told this
 * whole address, as the machine runcastle runs on sees it.
 */
export function humanPreviewUrl(ctx: AppCtx, workerId: string): string {
  return `http://localhost:${phoneDesignPort(ctx.config)}${workerPreviewPath(workerId)}`
}

/** Where a host build worker builds, as its briefing tells it (workers-build-in-the-feature-s-folder decisions 2, 3). */
export function hostWorkerPlace(ctx: AppCtx, w: WorkerRow): HostWorkerPlace | undefined {
  const placement = workerPlacement(w)
  if (!placement || !w.folder) return undefined
  return {
    placement,
    folder: w.folder,
    featureBranch: w.featureBranch,
    branch: w.branch,
    port: w.previewPort,
    previewUrl: w.previewPort !== null ? humanPreviewUrl(ctx, w.id) : null,
  }
}

function briefOf(w: WorkerRow): WorkerBrief {
  return { label: w.label, kind: w.kind, goal: w.goal, doneWhen: w.doneWhen }
}

// --- the transport --------------------------------------------------------------

/** The Claude token burns use, from the environment or the data dir's `.env`. */
export function claudeToken(): string {
  const fromEnv = process.env.CLAUDE_CODE_OAUTH_TOKEN
  if (fromEnv) return fromEnv
  const file = envPath()
  if (existsSync(file)) {
    const m = readFileSync(file, 'utf8').match(/^\s*CLAUDE_CODE_OAUTH_TOKEN\s*=\s*"?([^"\r\n]+)"?/m)
    if (m?.[1]) return m[1]
  }
  throw new Error('no CLAUDE_CODE_OAUTH_TOKEN: run `claude setup-token` and put it in the data dir .env')
}

/**
 * Route a worker's thread to its sandbox, woken if it was stopped; every other
 * thread to `base`. Whether a conversation is still on record is asked inside
 * the sandbox, so a reload that fails there is never taken for a conversation
 * gone, and never silently replaced by a new one.
 */
export function withWorkers(ctx: AppCtx, base: AgentTransport): AgentTransport {
  return async (spec, row) => {
    if (row.kind !== 'worker') return base(spec, row)
    const w = requireWorker(ctx, row.id)
    // A host worker (a drive review, a drive worker) runs on the host, in the human's checkout: its launch (`acpLaunchInput`) briefs it there.
    if (isHostWorker(w)) return base(spec, row)
    const sb = sandboxOf(ctx, w)
    if (!sb) throw new Error(`worker "${w.label}" has no sandbox${w.failure ? `: ${w.failure}` : ''}`)
    const launched = sb.runtime === 'claude-code' ? (spec.sessionMeta as { claudeCode?: { options?: { model?: string } } } | undefined)?.claudeCode?.options?.model : undefined
    const model = launched ?? w.model
    const engine = sandboxEngine(w.engine)
    // At its first start, then at a start or wake after the human's setup changed, so a change reaches the
    // worker's next turn (decisions 8, 12) and an unchanged wake skips hundreds of MB of copying.
    const setup = workerSetup(sb, briefOf(w), model)
    // Runcastle's test-suite guard rides every copy for Claude Code workers (decision 13); the setting is in the fingerprint, so flipping it re-copies.
    const guard = sb.runtime === 'claude-code' && ctx.config.burnGuard
    const fingerprint = `${setupFingerprint(setup)}${guard ? '-guard' : ''}`
    if ((await engine.setupFingerprint(sb)) !== fingerprint) await engine.copySetup(sb, setup, fingerprint, { guard })
    const proc = await engine.process(sb, briefOf(w), {
      ...(sb.runtime === 'claude-code' ? { token: claudeToken() } : {}),
      model,
      tools: workerTools(ctx, w, sb, engine),
      onMode: (mode) => notePermissionMode(ctx, w.id, mode),
    })
    return { ...proc, conversationOnDisk: (conversationId) => engine.conversationOnDisk(sb, conversationId) }
  }
}

/** The human's setup for the worker's runtime: Claude Code's from `~`, Codex's from their Codex home with the worker's own config and briefing. */
function workerSetup(sb: WorkerSandbox, brief: WorkerBrief, model: string): WorkerSetup {
  if (sb.runtime === 'claude-code') return claudeSetup(homedir())
  return codexSetup(codexHomeDir(), { model, briefing: workerBriefing(sb, brief), mcp: workerMcpServer(sb.port, sb.previewUrl, brief.kind === 'review') })
}

/** The permission mode each worker last said it runs in, so a mode is recorded once per change, not once per report. */
const modesSaid = new Map<string, WorkerPermissionMode>()

/**
 * Record the permission mode a worker runs in (decision 11) as a
 * `worker.permission_mode` event on its feature's timeline, so the human sees
 * when a worker runs without auto mode.
 */
export function notePermissionMode(ctx: AppCtx, id: string, mode: WorkerPermissionMode): void {
  if (modesSaid.get(id) === mode) return
  const w = getWorker(ctx, id)
  if (!w) return
  modesSaid.set(id, mode)
  emitWorker(
    ctx,
    w,
    'worker.permission_mode',
    mode === 'auto'
      ? `worker "${w.label}" runs in auto mode`
      : `worker "${w.label}" runs without auto mode: free inside its sandbox, asking before any MCP call`,
    { mode },
  )
}

// --- starting -------------------------------------------------------------------

export interface StartWorkerInput {
  label: string
  purpose: string
  kind: WorkerKind
  goal?: string
  doneWhen?: string
  /** One of the human's annotated models; omitted, the `review` step's model for a review, else the chat's. */
  model?: string
  startedBy: WorkerStartedBy
  /** A gates review's (kind `review`): what it verifies, if anything, and its assignment, its first prompt. */
  review?: { verify: ReviewVerify | null; assignment: string }
}

export interface StartedWorker {
  workerId: string
  branch: string
  previewUrl: string
}

/** The plain words a worker start says when no container engine answers (decision 22). */
function noEngineMessage(engine: string): string {
  return (
    `Workers run in a ${engine} sandbox, and ${engine} is not answering on this machine. ` +
    'Start Docker or Podman, then run `runcastle doctor` (the setup check) to see what is missing.'
  )
}

/**
 * The model a worker runs on: an explicit `model` (it must be annotated), else
 * the `review` step for a Review worker and the `chat` step for any other.
 */
function workerModel(ctx: AppCtx, feature: Feature, model: string | undefined, kind: WorkerKind): ModelEntry {
  requireAnnotatedModels(ctx, [model])
  const roster = rosterConfig(ctx)
  if (model?.trim()) return modelEntryFor(model.trim(), roster)
  return resolveModelEntry(kind === 'review' ? 'review' : 'chat', roster, projectForFeature(ctx, feature))
}

/** The short tail of a worker id its container and branch are named by. */
function shortId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '').slice(-10).toLowerCase()
}

/**
 * Record in the lead's chat that it started this worker (calmer-worker-chats
 * decisions 6, 12): a row of its turn's workers card, a snapshot of the worker's
 * label, purpose and kind; the card reads its status live. Only a lead's start
 * makes one: the human's "+" and the drive page's workers are not the lead's.
 * Sending a worker back starts nothing, so it adds no row.
 */
function recordLeadStart(ctx: AppCtx, w: WorkerRow, leadThreadId: string | undefined): void {
  if (w.startedBy !== 'lead' || !leadThreadId) return
  seedFromTranscript(ctx, leadThreadId)
  appendThreadEvent(leadThreadId, {
    type: 'worker_started',
    workerId: w.id,
    label: w.label,
    purpose: w.purpose.trim() || (w.goal ?? '').trim().split('\n', 1)[0]!.trim(),
    kind: w.kind,
  })
}

/**
 * Start a worker on `feature` (workers-build-in-the-feature-s-folder decisions
 * 1, 2, 3, 7): its thread, its record, its folder on the host, then its
 * kickoff. A build worker takes the feature's own folder unless another open
 * worker of the feature holds it; then it gets its own folder and branch, cut
 * from the feature branch's tip, with the project's setup command run there. A
 * gates review reads the feature's folder (decision 9). A folder that cannot
 * be made leaves the worker `failed` with what failed.
 */
export async function startWorker(ctx: AppCtx, feature: Feature, input: StartWorkerInput): Promise<StartedWorker> {
  const model = workerModel(ctx, feature, input.model, input.kind)
  const project = projectForFeature(ctx, feature)
  const mainChat = newestThread(ctx, { featureId: feature.id }, 'chat')
  // Where it builds and its port are picked one start at a time per feature, so two starts never both take the feature's folder or one port.
  const placed = await placeOneAtATime(feature.id, () => placeWorker(ctx, project, feature, input, model, mainChat?.id))
  const { session, folder, branch, own, previewPort } = placed
  if (input.review) keepReviewAssignment(session.id, input.review.assignment)
  if (own && branch) {
    settingUp.add(session.id)
    try {
      await addWorkerWorktree(project.repoPath, folder, branch, feature.branch)
      const setupCommand = resolvePreparedSettings(ctx.config, project).setupCommand
      if (setupCommand) await runSetupCommand(setupCommand, folder)
    } catch (err) {
      settingUp.delete(session.id)
      const failure = err instanceof Error ? err.message : String(err)
      // The worker did no work: its folder and branch go at once (cleans-up decision 4).
      await removeWorkerFolder(ctx, requireWorker(ctx, session.id))
      if (requireWorker(ctx, session.id).status === 'dropped') throw new GateError(`worker "${input.label}" was dropped while its folder was being set up`)
      const failed = updateWorker(ctx, session.id, { status: 'failed', failure: failure.slice(0, 2000) })
      recordLeadStart(ctx, failed, mainChat?.id)
      emitWorker(ctx, failed, 'worker.failed', `worker "${input.label}" could not set up its folder`, { failure })
      throw new GateError(`worker "${input.label}" could not set up its folder: ${failure}`)
    }
    settingUp.delete(session.id)
    // A drop that came while setup ran is honoured now: its folder goes, and no kickoff is sent.
    if (requireWorker(ctx, session.id).status === 'dropped') {
      await removeWorkerFolder(ctx, requireWorker(ctx, session.id))
      throw new GateError(`worker "${input.label}" was dropped while its folder was being set up`)
    }
  }
  const started = requireWorker(ctx, session.id)
  // Its commits land straight on the feature branch: what the branch gains from here is its work (decision 2).
  if (!own) await noteWorkerTurnBase(ctx, started)
  recordLeadStart(ctx, started, mainChat?.id)
  const where = own ? `in its own folder, on ${branch}` : "in the feature's folder"
  emitWorker(ctx, started, 'worker.started', `worker "${input.label}" started ${where}`, {
    sessionId: session.id,
    kind: input.kind,
    startedBy: input.startedBy,
    placement: own ? 'own-folder' : 'feature-folder',
    folder,
    ...(branch ? { branch } : {}),
    ...(previewPort !== null ? { previewUrl: humanPreviewUrl(ctx, session.id) } : {}),
  })
  await agentHost(ctx).prompt(session.id, { text: workerKickoff(ctx, started) }, { source: 'runcastle' })
  return { workerId: session.id, branch: branch ?? feature.branch, previewUrl: humanPreviewUrl(ctx, session.id) }
}

/** Each feature's start in progress: the next waits for it, so placement reads the rows the last one wrote. */
const placing = new Map<string, Promise<unknown>>()

/** Run `place` after any other start of `featureId` has placed its worker. */
async function placeOneAtATime<T>(featureId: string, place: () => Promise<T>): Promise<T> {
  const before = placing.get(featureId) ?? Promise.resolve()
  const run = before.catch(() => undefined).then(place)
  placing.set(featureId, run)
  try {
    return await run
  } finally {
    if (placing.get(featureId) === run) placing.delete(featureId)
  }
}

/**
 * Where a new worker builds (decision 7), its thread, and its row. A build
 * worker takes the feature's folder unless another holds it or a test drive of
 * the feature has it on the human's checkout (where its commits would not reach
 * the feature branch until the drive stops); then it gets its own folder and branch.
 */
async function placeWorker(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
  input: StartWorkerInput,
  model: ReturnType<typeof workerModel>,
  mainChatId: string | undefined,
): Promise<{ session: SessionRow; folder: string; branch: string | null; own: boolean; previewPort: number | null }> {
  const featureFolder = await ensureFeatureWorktree(ctx, project, feature)
  const own =
    input.kind !== 'review' &&
    (featureFolderHolder(ctx, feature.id) !== undefined || activeTestDriveFeatureId(project.id) === feature.id)
  const session = createSessionRow(ctx, {
    featureId: feature.id,
    kind: 'worker',
    worktreePath: featureFolder,
    model,
    ...(mainChatId ? { openedBeside: mainChatId } : {}),
  })
  setSessionTitle(ctx, session.id, input.label)
  const folder = own ? workerFolder(session.id) : featureFolder
  const branch = own ? `runcastle/worker/${shortId(session.id)}` : null
  if (own) ctx.db.update(sessions).set({ worktreePath: folder }).where(eq(sessions.id, session.id)).run()
  // A review shows no screen; a build worker's dev server gets a port of its own, since agents now share the machine (decision 6).
  const previewPort = input.kind === 'review' ? null : await pickFreePort(41000, 400, takenPorts(ctx))
  const now = Date.now()
  ctx.db
    .insert(workers)
    .values({
      id: session.id,
      featureId: feature.id,
      projectId: feature.projectId,
      label: input.label,
      purpose: input.purpose,
      kind: input.kind,
      goal: input.goal?.trim() || null,
      doneWhen: input.doneWhen?.trim() || null,
      model: model.id,
      runtime: model.runtime,
      startedBy: input.startedBy,
      status: 'working',
      engine: sandboxEngine(ctx.config.sandbox).name,
      featureBranch: feature.branch,
      folder,
      branch,
      previewPort,
      ...(input.review ? { reviewMode: 'gates' as const, reviewVerify: input.review.verify } : {}),
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return { session, folder, branch, own, previewPort }
}

/** The statuses in which a worker still holds the folder it works in: at work, waiting on someone, or handed back and not yet settled. */
const HOLDING: ReadonlySet<WorkerStatus> = new Set(['queued', 'working', 'needs-you', 'stalled', 'handed-back'])

/**
 * The open build worker of `featureId` that holds the feature's own folder, if
 * any (decision 7): placed there and not yet landed, dropped or failed. A new
 * build worker started meanwhile gets its own folder. A review never holds it:
 * it only reads, and a handed-back review is resolved, never landed.
 */
export function featureFolderHolder(ctx: AppCtx, featureId: string): WorkerRow | undefined {
  return listWorkers(ctx, featureId).find(
    (w) => w.kind !== 'review' && workerPlacement(w) === 'feature-folder' && HOLDING.has(w.status),
  )
}

/** Where a worker's own folder is made (decision 3): under runcastle's data dir, keyed by the worker. */
export function workerFolder(id: string): string {
  return join(workersDir(), 'folders', id)
}

/** How long the project's setup command may run in a new worker folder before the start fails. */
const SETUP_TIMEOUT_MS = 20 * 60_000

/** Run the project's setup command in a worker's new folder, through the platform's shell; throws with its output's tail when it fails. */
function runSetupCommand(command: string, cwd: string): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(command, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
    let tail = ''
    const keep = (chunk: Buffer): void => {
      tail = (tail + chunk.toString('utf8')).slice(-4000)
    }
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    const timer = setTimeout(() => child.kill(), SETUP_TIMEOUT_MS)
    child.on('error', (err) => {
      clearTimeout(timer)
      fail(new Error(`the setup command \`${command}\` could not run: ${err.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) done()
      else fail(new Error(`the setup command \`${command}\` failed (exit ${code ?? 'killed'}): ${tail.trim().slice(-1500)}`))
    })
  })
}

/**
 * Remove a worker's own folder and its branch (decisions 3, 13). A worker in
 * the feature's folder has none: its commits stay on the feature branch.
 * Best effort: a failure is logged, and the sweep catches a branch left over.
 */
async function removeWorkerFolder(ctx: AppCtx, w: WorkerRow): Promise<void> {
  if (workerPlacement(w) !== 'own-folder' || !w.folder || !w.branch) return
  const repoPath = projectForFeature(ctx, getFeatureRow(ctx, workerFeatureId(w))).repoPath
  if (!(await discardWorktree(repoPath, w.folder))) console.error(`worker ${w.id}: its folder ${w.folder} could not be removed`)
  await deleteTempBranch(repoPath, w.branch)
}

/**
 * Workers whose sandbox is being set up by this server: a drop meanwhile only
 * marks them, and the setup removes what it made when it finishes. A row with
 * a container but no branch that is not in here had its setup cut off (a
 * server killed mid-setup), which the sweep cleans up.
 */
const settingUp = new Set<string>()

/** Whether this server is setting up `id`'s sandbox right now. */
export function isSettingUp(id: string): boolean {
  return settingUp.has(id)
}

/**
 * Remove what a setup that did not finish made: the container (when it ran),
 * the bare copy and the worker branch. Best effort: a failure is logged, and
 * the sweep catches whatever is left.
 */
export async function removeHalfMade(ctx: AppCtx, w: WorkerRow, branch: string): Promise<void> {
  try {
    if (w.container) {
      const repoPath = projectForFeature(ctx, getFeatureRow(ctx, workerFeatureId(w))).repoPath
      const port = w.previewPort ?? 0
      await sandboxEngine(w.engine).remove({
        id: w.id,
        engine: w.engine,
        runtime: w.runtime,
        container: w.container,
        repoPath,
        featureBranch: w.featureBranch,
        branch,
        port,
        previewUrl: humanPreviewUrl(ctx, w.id),
      })
    } else rmSync(workerOrigin(w.id), { recursive: true, force: true })
  } catch (err) {
    console.error(`worker ${w.id}: removing what its setup made`, err)
  }
}

/** The image build's view of a worker start: events on the feature's timeline, the project as the build leaves it, no way to stop it. */
function imageBuildCtx(ctx: AppCtx, feature: Feature, runId: string): BurnImageCtx {
  const read = (): Project => projectForFeature(ctx, feature)
  return {
    runId,
    get project() {
      return read()
    },
    emitEvent: (e) => emit(ctx, feature.id, { type: e.type, message: e.message, ...(e.data !== undefined ? { data: e.data } : {}) }),
    signal: new AbortController().signal,
    projectImage: {
      overwritable: () => isOverwritable(ctx, read().id, 'sandboxImage'),
      adopt: (tag) => adoptProjectImage(ctx, read().id, tag),
      release: () => releaseProjectImage(ctx, read().id),
    },
  }
}

/**
 * What a worker's sandbox is set up with beyond the image (decisions 11, 18): the
 * project's burn cache with its package manager's store (never pnpm's, which
 * cannot hardlink out of a volume the clone is not on: ADR-0004), the CPU cap,
 * and the project's own setup command, run after the install.
 */
function sandboxSetup(ctx: AppCtx, project: Project): Pick<NewSandboxInput, 'cache' | 'cpus' | 'setupCommand'> {
  const pm = detectPackageManager(readRepoToolchain(project.repoPath))
  const setupCommand = resolvePreparedSettings(ctx.config, project).setupCommand
  const cached = resolveBurnCacheMode(ctx.config) === 'volume'
  return {
    ...(cached
      ? {
          cache: {
            volume: burnCacheVolumeName(project.id),
            env: pm && pm !== 'pnpm' ? burnCacheEnv(pm) : {},
            dirs: burnCacheDirectories(pm && pm !== 'pnpm' ? pm : undefined),
          },
        }
      : {}),
    ...(ctx.config.burnCpus !== undefined ? { cpus: ctx.config.burnCpus } : {}),
    ...(setupCommand ? { setupCommand } : {}),
  }
}

/** Ports any worker holds, stopped ones included; a failed one never got its sandbox. */
function takenPorts(ctx: AppCtx): Set<number> {
  const rows = ctx.db.select({ port: workers.previewPort }).from(workers).where(ne(workers.status, 'failed')).all()
  return new Set(rows.flatMap((r) => (r.port === null ? [] : [r.port])))
}

/**
 * The human's "+" (decision 7): a worker with no assignment, which opens on
 * the feature's state and the lead's latest turns and waits for the human.
 */
export function startUnassignedWorker(ctx: AppCtx, featureId: string): Promise<StartedWorker> {
  return startWorker(ctx, getFeatureRow(ctx, featureId), {
    label: 'New worker',
    purpose: 'Started by you',
    kind: 'unassigned',
    startedBy: 'human',
  })
}

// --- the review (burns-become-workers decisions 3–5) ------------------------------

export interface StartReviewInput {
  /** The lead's pick (one-file-per-feature decision 9): `drive` when users would meet the change, `gates` (read the diff) otherwise. */
  mode: ReviewWorkerMode
  /** A verify review's findings and fix commits; omitted for a first review. */
  verify?: ReviewVerify
  /** Omitted, the `review` step's model (the Settings "Review" row). */
  model?: string
  /** The lead's green checks on a clean tree, for the review to cite instead of re-running; stored nowhere. */
  checksPassed?: ChecksPassed
  startedBy: WorkerStartedBy
}

export interface StartedReview {
  workerId: string
  mode: ReviewWorkerMode
  /** A drive review waits for the drive slot while the human drives. */
  status: WorkerStatus
}

/**
 * Start the feature's Review worker (decision 3). A gates review is an ordinary
 * sandboxed worker on the committed feature branch; a drive review is an agent
 * thread on the host, in the project's checkout, that starts once the review
 * drive holds the drive slot and waits `queued` until then.
 */
export async function startReviewWorker(ctx: AppCtx, feature: Feature, input: StartReviewInput): Promise<StartedReview> {
  const project = projectForFeature(ctx, feature)
  const mode = chooseReviewMode(project, input.mode)
  const verify = input.verify ?? null
  if (verify) verifyFindings(ctx, feature.id, verify)
  const label = reviewLabel(verify)
  const purpose = verify ? `Verifies ${verify.findingIds.length} fixed finding(s)` : `${mode === 'drive' ? 'Drives' : 'Reads'} the feature for review`
  if (mode === 'gates') {
    const assignment = await renderReviewAssignment(ctx, feature, project, { mode, passId: '' }, verify, input.checksPassed)
    const started = await startWorker(ctx, feature, {
      label,
      purpose,
      kind: 'review',
      goal: purpose,
      ...(input.model ? { model: input.model } : {}),
      startedBy: input.startedBy,
      review: { verify, assignment },
    })
    return { workerId: started.workerId, mode, status: requireWorker(ctx, started.workerId).status }
  }
  const model = workerModel(ctx, feature, input.model, 'review')
  const mainChat = newestThread(ctx, { featureId: feature.id }, 'chat')
  // Its agent runs where the review drive puts the feature branch: the project's own checkout.
  const session = createSessionRow(ctx, {
    featureId: feature.id,
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
      featureId: feature.id,
      projectId: feature.projectId,
      label,
      purpose,
      kind: 'review',
      goal: purpose,
      doneWhen: null,
      model: model.id,
      runtime: model.runtime,
      startedBy: input.startedBy,
      status: 'queued',
      engine: sandboxEngine(ctx.config.sandbox).name,
      featureBranch: feature.branch,
      reviewMode: 'drive',
      reviewVerify: verify,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  keepReviewAssignment(session.id, await renderReviewAssignment(ctx, feature, project, { mode, passId: session.id }, verify, input.checksPassed))
  const w = requireWorker(ctx, session.id)
  recordLeadStart(ctx, w, mainChat?.id)
  emitWorker(ctx, w, 'worker.started', `worker "${label}" started on the host, for the review drive`, {
    sessionId: session.id,
    kind: 'review',
    startedBy: input.startedBy,
    mode,
  })
  await driveThenPrompt(ctx, session.id, workerKickoff(ctx, w))
  return { workerId: session.id, mode, status: requireWorker(ctx, session.id).status }
}

/** How long a drive review waits before asking for the drive slot again. */
let driveRetryMs = 15_000

/** Shorten the wait between a drive review's asks for the drive slot (tests); `undefined` restores 15s. */
export function setReviewDriveRetryForTests(ms: number | undefined): void {
  driveRetryMs = ms ?? 15_000
}

/** Each drive review's next ask for the drive slot, while it waits. */
const driveWaits = new Map<string, ReturnType<typeof setTimeout>>()

/** Lose every drive review's re-ask timer, as a server that dies does (tests). */
export function dropDriveWaitsForTests(): void {
  for (const id of [...driveWaits.keys()]) stopDriveWait(id)
}

function stopDriveWait(id: string): void {
  const timer = driveWaits.get(id)
  if (timer) clearTimeout(timer)
  driveWaits.delete(id)
}

/**
 * Take the review drive for a drive review, then send it `text`. While another
 * drive (the human's) holds the slot it waits `queued` and asks again; a start
 * that waiting cannot fix (an uncommitted file in the checkout) fails it.
 */
async function driveThenPrompt(ctx: AppCtx, id: string, text: string): Promise<void> {
  stopDriveWait(id)
  const w = getWorker(ctx, id)
  if (!w || w.status === 'failed' || w.status === 'dropped') return forgetDriveWait(id)
  const feature = getFeatureRow(ctx, workerFeatureId(w))
  const taken = await reviewDriveHost().take(ctx, projectForFeature(ctx, feature), feature)
  if (taken.ok) {
    forgetDriveWait(id)
    setStatus(ctx, requireWorker(ctx, id), 'working')
    await agentHost(ctx).prompt(id, { text }, { source: 'runcastle' })
    return
  }
  if (!taken.retriable) {
    forgetDriveWait(id)
    return failWorker(ctx, w, `the review drive could not start: ${taken.reason}`)
  }
  if (w.status !== 'queued') {
    const queued = setStatus(ctx, w, 'queued')
    emitWorker(ctx, queued, 'worker.waiting_for_drive', `worker "${w.label}" waits for the drive slot: ${taken.reason}`, { reason: taken.reason })
  }
  // Kept on disk too: the timer dies with the server, and the next boot arms the wait again from this.
  keepDriveWait(id, text)
  const timer = setTimeout(() => void driveThenPrompt(ctx, id, text).catch((err) => console.error(`worker ${id}: review drive`, err)), driveRetryMs)
  timer.unref?.()
  driveWaits.set(id, timer)
}

/**
 * At boot, arm again the wait of every drive review the last server left
 * queued for the drive slot: its re-ask timer died with that server, and the
 * review would otherwise stay queued forever. It sends the prompt it was
 * waiting to send (its assignment, or a send-back note) once the drive is its.
 * A review in `skip` (cut off mid-turn, told to carry on instead) is left alone.
 */
export async function resumeDriveReviewWaits(ctx: AppCtx, skip: ReadonlySet<string> = new Set()): Promise<number> {
  const host = agentHost(ctx)
  const waiting = ctx.db
    .select()
    .from(workers)
    .where(eq(workers.status, 'queued'))
    .all()
    .filter((w) => isHostReview(w) && !skip.has(w.id) && !driveWaits.has(w.id) && !host.isRunning(w.id))
  for (const w of waiting) {
    await driveThenPrompt(ctx, w.id, driveWaitOf(w.id) ?? workerKickoff(ctx, w)).catch((err) =>
      console.error(`worker ${w.id}: arming its wait for the review drive again`, err),
    )
  }
  return waiting.length
}

/** What a resumed worker's chat shows in place of the message it already shows (a-worker-never-shows-working-with-nothing-running decision 9). */
export const RESUMED_DISPLAY = 'The server restarted before this message reached the worker: sent again'
/**
 * The same, when the human wrote one of the caught messages. The resend is
 * runcastle's, so this line is how the turn-end rule still knows the human
 * opened the turn (decision 3).
 */
export const RESUMED_HUMAN_DISPLAY = 'The server restarted before your message reached the worker: sent again'

type PromptEvent = Extract<ThreadEvent, { type: 'prompt' }>
const isPrompt = (e: ThreadEvent): e is PromptEvent => e.type === 'prompt'
const summaryOf = (e: PromptEvent): string | undefined => (e.display && 'summary' in e.display ? e.display.summary : undefined)
const isResend = (e: PromptEvent): boolean => summaryOf(e) === RESUMED_DISPLAY || summaryOf(e) === RESUMED_HUMAN_DISPLAY

/**
 * The messages a restart caught before their turn began (decision 9): logged
 * as sent, but no turn has started since, so nothing will ever answer them.
 * Held and steered ones are not among them (a held one rides the next prompt;
 * a steered one joined a turn), nor runcastle's own commands. An earlier
 * resend a second restart caught already carries the ones before it.
 */
export function undeliveredPrompts(id: string): PromptEvent[] {
  const log = readThreadEvents(id)
  const after = log.slice(log.findLastIndex((e) => e.type === 'turn_started') + 1).filter(isPrompt)
  return after
    .slice(Math.max(0, after.findLastIndex(isResend)))
    .filter((e) => !e.held && !e.steered && !e.hidden && !e.compaction)
}

/**
 * At boot (decision 9): a worker at work whose message a restart caught
 * before its turn began, waiting for its slot or for its process, is sent
 * that message again, so it takes its place in line rather than staying
 * "queued" with nothing behind it. Skipped: a worker the carry-on wake already
 * told, a drive worker (handed back at boot), a drive review waiting for the
 * drive (its wait is armed again), one the usage limit holds (its wake is
 * armed again), one already running, and a copied database's own.
 */
export async function resumeCaughtWorkers(ctx: AppCtx, skip: ReadonlySet<string> = new Set()): Promise<number> {
  const host = agentHost(ctx)
  const caught = ctx.db
    .select()
    .from(workers)
    .where(inArray(workers.status, ['working', 'queued']))
    .all()
    .filter((w) => !skip.has(w.id) && !isDriveWorkerKind(w.kind) && !host.isRunning(w.id) && !getLimitHold(ctx, w.id))
    .filter((w) => !(isHostReview(w) && w.status === 'queued'))
  let resumed = 0
  for (const w of caught) {
    try {
      if (!mayStartInBackground(getSessionRow(ctx, w.id))) continue
      const caughtPrompts = undeliveredPrompts(w.id)
      if (caughtPrompts.length === 0) continue
      const human = caughtPrompts.some((e) => e.source === 'human' || summaryOf(e) === RESUMED_HUMAN_DISPLAY)
      emitWorker(ctx, w, 'worker.resumed', `worker "${w.label}" resumed: a restart caught it before its turn began`, { prompts: caughtPrompts.length })
      // The restart lost where the branch stood: note it again, so this turn's commits are recorded.
      await beforeWorkerTurn(ctx, w.id)
      await host.prompt(
        w.id,
        { text: caughtPrompts.map((e) => e.text).join('\n\n') },
        { source: 'runcastle', display: { summary: human ? RESUMED_HUMAN_DISPLAY : RESUMED_DISPLAY } },
      )
      resumed++
    } catch (err) {
      console.error(`worker ${w.id}: resuming it after the restart`, err)
    }
  }
  return resumed
}

/** A drive review is done with the drive (handed back, failed, dropped, stopped): give the slot back and stop its recorder. */
async function giveDriveBack(ctx: AppCtx, w: WorkerRow): Promise<void> {
  if (!isHostReview(w)) return
  stopDriveWait(w.id)
  forgetDriveWait(w.id)
  const feature = featureOf(ctx, w)
  if (!feature) return
  await reviewDriveHost()
    .give(projectForFeature(ctx, feature), feature, w.id)
    .catch((err) => console.error(`worker ${w.id}: giving the review drive back`, err))
}

/**
 * A Review worker handed back (decision 4): the drive goes back, and the lead
 * gets its Review Package card, with its findings, in place of the plain
 * handback card. A review has no branch: nothing lands.
 */
async function reviewHandedBack(ctx: AppCtx, w: WorkerRow, note: HandbackNote): Promise<void> {
  await giveDriveBack(ctx, w)
  // A review on the host (a drive review, a gates review in the feature's folder) has its conversation there: its tokens are counted as it hands back (decision 12).
  if (isHostWorker(w)) await keepConversation(ctx, w)
  const handed = updateWorker(ctx, w.id, {
    status: 'handed-back',
    handbackSummary: note.summary,
    handbackCommits: [],
    handbackFiles: [],
    outcome: null,
    outcomeNote: null,
  })
  const findings = listFindings(ctx, workerFeatureId(w)).filter((f) => f.reviewWorkerId === w.id)
  emitWorker(ctx, handed, 'worker.handed_back', `worker "${w.label}" handed back`, { commits: 0, files: 0, findings: findings.length })
  const feature = featureOf(ctx, w)
  if (!feature) return
  await deliverToLead(ctx, feature, {
    text: reviewHandbackText(handed, findings),
    source: 'runcastle',
    display: { reviewPackage: { workerId: w.id, label: w.label } },
  })
  emit(ctx, feature.id, { type: 'review.package_posted', message: 'review package posted in the chat', data: { workerId: w.id } })
}

/**
 * A worker's first prompt. An assigned worker starts on its goal; an
 * unassigned one is told the feature's state and the lead's latest turns (as a
 * side chat was) and to wait for the human. Its briefing (how it works, how it
 * hands back) rides its system prompt.
 */
export function workerKickoff(ctx: AppCtx, w: WorkerRow): string {
  if (w.kind === 'review') return reviewAssignment(w.id)
  if (w.kind !== 'unassigned') {
    return [`Start your assignment: ${w.goal ?? w.purpose}`, ...(w.doneWhen ? ['', `Done when: ${w.doneWhen}`] : [])].join('\n')
  }
  const feature = getFeatureRow(ctx, workerFeatureId(w))
  const opening =
    'You are a worker on this feature, started by the human with no assignment. Read what follows, ' +
    'then say in a line that you are ready and wait for the human: do nothing else until they ask.'
  const header = chatKickoffHeader(ctx, feature, w.runtime, opening)
  const { quote } = mainChatExcerpt(ctx, feature)
  if (!quote) return `${header}\n\nThe lead's chat has nothing on record to quote yet.`
  return `${header}\n\nBelow is a quote of the lead's latest turns — not the human speaking to you now.\n--- lead chat quote ---\n${quote}\n--- end of quote ---`
}

// --- turns ----------------------------------------------------------------------

/**
 * A worker's turn ended. A new handback records the worker branch's commits and
 * files, marks it handed back and wakes the lead once (decision 4). A turn that
 * failed is recovered from by itself where it can be ({@link recoverFromError});
 * one that ended otherwise without a handback goes to {@link quietTurnEnded}:
 * an assigned worker is nudged once, then stalls; any other reads idle until a
 * turn of it runs, and needs the human only if it said so with `wait_for_you`
 * (needs-you-is-the-agent-s-call decisions 2, 6).
 */
export async function workerTurnEnded(ctx: AppCtx, row: Pick<SessionRow, 'id'>, end?: TurnEnding): Promise<void> {
  let w = getWorker(ctx, row.id)
  if (!w) return
  // The usage limit is left to the host, under the human's carry-on setting (burns-become-workers decision 7).
  const error = end?.reason === 'error' && !end.usageLimit && !isUsageLimitText(end.error ?? '') ? end.error || 'the turn failed' : undefined
  const failed = error !== undefined && w.status === 'working' ? { error, verdict: classifyAgentError(error, w.runtime) } : undefined
  // Held before anything here awaits: the slot this turn just gave back must not start a queued turn on the same account.
  // A drive worker is outside the queue (drive-chats-become-workers decision 7): its account error fails it alone.
  const held = failed?.verdict === 'account' && !isDriveWorkerKind(w.kind) ? holdQueue(ctx, w, errorLine(failed.error)) : undefined
  const sb = sandboxOf(ctx, w)
  const engine = sandboxEngine(w.engine)
  const note = sb ? await engine.takeHandback(sb) : isHostWorker(w) ? takeHostHandback(w.id) : undefined
  if (sb && !w.devServer && (await engine.devServerStarted(sb))) updateWorker(ctx, w.id, { devServer: true })
  // What a drive worker, or a build worker in the feature's folder, committed on the branch this turn joins what it made so far
  // (drive-chats-become-workers decision 3; workers-build-in-the-feature-s-folder decision 2).
  const placement = workerPlacement(w)
  if (isDriveWorkerKind(w.kind) || (placement === 'feature-folder' && w.kind !== 'review')) w = await recordDriveTurnCommits(ctx, w)
  if (placement !== null && w.previewPort !== null && !w.devServer && (await portAnswers(w.previewPort))) w = updateWorker(ctx, w.id, { devServer: true })
  if (!note && failed) return recoverFromError(ctx, w, failed.error, failed.verdict, held)
  forgetRetries(w.id)
  if (note && w.kind === 'review') return reviewHandedBack(ctx, w, note)
  if (note && isDriveWorkerKind(w.kind)) return driveWorkerHandedBack(ctx, w, note)
  // A drive review stopped mid-turn gives the human their drive back; it takes it again with review_drive.
  if (!note && end?.reason === 'cancelled') await giveDriveBack(ctx, w)
  if (!note) return quietTurnEnded(ctx, w, end)
  let changes: { commits: string[]; files: string[] }
  if (placement === 'feature-folder') changes = { commits: w.handbackCommits ?? [], files: w.handbackFiles ?? [] }
  else {
    const branch = w.branch
    const repoPath = sb?.repoPath ?? projectForFeature(ctx, getFeatureRow(ctx, workerFeatureId(w))).repoPath
    if (!branch) return
    if (sb) await engine.fetchBranch(sb)
    const ahead = await branchChangesAhead(repoPath, w.featureBranch, branch)
    changes = { commits: ahead.commits.map((c) => `${c.sha.slice(0, 7)} ${c.subject}`), files: ahead.files }
  }
  const { commits, files } = changes
  const handed = updateWorker(ctx, w.id, {
    status: 'handed-back',
    handbackSummary: note.summary,
    handbackCommits: commits,
    handbackFiles: files,
    outcome: null,
    outcomeNote: null,
  })
  emitWorker(ctx, handed, 'worker.handed_back', `worker "${w.label}" handed back`, { commits: commits.length, files: files.length })
  const feature = featureOf(ctx, w)
  if (!feature) return
  const display: PromptDisplay = {
    handback: { workerId: w.id, label: w.label, kind: w.kind, summary: note.summary, commits, files, threadId: w.id },
  }
  await deliverToLead(ctx, feature, { text: handbackText(handed, commits, files), source: 'runcastle', display })
}

/** Whether something listens on `port` on the host's loopback: a host worker's dev server, once it started one. */
function portAnswers(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port })
    const finish = (up: boolean): void => {
      socket.destroy()
      done(up)
    }
    socket.setTimeout(500, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

/**
 * A drive worker handed back: it is Done with its summary, never landed, since
 * its commits are already on the driven branch (drive-chats-become-workers
 * decision 3), and its card reaches its parent without waking it (decision 4).
 */
async function driveWorkerHandedBack(ctx: AppCtx, w: WorkerRow, note: HandbackNote): Promise<void> {
  const handed = updateWorker(ctx, w.id, { status: 'handed-back', handbackSummary: note.summary, outcome: null, outcomeNote: null })
  emitWorker(ctx, handed, 'worker.handed_back', `worker "${w.label}" handed back`, {
    commits: handed.handbackCommits?.length ?? 0,
    files: handed.handbackFiles?.length ?? 0,
    branch: handed.featureBranch,
  })
  await deliverDriveHandback(ctx, handed)
}

/** What the lead reads of a handback: the summary, the work, and its three choices. */
function handbackText(w: WorkerRow, commits: string[], files: string[]): string {
  const placement = workerPlacement(w)
  if (placement === 'feature-folder') {
    return [
      `Worker "${w.label}" handed back (worker ${w.id}). It built in the feature's folder: its commits are already on ${w.featureBranch}, so nothing waits to land.`,
      '',
      w.handbackSummary ?? '',
      '',
      `Commits on ${w.featureBranch} while it worked:`,
      ...(commits.length ? commits.map((c) => `- ${c}`) : ['- none']),
      ...(files.length ? ['', `Files: ${files.join(', ')}`] : []),
      '',
      `Next: land_worker({ workerId: "${w.id}" }) to accept it (nothing merges; it frees the feature's folder for the next worker), ` +
        `send_back_worker({ workerId: "${w.id}", note }) to send it back with what to change, ` +
        `or drop_worker({ workerId: "${w.id}" }) to stop it; its commits stay, so revert any you do not want with new commits.`,
    ].join('\n')
  }
  if (placement === 'own-folder') {
    return [
      `Worker "${w.label}" handed back (worker ${w.id}, branch ${w.branch} in its own folder ${w.folder}; nothing has landed).`,
      '',
      w.handbackSummary ?? '',
      '',
      `Commits on ${w.branch} since ${w.featureBranch}:`,
      ...(commits.length ? commits.map((c) => `- ${c}`) : ['- none']),
      ...(files.length ? ['', `Files: ${files.join(', ')}`] : []),
      '',
      `Before you land it, run the project's checks in ${w.folder} and skim \`git diff ${w.featureBranch}...${w.branch}\`.`,
      `Next: land_worker({ workerId: "${w.id}" }) to merge it into ${w.featureBranch} (its folder and branch go), ` +
        `send_back_worker({ workerId: "${w.id}", note }) to send it back with what to change, ` +
        `or drop_worker({ workerId: "${w.id}" }) to throw it away.`,
    ].join('\n')
  }
  return [
    `Worker "${w.label}" handed back (worker ${w.id}, branch ${w.branch}; nothing has landed).`,
    '',
    w.handbackSummary ?? '',
    '',
    `Commits on ${w.branch} since ${w.featureBranch}:`,
    ...(commits.length ? commits.map((c) => `- ${c}`) : ['- none']),
    ...(files.length ? ['', `Files: ${files.join(', ')}`] : []),
    '',
    `Next: land_worker({ workerId: "${w.id}" }) to land it on the feature branch, ` +
      `send_back_worker({ workerId: "${w.id}", note }) to send it back with what to change, ` +
      `or drop_worker({ workerId: "${w.id}" }) to throw it away.`,
  ].join('\n')
}

// --- a turn that ended with no handback (a-worker-never-shows-working-with-nothing-running) ---

/** The kinds that work on an assignment of their own, so a quiet turn of theirs means they stopped short (decision 2). */
const NUDGED_KINDS: ReadonlySet<WorkerKind> = new Set(['on-its-own', 'review'])

/** What runcastle tells a worker whose turn ended with no handback (decision 4): one line, and the log knows it by it. */
export function workerNudgeText(kind: WorkerKind): string {
  const work = kind === 'review' ? 'the review' : 'your assignment'
  const done = kind === 'review' ? 'When it is done, hand back your Review Package' : 'When it is done, hand back'
  return (
    `[runcastle] Your turn ended without a handback. Carry on with ${work}. ` +
    `${done}; if you are blocked on the human, call wait_for_you.`
  )
}

/** What the worker's chat shows of the nudge. */
const NUDGE_DISPLAY = 'Turn ended without a handback: runcastle nudged it to carry on'

/**
 * The prompts of the turn that just ended, read off its log: the one that
 * opened it (none for a turn the agent started by itself) and every one from
 * there on, steered ones included.
 */
function endedTurnPrompts(id: string): { opening?: PromptEvent; prompts: PromptEvent[] } {
  const log = readThreadEvents(id)
  const started = log.findLastIndex((e) => e.type === 'turn_started')
  if (started < 0) return { prompts: [] }
  const self = (log[started] as Extract<ThreadEvent, { type: 'turn_started' }>).source === 'agent'
  let from = started
  let opening: PromptEvent | undefined
  if (!self) {
    // Back to the turn before, not just its end: a runtime that cannot steer
    // logs a prompt sent mid-turn before that turn's end, then queues it.
    for (let i = started - 1; i >= 0; i--) {
      const e = log[i]!
      if (e.type === 'turn_started') break
      if (isPrompt(e) && !e.steered && !e.held) {
        opening = e
        from = i
        break
      }
    }
  }
  return { ...(opening ? { opening } : {}), prompts: log.slice(from).filter(isPrompt) }
}

/**
 * A worker's turn ended with no handback (decisions 2–6). An "on its own" or
 * Review worker still working, whose turn nobody stopped, that the usage limit
 * does not hold, with nothing waiting to run next or still running in the
 * background, and that the human did not talk to in that turn, is nudged once;
 * if the turn the nudge opened also ends so, it stalls and its lead is told.
 * Every other worker is left as it is and reads idle.
 */
async function quietTurnEnded(ctx: AppCtx, w: WorkerRow, end?: TurnEnding): Promise<void> {
  if (w.status !== 'working' || !NUDGED_KINDS.has(w.kind)) return
  if (end?.reason === 'cancelled' || end?.reason === 'error' || end?.usageLimit || end?.queued || end?.background) return
  if (getLimitHold(ctx, w.id)) return
  const { opening, prompts } = endedTurnPrompts(w.id)
  if (opening?.compaction) return
  // A worker that just answered the human waits for them, not stuck (decision 3).
  if (prompts.some((p) => p.source === 'human' && !p.hidden) || (opening && summaryOf(opening) === RESUMED_HUMAN_DISPLAY)) return
  if (opening?.source === 'runcastle' && opening.text === workerNudgeText(w.kind)) return stallWorker(ctx, w)
  emitWorker(ctx, w, 'worker.nudged', `worker "${w.label}" ended its turn without a handback; nudged to carry on`)
  await agentHost(ctx).prompt(w.id, { text: workerNudgeText(w.kind) }, { source: 'runcastle', display: { summary: NUDGE_DISPLAY } })
}

/**
 * The turn runcastle's nudge opened ended with no handback too (decisions 5,
 * 6): the worker is stalled, and its lead gets a card and is woken once. Not
 * the orchestrator: the lead decides whether its epic needs to know.
 */
async function stallWorker(ctx: AppCtx, w: WorkerRow): Promise<void> {
  const stalled = setStatus(ctx, w, 'stalled')
  emitWorker(ctx, stalled, 'worker.stalled', `worker "${w.label}" stalled: it stopped twice without handing back`, { from: w.status })
  const feature = featureOf(ctx, w)
  if (!feature) return
  await deliverToLead(ctx, feature, {
    text:
      `Worker "${w.label}" stalled (worker ${w.id}): its turn ended without a handback twice, the second time after runcastle nudged it. ` +
      'Nothing of it is running.\n\n' +
      `Next: read its chat, then message_worker({ workerId: "${w.id}", text }) with what to do (that counts as a try), ` +
      `drop_worker({ workerId: "${w.id}" }), or do the job yourself.`,
    source: 'runcastle',
    display: { workerStalled: { workerId: w.id, label: w.label } },
  })
}

// --- recovering by itself (burns-become-workers decisions 8, 9, 21) ---------------

/** How many times a worker's failed turn is retried on a transient error before it fails. */
export const MAX_TRANSIENT_RETRIES = 3

/**
 * A worker turn's stall bounds (decision 9): ten quiet minutes with no command running, or one command for 45.
 * Not the worker status `stalled` (a-worker-never-shows-working-with-nothing-running spec, "Naming"): this watches a
 * turn that runs and hangs; that one marks a worker whose turns ended twice with no handback. Both keep their names.
 */
export const WORKER_STALL: StallBounds = { silenceMs: 10 * 60_000, commandMs: 45 * 60_000 }

/** The stall bounds for the agent host's `stallBounds`: worker threads only. */
export function workerStallBounds(bounds: StallBounds = WORKER_STALL): (row: SessionRow) => StallBounds | undefined {
  return (row) => (row.kind === 'worker' ? bounds : undefined)
}

/** Each worker's transient retries for its current run of failed turns, and the retry waiting out its backoff. */
const retries = new Map<string, { attempts: number; timer?: ReturnType<typeof setTimeout> }>()

let retryDelay: (attempt: number) => number = retryDelayMs

/** Shorten the backoff between retries (tests); `undefined` restores 5s, 10s, 20s. */
export function setWorkerRetryDelayForTests(delay: ((attempt: number) => number) | undefined): void {
  retryDelay = delay ?? retryDelayMs
}

/** Forget a worker's retries: its turn ended cleanly, or the human wrote to it. */
function forgetRetries(id: string): void {
  const entry = retries.get(id)
  if (entry?.timer) clearTimeout(entry.timer)
  retries.delete(id)
}

/** The first line of an error, short enough for a prompt. */
function errorLine(error: string): string {
  const line = error.trim().split(/\r?\n/)[0] ?? ''
  return line.length > 200 ? `${line.slice(0, 199)}…` : line
}

/**
 * A working worker's turn failed (decision 8). A transient error is retried in
 * the same conversation after a backoff, the worker staying working, up to
 * {@link MAX_TRANSIENT_RETRIES} times; the next one, or any fatal or account
 * error, fails it and wakes its lead once, saying so when an account error
 * held the queue (`held`, decision 21).
 */
async function recoverFromError(ctx: AppCtx, w: WorkerRow, error: string, verdict: AgentErrorClass, held?: string): Promise<void> {
  const attempt = (retries.get(w.id)?.attempts ?? 0) + 1
  const line = errorLine(error)
  if (verdict !== 'transient' || attempt > MAX_TRANSIENT_RETRIES) {
    forgetRetries(w.id)
    const failure = verdict === 'transient' ? `${line} (still failing after ${MAX_TRANSIENT_RETRIES} retries)` : error.trim()
    return failWorker(ctx, w, failure, held)
  }
  const timer = setTimeout(() => void retryTurn(ctx, w.id, line), retryDelay(attempt))
  timer.unref?.()
  retries.set(w.id, { attempts: attempt, timer })
  emitWorker(ctx, w, 'worker.retrying', `worker "${w.label}" stopped on a transient error; retry ${attempt} of ${MAX_TRANSIENT_RETRIES}`, {
    attempt,
    error: line,
  })
}

/** What a retried worker is told. */
function transientRetryText(line: string): string {
  return `[runcastle] The last turn stopped on a transient error (${line}). Carry on where you were.`
}

/** The backoff is over: tell the same conversation to carry on, unless the worker moved on meanwhile. */
async function retryTurn(ctx: AppCtx, id: string, line: string): Promise<void> {
  const entry = retries.get(id)
  if (!entry?.timer) return
  delete entry.timer
  if (getWorker(ctx, id)?.status !== 'working') return
  await agentHost(ctx)
    .prompt(id, { text: transientRetryText(line) }, { source: 'runcastle' })
    .catch((err) => console.error(`worker ${id}: retry`, err))
}

/**
 * Hold every queued worker turn on `w`'s runtime (decision 21): none starts to
 * fail the same way. Each worker already queued on it says why; the hold lifts
 * at the human's next message ({@link humanWrote}). Returns what the failed
 * worker's lead is told of it.
 */
function holdQueue(ctx: AppCtx, w: WorkerRow, reason: string): string {
  agentSlots(ctx.config.burnConcurrency).hold(w.runtime, reason)
  const held = ctx.db.select().from(workers).all().filter((q) => q.status === 'queued' && q.runtime === w.runtime)
  for (const q of [w, ...held]) {
    emitWorker(ctx, q, 'worker.queue_held', `no queued worker on ${w.runtime} starts until the human next writes: ${reason}`, {
      runtime: w.runtime,
      reason,
    })
  }
  return `It failed on the account, so no queued worker on ${w.runtime} starts until the human next writes to a lead or a worker.`
}

/** Why a queued worker is held (decision 21), or null when it is not; never a drive worker, which no hold holds. */
export function queueHoldOf(ctx: AppCtx, w: WorkerRow): string | null {
  if (w.status !== 'queued' || isDriveWorkerKind(w.kind)) return null
  return agentSlots(ctx.config.burnConcurrency).holdOf(w.runtime) ?? null
}

/** One worker in the machine's line-up for a place (one-number-for-how-many-build-at-once decision 3). */
export interface QueueEntry {
  workerId: string
  label: string
  kind: WorkerRow['kind']
  featureId: string | null
  /** For opening its feature from another project's sidebar. */
  featureSlug: string | null
  featureTitle: string | null
  projectId: string
  projectName: string
  /** Since when it works (admitted) or waits (asked), epoch ms. */
  since: number
  /** Why its runtime's account hold keeps it from starting; it keeps its place meanwhile. */
  heldBy: string | null
}

/** Who works and who waits for a place under the machine's one limit, across every project. */
export interface WorkQueue {
  limit: number
  /** In order of admission. */
  working: QueueEntry[]
  /** In queue order, first come first served (decision 9). */
  waiting: QueueEntry[]
}

/**
 * The machine's line-up: the shared slots' snapshot joined to each worker's
 * feature and project. A slot whose holder is not a worker this server knows
 * (a ticket agent, or a row since deleted) is left out of the lists, though it
 * still counts against the limit.
 */
export function workQueue(ctx: AppCtx): WorkQueue {
  const snap = agentSlots(ctx.config.burnConcurrency).snapshot()
  const ids = [...snap.holding, ...snap.waiting].flatMap((e) => (e.holder === undefined ? [] : [e.holder]))
  const rows =
    ids.length === 0
      ? []
      : ctx.db
          .select({ w: workers, featureSlug: features.slug, featureTitle: features.title, projectName: projects.name })
          .from(workers)
          .leftJoin(features, eq(features.id, workers.featureId))
          .innerJoin(projects, eq(projects.id, workers.projectId))
          .where(inArray(workers.id, ids))
          .all()
  const byId = new Map(rows.map((r) => [r.w.id, r]))
  const entry = (e: { holder?: string; since: number; heldBy?: string }): QueueEntry[] => {
    const r = e.holder === undefined ? undefined : byId.get(e.holder)
    if (!r) return []
    return [
      {
        workerId: r.w.id,
        label: r.w.label,
        kind: r.w.kind,
        featureId: r.w.featureId,
        featureSlug: r.featureSlug,
        featureTitle: r.featureTitle,
        projectId: r.w.projectId,
        projectName: r.projectName,
        since: e.since,
        heldBy: e.heldBy ?? null,
      },
    ]
  }
  return { limit: snap.limit, working: snap.holding.flatMap(entry), waiting: snap.waiting.flatMap(entry) }
}

/**
 * A waiting worker's 1-based place in line among the waiters no account hold
 * keeps back (decision 8: "waiting · 2nd in line"), or null when it does not
 * wait or its runtime is held.
 */
export function queuePlaceOf(ctx: AppCtx, workerId: string): number | null {
  const startable = agentSlots(ctx.config.burnConcurrency)
    .snapshot()
    .waiting.filter((e) => e.heldBy === undefined)
  const i = startable.findIndex((e) => e.holder === workerId)
  return i === -1 ? null : i + 1
}

/** The human sent a message to a thread: an account hold lifts (decision 21), and a worker they wrote to starts its retries over. */
export function humanWrote(ctx: AppCtx, row: Pick<SessionRow, 'id' | 'kind'>): void {
  agentSlots(ctx.config.burnConcurrency).lift()
  if (row.kind === 'worker') forgetRetries(row.id)
}

/**
 * The slot a worker's turn holds under the machine's limit of agents working
 * at once (decision 14), for the agent host's `turnSlot`: none for any other
 * thread. A worker that has to wait — for a free slot, or for its runtime's
 * account hold to lift — is `queued` until its slot comes, then working again;
 * one waiting on the human or stopped holds none, since only a running turn asks.
 * A drive worker holds none either: the drive slot is its limit, and the human
 * sits beside the drive waiting for it (drive-chats-become-workers decision 7),
 * so it is never queued nor held by an account hold.
 */
export function workerTurnSlot(ctx: AppCtx): (row: SessionRow, withdraw: AbortSignal) => Promise<() => void> | undefined {
  return (row, withdraw) => {
    if (row.kind !== 'worker') return undefined
    const w = getWorker(ctx, row.id)
    return w && isDriveWorkerKind(w.kind) ? undefined : takeWorkerSlot(ctx, row.id, withdraw)
  }
}

/** A worker turn's slot; a turn withdrawn while it waits leaves the line, holding nothing. */
async function takeWorkerSlot(ctx: AppCtx, id: string, withdraw: AbortSignal): Promise<() => void> {
  const slots = agentSlots(ctx.config.burnConcurrency)
  const w = getWorker(ctx, id)
  const now = slots.tryTake(w?.runtime, id)
  if (now) return now
  // A worker that needs the human keeps saying so while its turn waits (needs-you decision 18).
  if (w?.status === 'working') setStatus(ctx, w, 'queued')
  let release = await slots.take(w?.runtime, id, withdraw)
  // Admitted by a slot freed by a turn whose failure then held this runtime: wait again.
  while (w && !withdraw.aborted && slots.holdOf(w.runtime) !== undefined) {
    release()
    release = await slots.take(w.runtime, id, withdraw)
  }
  const after = getWorker(ctx, id)
  if (after?.status === 'queued') setStatus(ctx, after, 'working')
  return release
}

/**
 * A question ask opened on a worker's thread: its agent halts
 * mid-turn on the human, so the worker needs them until it is answered. The
 * feature's need already pings for the ask itself (interactive-workers decision
 * 10); this only makes the worker's own row say so. An MCP server's form or link
 * is the agent's own errand, as it is for the feature's need.
 */
export function workerAskOpened(ctx: AppCtx, id: string, kind: Ask['kind']): void {
  if (kind !== 'question') return
  const w = getWorker(ctx, id)
  if (w?.status === 'working') setStatus(ctx, w, 'needs-you')
}

/** The human answered a worker's open ask: it is working again. */
export function workerAskAnswered(ctx: AppCtx, id: string): void {
  workerPrompted(ctx, id)
}

/** The human typed to a worker, pressed its Stop, answered its ask, or it withdrew its wait: a worker waiting on them is working again. */
export function workerPrompted(ctx: AppCtx, id: string): void {
  const w = getWorker(ctx, id)
  if (w?.status === 'needs-you') setStatus(ctx, w, 'working')
}

/**
 * The human typed to a worker: as `workerPrompted`, and a stalled one is
 * working again (a-worker-never-shows-working-with-nothing-running decision 4).
 * Only a message does that; a Stop leaves it stalled, with nothing to run.
 */
export function workerTypedTo(ctx: AppCtx, id: string): void {
  const w = getWorker(ctx, id)
  if (w?.status === 'stalled') setStatus(ctx, w, 'working')
  else workerPrompted(ctx, id)
}

/**
 * A worker's `wait_for_you` (needs-you-is-the-agent-s-call decision 6): its
 * chat needs the human with `why`, and it reads "needs you" until the human
 * writes to it or it withdraws.
 */
export function workerWaitsFor(ctx: AppCtx, id: string, why: string): void {
  setWait(ctx, id, why, 'agent')
  workerWaits(ctx, id)
}

/** A worker's wait was set: a working or queued worker reads "needs you". */
export function workerWaits(ctx: AppCtx, id: string): void {
  const w = getWorker(ctx, id)
  if (w?.status === 'working' || w?.status === 'queued') setStatus(ctx, w, 'needs-you')
}

/** A worker's `wait_for_you({ withdraw: true })`: it no longer needs the human. */
export function workerWithdraws(ctx: AppCtx, id: string): void {
  clearWait(ctx, id, 'withdrawn')
  workerPrompted(ctx, id)
}

/**
 * The feature's Stop (burns-become-workers decision 15): cancel the turn of
 * every worker of it that is working or queued — a turn waiting for its slot,
 * a retry waiting out its backoff, a drive review waiting for the drive. Each
 * stays where it is, enterable, and reads idle (needs-you decision 10); nothing
 * starts it again until someone writes to it.
 */
export async function stopFeatureWorkers(ctx: AppCtx, featureId: string): Promise<void> {
  const live = listWorkers(ctx, featureId).filter((w) => w.status === 'working' || w.status === 'queued' || w.status === 'needs-you')
  for (const w of live) {
    forgetRetries(w.id)
    stopDriveWait(w.id)
    if (w.status !== 'working') setStatus(ctx, w, 'working')
    await agentHost(ctx)
      .cancel(w.id)
      .catch((err) => console.error(`worker ${w.id}: stop`, err))
  }
}

/**
 * A worker's process stopped: an idle or archive stop stops its sandbox too; a stall kill only gives a drive review's drive back (its retry follows its turn); a
 * crash (its container died, its sandbox would not wake, its agent exited)
 * fails it (decision 16).
 */
export async function workerStopped(ctx: AppCtx, row: Pick<SessionRow, 'id'>, reason: StopReason): Promise<void> {
  const w = getWorker(ctx, row.id)
  if (!w) return
  if (reason === 'crashed') return failWorker(ctx, w, crashFailure(w.id))
  // A drive review whose agent stopped holds the human's drive for nothing; it takes it again with review_drive.
  await giveDriveBack(ctx, w)
  if (reason !== 'idle' && reason !== 'archived') return
  const sb = sandboxOf(ctx, w)
  if (!sb || w.status === 'dropped' || w.status === 'landed') return
  await sandboxEngine(w.engine).stop(sb)
  if (featureOf(ctx, w)) emitWorker(ctx, w, 'worker.stopped', `worker "${w.label}" sandbox stopped (${reason})`, { reason })
}

/** What the thread's log says stopped its agent, or a plain word when it says nothing. */
function crashFailure(threadId: string): string {
  const stop = readThreadEvents(threadId).findLast((e) => e.type === 'process' && e.state === 'stopped')
  const error = stop?.type === 'process' ? stop.error : undefined
  return error?.trim() || 'its agent stopped unexpectedly'
}

/**
 * Mark a worker failed and wake its lead once with what failed (decision 16),
 * so a lead never waits on a worker that will not hand back. A worker that is
 * already failed, dropped or landed is left as it is.
 */
async function failWorker(ctx: AppCtx, w: WorkerRow, failure: string, held?: string): Promise<void> {
  if (w.status === 'failed' || w.status === 'dropped' || w.status === 'landed') return
  forgetRetries(w.id)
  await giveDriveBack(ctx, w)
  const short = failure.slice(0, 2000)
  const failed = updateWorker(ctx, w.id, { status: 'failed', failure: short })
  emitWorker(ctx, failed, 'worker.failed', `worker "${w.label}" failed: ${short}`, { failure: short, from: w.status })
  // Its container is stopped, not removed: it may hold commits the lead wants to look at (cleans-up decision 4).
  const sb = sandboxOf(ctx, failed)
  if (sb) await sandboxEngine(w.engine).stop(sb).catch((err) => console.error(`worker ${w.id}: stopping its failed sandbox`, err))
  // The lead hears of it and decides whether the human does; a failed worker sets no need (needs-you decision 9).
  const feature = featureOf(ctx, w)
  if (!feature) return
  await deliverToLead(ctx, feature, {
    text:
      `Worker "${w.label}" failed (worker ${w.id}): ${short}\n\n` +
      (held ? `${held}\n\n` : '') +
      `Next: start it again with start_worker, drop_worker({ workerId: "${w.id}" }), or do the job yourself.`,
    source: 'runcastle',
    display: { workerFailed: { workerId: w.id, label: w.label, failure: short } },
  })
}

// --- the lead's and the human's moves -------------------------------------------

/** Refuse the lead's moves on a drive worker: nothing of it lands, and only the human talks to it (drive-chats-become-workers decisions 3, 6). */
function refuseDriveWorker(w: WorkerRow): void {
  if (isDriveWorkerKind(w.kind)) throw new GateError(`worker "${w.label}" is a drive worker: ${DRIVE_WORKER_REFUSAL}.`)
}

function requireOpen(w: WorkerRow): void {
  if (w.status === 'dropped') throw new GateError(`worker "${w.label}" was dropped`)
  if (w.status === 'landed') throw new GateError(`worker "${w.label}" already landed: its agent has stopped, so it cannot answer`)
  if (w.status === 'failed') throw new GateError(`worker "${w.label}" failed: ${w.failure ?? 'its agent has stopped'}`)
}

/**
 * Send a worker a message (decision 17): a runcastle prompt into its thread,
 * which waits for the end of a turn that is running. A worker waiting on the
 * human is working again. The lead's: a drive worker refuses it.
 */
export async function messageWorker(ctx: AppCtx, id: string, text: string): Promise<{ ok: true }> {
  const w = requireWorker(ctx, id)
  refuseDriveWorker(w)
  return promptWorker(ctx, w, text)
}

/**
 * A turn of a build worker in the feature's folder is about to start: note where
 * the feature branch stands, so only what it commits from here counts as its own
 * (workers-build-in-the-feature-s-folder decision 2). Skipped while its agent
 * still runs, since a message mid-turn starts no new turn. This also gives a
 * worker its starting point back after a server restart.
 */
export async function beforeWorkerTurn(ctx: AppCtx, id: string): Promise<void> {
  const w = getWorker(ctx, id)
  if (!w || workerPlacement(w) !== 'feature-folder' || w.kind === 'review' || isDriveWorkerKind(w.kind)) return
  if (agentHost(ctx).isRunning(id)) return
  await noteWorkerTurnBase(ctx, w).catch(() => undefined)
}

async function promptWorker(ctx: AppCtx, w: WorkerRow, text: string): Promise<{ ok: true }> {
  requireOpen(w)
  await beforeWorkerTurn(ctx, w.id)
  // A message is not the human's word in the worker's chat: a worker that needs them still does (needs-you decision 7).
  // A stalled one is working again: someone told it what to do (a-worker-never-shows-working-with-nothing-running decision 4).
  if (w.status === 'stalled') setStatus(ctx, w, 'working')
  await agentHost(ctx).prompt(w.id, { text }, { source: 'runcastle' })
  emitWorker(ctx, w, 'worker.messaged', `message sent to worker "${w.label}"`, { text })
  return { ok: true }
}

/** The Hand back button (decision 5): ask the worker to write its summary and hand back. The human's, so a drive worker takes it too. */
export function askWorkerToHandBack(ctx: AppCtx, id: string): Promise<{ ok: true }> {
  return promptWorker(
    ctx,
    requireWorker(ctx, id),
    'The human pressed Hand back: they are done here. Commit what is left, then call hand_back with your summary — ' +
      'what you did, what is left, and every direction the human gave you in this conversation — and end your turn.',
  )
}

export type LandWorkerResult =
  | { ok: true; commits: number; files: number }
  | { ok: false; conflict: boolean; files: string[]; error: string; sentBack?: boolean }

/** How many times runcastle sends an "on its own" worker back to resolve a landing conflict before the lead decides (decision 6). */
export const MAX_CONFLICT_SEND_BACKS = 2

/**
 * Land a handed-back worker's branch on the feature branch, through the
 * feature's landing queue like the lead's own commits (decision 4). A conflict
 * sends an "on its own" worker back by itself to resolve it, up to
 * {@link MAX_CONFLICT_SEND_BACKS} times; otherwise it comes back to the lead,
 * and the worker stays handed back (burns-become-workers decision 6).
 */
export async function landWorker(ctx: AppCtx, id: string): Promise<LandWorkerResult> {
  const w = requireWorker(ctx, id)
  refuseDriveWorker(w)
  if (w.kind === 'review') throw new GateError(`worker "${w.label}" is a review: it writes no code, so nothing lands. Resolve its findings instead.`)
  if (w.status !== 'handed-back') throw new GateError(`worker "${w.label}" is ${w.status}: only a handed-back worker lands`)
  const feature = getFeatureRow(ctx, workerFeatureId(w))
  const placement = workerPlacement(w)
  // In the feature's folder its commits are on the branch already: landing only settles it (workers-build-in-the-feature-s-folder decision 2).
  if (placement === 'feature-folder') return settleFeatureFolderWorker(ctx, w, feature.branch)
  let source: { repoPath: string; branch: string }
  if (placement === 'own-folder' && w.branch) {
    // The merge happens in the feature's folder: never under a worker whose turn runs there.
    const holder = featureFolderHolder(ctx, feature.id)
    if (holder && agentHost(ctx).isRunning(holder.id)) {
      throw new GateError(
        `worker "${holder.label}" is mid-turn in the feature's folder, where this merge would land: land "${w.label}" once its turn ends.`,
      )
    }
    source = { repoPath: projectForFeature(ctx, feature).repoPath, branch: w.branch }
  } else {
    const sb = sandboxOf(ctx, w)
    if (!sb) throw new GateError(`worker "${w.label}" has no branch to land from`)
    await sandboxEngine(w.engine).fetchBranch(sb)
    source = { repoPath: sb.repoPath, branch: sb.branch }
  }
  const sb = source
  // Read before the merge, which deletes the branch it lands.
  const changes = await branchChangesAhead(sb.repoPath, feature.branch, sb.branch)
  let result: TempBranchMergeResult
  try {
    result = await featureLandingQueue(feature.id)(() => mergeTempBranch(sb.repoPath, feature.branch, sb.branch))
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (!result.ok) {
    const error = result.error ?? 'merge failed'
    const files = result.files ?? []
    emitWorker(ctx, w, 'worker.land_failed', `worker "${w.label}" could not land: ${error}`, { conflict: !!result.conflict, files })
    if (!result.conflict) return { ok: false, conflict: false, files, error }
    const conflictIn = files.length ? ` in ${files.join(', ')}` : ''
    const tries = conflictSendBacks(ctx, w)
    if (w.kind === 'on-its-own' && tries < MAX_CONFLICT_SEND_BACKS) {
      const behind = (await branchChangesAhead(sb.repoPath, sb.branch, feature.branch)).commits.map((c) => `${c.sha.slice(0, 7)} ${c.subject}`)
      await sendBack(ctx, w, conflictSendBackText(feature.branch, files, behind, placement === 'own-folder'), 'runcastle sent it back to resolve a landing conflict', {
        conflict: true,
        files,
      })
      return {
        ok: false,
        conflict: true,
        files,
        sentBack: true,
        error:
          `${sb.branch} conflicts with ${feature.branch}${conflictIn}. Runcastle sent worker "${w.label}" back to merge ${feature.branch} in and resolve it ` +
          `(try ${tries + 1} of ${MAX_CONFLICT_SEND_BACKS}); call land_worker again on its next handback.`,
      }
    }
    return {
      ok: false,
      conflict: true,
      files,
      error:
        `${sb.branch} conflicts with ${feature.branch}${conflictIn}. Either resolve it yourself — merge ${sb.branch} into your checkout, resolve and commit, ` +
        `then call land_worker again — or send_back_worker({ workerId: "${w.id}", note }) to have the worker merge ${feature.branch} in and resolve it.`,
    }
  }
  const landed = updateWorker(ctx, w.id, { status: 'landed', outcome: 'landed', outcomeNote: null })
  clearWait(ctx, w.id, 'closed')
  // Its work is on the feature branch: its conversation is kept, then its folder (or container and bare copy) go, as a drop's do (cleans-up decision 2).
  try {
    await removeWorkerSandbox(ctx, w)
  } catch (err) {
    emitWorker(ctx, landed, 'worker.remove_failed', `worker "${w.label}" landed, but its ${placement ? 'folder' : 'sandbox'} could not be removed`, {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  emitWorker(ctx, landed, 'worker.landed', `worker "${w.label}" landed ${changes.commits.length} commit(s) on ${feature.branch}`, {
    commits: changes.commits.length,
    files: changes.files.length,
  })
  return { ok: true, commits: changes.commits.length, files: changes.files.length }
}

/**
 * Settle a worker that built in the feature's folder (decision 2): its commits are on the branch already, so
 * nothing merges. It is marked landed, its agent stops and its conversation is kept; the folder is free again.
 */
async function settleFeatureFolderWorker(ctx: AppCtx, w: WorkerRow, featureBranch: string): Promise<LandWorkerResult> {
  const commits = w.handbackCommits?.length ?? 0
  const files = w.handbackFiles?.length ?? 0
  const landed = updateWorker(ctx, w.id, { status: 'landed', outcome: 'landed', outcomeNote: null })
  clearWait(ctx, w.id, 'closed')
  await removeWorkerSandbox(ctx, w)
  emitWorker(ctx, landed, 'worker.landed', `worker "${w.label}" accepted: its ${commits} commit(s) were already on ${featureBranch}`, { commits, files })
  return { ok: true, commits, files }
}

/** Send a handed-back worker's work back with a note (decision 4): the note goes to the worker, which works again. */
export async function sendBackWorker(ctx: AppCtx, id: string, note: string): Promise<{ ok: true }> {
  const w = requireWorker(ctx, id)
  refuseDriveWorker(w)
  if (w.status !== 'handed-back') throw new GateError(`worker "${w.label}" is ${w.status}: only a handed-back worker is sent back`)
  await sendBack(ctx, w, `Your lead sent your work back:\n\n${note}\n\nWork on it, then hand back again.`, note)
  return { ok: true }
}

/**
 * Send a worker back with `text`: it works again, its bare copy holding the
 * feature branch's current tip, so a conflict it is asked to resolve is one
 * `git fetch origin` away.
 */
async function sendBack(ctx: AppCtx, w: WorkerRow, text: string, note: string, data: Record<string, unknown> = {}): Promise<void> {
  const sb = sandboxOf(ctx, w)
  if (sb) await sandboxEngine(w.engine).refreshFeatureBranch(sb)
  const sent = updateWorker(ctx, w.id, { status: 'working', outcome: 'sent-back', outcomeNote: note })
  emitWorker(ctx, sent, 'worker.sent_back', `worker "${w.label}" was sent back`, { note, ...data })
  // A drive review sent back takes the drive slot again first (decision 3).
  if (isHostReview(w)) return driveThenPrompt(ctx, w.id, text)
  await beforeWorkerTurn(ctx, w.id)
  await agentHost(ctx).prompt(w.id, { text }, { source: 'runcastle' })
}

/** How many times runcastle has sent `w` back to resolve a landing conflict, read off its feature's timeline. */
function conflictSendBacks(ctx: AppCtx, w: WorkerRow): number {
  return listAfter(ctx, workerFeatureId(w), 0).filter((e) => {
    const data = e.data as { workerId?: string; conflict?: boolean } | null
    return e.type === 'worker.sent_back' && data?.workerId === w.id && data.conflict === true
  }).length
}

/** What a worker sent back over a landing conflict is told: the files, the commits it lacks, and how to resolve it. */
function conflictSendBackText(featureBranch: string, files: string[], behind: string[], host: boolean): string {
  return [
    `Your work could not land: it conflicts with ${featureBranch}, which moved on since you started.`,
    '',
    `Conflicting files: ${files.length ? files.join(', ') : 'git did not name them'}`,
    '',
    `Commits on ${featureBranch} your branch lacks:`,
    ...(behind.length ? behind.map((c) => `- ${c}`) : ['- none listed']),
    '',
    `Run \`${host ? `git merge ${featureBranch}` : `git fetch origin && git merge origin/${featureBranch}`}\` on your branch, resolve each conflict keeping both sides' intent, ` +
      'run the checks covering the files you touched, commit the merge, then hand back.',
  ].join('\n')
}

/**
 * Drop a worker (decision 18): its process stops, its container and branch go.
 * Idempotent: dropping a dropped worker removes whatever of its sandbox is
 * left and says nothing new.
 */
export async function dropWorker(ctx: AppCtx, id: string): Promise<{ ok: true }> {
  const w = requireWorker(ctx, id)
  refuseDriveWorker(w)
  if (w.status === 'landed') throw new GateError(`worker "${w.label}" already landed; there is nothing to drop`)
  await retireWorker(ctx, w)
  return { ok: true }
}

/** Stop a worker's process, remove its sandbox and branch, and mark it dropped unless it landed. */
async function retireWorker(ctx: AppCtx, w: WorkerRow): Promise<void> {
  forgetRetries(w.id)
  const drops = w.status !== 'dropped' && w.status !== 'landed'
  const dropped = drops ? updateWorker(ctx, w.id, { status: 'dropped', outcome: 'dropped', outcomeNote: null }) : w
  clearWait(ctx, w.id, 'closed')
  // Mid-setup, the setup removes what it made when it finishes and sends no kickoff (cleans-up decision 4).
  if (!settingUp.has(w.id)) await removeWorkerSandbox(ctx, w)
  if (drops) emitWorker(ctx, dropped, 'worker.dropped', `worker "${w.label}" was dropped`)
}

/**
 * Stop a worker's process, keep its conversation, then remove its container,
 * branch and bare copy. A worker already landed or dropped had its
 * conversation kept then; only a container its removal missed is removed again.
 */
async function removeWorkerSandbox(ctx: AppCtx, w: WorkerRow): Promise<void> {
  const retired = w.status === 'landed' || w.status === 'dropped'
  await agentHost(ctx).stop(w.id, 'archived')
  await giveDriveBack(ctx, w)
  const sb = sandboxOf(ctx, w)
  const engine = sandboxEngine(w.engine)
  if (retired && sb && !(await engine.inspect(sb.container).catch(() => undefined))) return
  if (hasConversation(w)) await keepConversation(ctx, w)
  if (sb) await engine.remove(sb)
  // A worker in its own folder: the folder and its branch go (decision 3). One in the feature's folder leaves both, and its commits (decision 13).
  await removeWorkerFolder(ctx, w)
}

/** Where a worker's own copy of its agent's conversation file is kept: beside its thread log. */
export function keptConversationPath(workerId: string): string {
  return join(sessionDir(workerId), 'agent-conversation.jsonl')
}

/**
 * Keep the agent's own conversation file (Claude's session file, Codex's
 * rollout) beside the worker's thread log, and record the tokens read from it
 * on the worker row (decision 12). Best-effort: a file that cannot be found or
 * copied is an event, never a reason to keep a sandbox from being removed.
 */
export async function keepConversation(ctx: AppCtx, w: WorkerRow): Promise<void> {
  try {
    const kept = keptConversationPath(w.id)
    const read = isHostWorker(w) ? keepHostConversation(ctx, w, kept) : await keepSandboxConversation(ctx, w, kept)
    const usage = read ? readTranscriptUsage(read, w.runtime) : null
    if (usage) updateWorker(ctx, w.id, { tokens: usage.total })
  } catch (err) {
    emitWorker(ctx, w, 'worker.conversation_unkept', `worker "${w.label}": its conversation file could not be kept`, {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Copy a sandboxed worker's conversation file out to `kept`; the path to read its tokens from, or undefined when there is none. */
async function keepSandboxConversation(ctx: AppCtx, w: WorkerRow, kept: string): Promise<string | undefined> {
  const sb = sandboxOf(ctx, w)
  const conversationId = getSessionRow(ctx, w.id)?.ccSessionId
  if (!sb || !conversationId) return undefined
  const engine = sandboxEngine(w.engine)
  const inside = await engine.conversationPath(sb, conversationId)
  if (!inside) return undefined
  await engine.copyOut(sb, inside, kept)
  return kept
}

/**
 * A host worker's conversation file is on the host already (it ran there):
 * the transcript its session recorded, else Claude Code's file for its
 * conversation. Copied to `kept` beside its thread log; its tokens are read
 * where it lies, with any subagent transcripts beside it.
 */
function keepHostConversation(ctx: AppCtx, w: WorkerRow, kept: string): string | undefined {
  const row = getSessionRow(ctx, w.id)
  const recorded = row?.transcriptPath && existsSync(row.transcriptPath) ? row.transcriptPath : undefined
  const path = recorded ?? (row?.ccSessionId && w.runtime === 'claude-code' ? claudeTranscriptPath(row.ccSessionId) : undefined)
  if (!path) return undefined
  if (resolve(path) !== resolve(kept)) {
    mkdirSync(dirname(kept), { recursive: true })
    copyFileSync(path, kept)
  }
  return path
}

/** Whether a worker has a conversation file to keep: a sandbox's, or a host worker's on the host. */
function hasConversation(w: WorkerRow): boolean {
  return !!w.container || isHostWorker(w)
}

/** Keep every worker's conversation of a feature, so a record written before its sandboxes go (the outcome) carries their tokens. */
export async function keepFeatureConversations(ctx: AppCtx, featureId: string): Promise<void> {
  // A landed or dropped worker's was kept when it went, and its sandbox is gone.
  for (const w of listWorkers(ctx, featureId)) if (hasConversation(w) && w.status !== 'dropped' && w.status !== 'landed') await keepConversation(ctx, w)
}

/**
 * The feature merged, was archived or is being deleted (decision 18): every
 * worker's process, container and branch go, and the open ones are marked
 * dropped. Each is tried even when another's removal fails. After a merge or
 * an archive, which have already happened, a failure is an event; a delete
 * (`after` absent) throws the first one, so the delete stops and can be retried.
 */
export async function removeFeatureWorkers(ctx: AppCtx, featureId: string, after?: 'merged' | 'archived'): Promise<void> {
  let first: unknown
  for (const w of listWorkers(ctx, featureId)) {
    try {
      await retireWorker(ctx, w)
    } catch (err) {
      first ??= err
      if (after) {
        emitWorker(ctx, w, 'worker.remove_failed', `worker "${w.label}" could not be removed after the feature ${after}`, {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
  if (first !== undefined && !after) throw first
}

/** The statuses that keep a feature from being ready: at work, or holding work not landed (decision 19). */
const HOLDS_READY: ReadonlySet<WorkerStatus> = new Set(['working', 'queued', 'needs-you', 'stalled', 'handed-back'])

/**
 * The feature's workers still at work or holding work that has not landed; a
 * review that handed back holds nothing to land, and a drive worker never holds
 * ready (drive-chats-become-workers decision 6): its work is already on the branch.
 */
export function workersHoldingReady(ctx: AppCtx, featureId: string): WorkerRow[] {
  return listWorkers(ctx, featureId).filter(
    (w) => HOLDS_READY.has(w.status) && !isDriveWorkerKind(w.kind) && !(w.kind === 'review' && w.status === 'handed-back'),
  )
}


// --- the preview ----------------------------------------------------------------

/** How long a preview's sandbox is taken as running before a request checks again. */
const PREVIEW_RECHECK_MS = 15_000

interface PreviewWake {
  /** The check (and start, if it was stopped) made at `at`; true when it had to start it. */
  checked: Promise<boolean>
  at: number
  /** Stops the sandbox once the preview has gone unopened for the idle time, should no agent run in it. */
  idle?: ReturnType<typeof setTimeout>
}

const previewWakes = new Map<string, PreviewWake>()

/** Whether a worker's sandbox is up for a preview someone opened lately: its own idle stop stops it, not the sweep. */
export function previewAwake(id: string): boolean {
  return previewWakes.has(id)
}

/** A worker whose sandbox may serve a preview: started, and neither dropped nor failed. */
function previewSandbox(ctx: AppCtx, id: string): { w: WorkerRow; sb: WorkerSandbox } | undefined {
  const w = getWorker(ctx, id)
  if (!w || w.status === 'dropped' || w.status === 'failed') return undefined
  const sb = sandboxOf(ctx, w)
  return sb ? { w, sb } : undefined
}

/**
 * A worker's previews as the design pass-through reaches them (decision 15):
 * its published port on the host's loopback, and a wake that starts a stopped
 * sandbox and its dev server but never its agent. A sandbox woken for a
 * preview stops again once the preview goes unopened for the idle time, unless
 * its agent has started meanwhile, whose own idle stop then stops it.
 */
export function workerPreviews(ctx: AppCtx, idleMs = IDLE_STOP_MS): WorkerPreviews {
  return {
    url(id) {
      // A worker on the host runs its dev server on its own port, on this machine (workers-build-in-the-feature-s-folder).
      const host = getWorker(ctx, id)
      if (host && host.folder !== null) {
        if (host.status === 'dropped' || host.status === 'failed' || host.status === 'landed' || host.previewPort === null) return undefined
        return `http://127.0.0.1:${host.previewPort}/`
      }
      const found = previewSandbox(ctx, id)
      return found ? `http://127.0.0.1:${found.sb.port}/` : undefined
    },
    async wake(id) {
      // Nothing to wake on the host: the dev server is up or it is not.
      if (getWorker(ctx, id)?.folder) return
      const found = previewSandbox(ctx, id)
      if (!found) return
      const { w, sb } = found
      const engine = sandboxEngine(w.engine)
      let wake = previewWakes.get(id)
      if (!wake || Date.now() - wake.at > PREVIEW_RECHECK_MS) {
        const checked = engine.wake(sb).then((started) => {
          if (started) emitWorker(ctx, w, 'worker.preview_woken', `worker "${w.label}" sandbox started for its preview`)
          return started
        })
        wake = { checked, at: Date.now(), ...(wake?.idle ? { idle: wake.idle } : {}) }
        previewWakes.set(id, wake)
      }
      try {
        await wake.checked
      } catch (err) {
        previewWakes.delete(id)
        throw err
      }
      if (wake.idle) clearTimeout(wake.idle)
      wake.idle = setTimeout(() => void stopIdlePreview(ctx, id), idleMs)
      wake.idle.unref?.()
    },
  }
}

/** The preview went unopened for the idle time: stop its sandbox, unless the worker's agent runs in it. */
async function stopIdlePreview(ctx: AppCtx, id: string): Promise<void> {
  previewWakes.delete(id)
  if (agentHost(ctx).isRunning(id)) return
  const found = previewSandbox(ctx, id)
  if (!found) return
  await sandboxEngine(found.w.engine).stop(found.sb).catch(() => {})
  emitWorker(ctx, found.w, 'worker.stopped', `worker "${found.w.label}" sandbox stopped (preview idle)`, { reason: 'idle' })
}

// --- reads ----------------------------------------------------------------------

/**
 * Whether a turn of the worker runs now: its agent runs and is not waiting on
 * an ask. The fact "Working" reads by, everywhere (a-worker-never-shows-working-with-nothing-running decision 1).
 */
export function turnRunning(ctx: AppCtx, id: string): boolean {
  return agentHost(ctx).isRunning(id) && getSessionRow(ctx, id)?.awaitingInput === false
}

/** The status a worker shows, the web's and the agents' alike: a `working` one with no turn running reads idle. */
export function shownStatusOf(ctx: AppCtx, w: WorkerRow): ShownWorkerStatus {
  return shownWorkerStatus({ status: w.status, need: threadNeed(ctx, w), turnRunning: turnRunning(ctx, w.id) })
}

/** A worker as the lead reads it in `get_feature_context` (spec, "Lead tools"). */
export interface LeadWorker {
  id: string
  label: string
  purpose: string
  kind: WorkerKind
  /** As shown: Working only while a turn runs (decision 1). */
  status: ShownWorkerStatus
  startedBy: WorkerStartedBy
  model: string
  branch: string | null
  /** Where it builds on this machine: the feature's folder, or its own (where the lead runs the checks before landing it). */
  folder?: string
  updatedAt: number
  handback?: { summary: string; commits: string[]; files: string[] }
  outcome?: { did: NonNullable<WorkerRow['outcome']>; note?: string }
}

export function leadWorkers(ctx: AppCtx, featureId: string): LeadWorker[] {
  return listWorkers(ctx, featureId).map((w) => ({
    id: w.id,
    label: w.label,
    purpose: w.purpose,
    kind: w.kind,
    status: shownStatusOf(ctx, w),
    startedBy: w.startedBy,
    model: w.model,
    branch: w.branch,
    ...(w.folder !== null ? { folder: w.folder } : {}),
    updatedAt: w.updatedAt,
    ...(w.handbackSummary !== null
      ? { handback: { summary: w.handbackSummary, commits: w.handbackCommits ?? [], files: w.handbackFiles ?? [] } }
      : {}),
    ...(w.outcome ? { outcome: { did: w.outcome, ...(w.outcomeNote ? { note: w.outcomeNote } : {}) } } : {}),
  }))
}
