import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { and, count, eq, inArray, ne } from 'drizzle-orm'
import {
  type Ask,
  type Feature,
  type ModelEntry,
  type PromptDisplay,
  type ReviewVerify,
  type ReviewWorkerMode,
  type SessionRow,
  type WorkerKind,
  type WorkerRow,
  type WorkerStartedBy,
  type WorkerStatus,
  isUsageLimitText,
  type Project,
  modelEntryFor,
  resolveBurnCacheMode,
  resolveModelEntry,
  resolvePreparedSettings,
  resolveSandboxImage,
} from '@runcastle/core'
import { envPath, sessionDir } from '@runcastle/core/paths'
import { features, workers } from '../db/schema'
import type { AppCtx } from '../db/types'
import { GateError, NotFoundError } from '../errors'
import { chatKickoffHeader } from '../launcher/launcher'
import { createSessionRow, getSessionRow, newestThread, setSessionTitle } from '../launcher/sessions'
import { type AgentErrorClass, classifyAgentError, retryDelayMs } from '../services/agent-errors'
import { agentSlots } from '../services/agent-slots'
import { emit, listAfter } from '../services/events'
import { branchChangesAhead, mergeTempBranch, type TempBranchMergeResult } from '../services/git'
import { featureLandingQueue } from '../services/landing-queue'
import { deliverToLead } from '../services/lead-delivery'
import { mainChatExcerpt } from '../services/main-chat-excerpt'
import { rosterConfig } from '../services/model-discovery'
import { getFeatureRow, projectForFeature, tryGetFeature } from '../services/repo'
import { requireAnnotatedModels } from '../services/tickets'
import type { AgentTransport, StallBounds, TurnEnding } from '../threads/host'
import type { StopReason } from '../threads/types'
import { claudeTranscriptPath } from '../threads/side-channels'
import { agentHost, readThreadEvents } from '../threads/types'
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
import { workerMcpServer } from './sandbox'
import { type WorkerSetup, claudeSetup, setupFingerprint } from './setup-copy'
import { workerTools } from './tools'
import {
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
import { type HandbackNote, type NewSandboxInput, type WorkerBrief, type WorkerSandbox, workerBriefing, workersDir } from './worker'

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

function requireWorker(ctx: AppCtx, id: string): WorkerRow {
  const w = getWorker(ctx, id)
  if (!w) throw new NotFoundError(`no worker ${id}`)
  return w
}

/** A feature's workers, oldest first. */
export function listWorkers(ctx: AppCtx, featureId: string): WorkerRow[] {
  return ctx.db.select().from(workers).where(eq(workers.featureId, featureId)).orderBy(workers.createdAt).all()
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
  return new Map(rows.map((r) => [r.featureId, r.n]))
}

/** A worker of `featureId`: refuses another feature's, so a lead acts only on its own workers. */
export function requireFeatureWorker(ctx: AppCtx, featureId: string, id: string): WorkerRow {
  const w = getWorker(ctx, id)
  if (!w || w.featureId !== featureId) throw new NotFoundError(`no worker ${id} on this feature — get_feature_context lists its workers`)
  return w
}

function updateWorker(ctx: AppCtx, id: string, patch: Partial<Omit<WorkerRow, 'id' | 'createdAt'>>): WorkerRow {
  ctx.db
    .update(workers)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(workers.id, id))
    .run()
  return requireWorker(ctx, id)
}

/** Emit `type` for `w` on its feature's timeline, with its id and status. */
function emitWorker(ctx: AppCtx, w: WorkerRow, type: string, message: string, data: Record<string, unknown> = {}): void {
  emit(ctx, w.featureId, { type, message, data: { workerId: w.id, label: w.label, status: w.status, ...data } })
}

/** Set a worker's status and say so (`worker.status`); a no-op when it is already there. */
function setStatus(ctx: AppCtx, w: WorkerRow, status: WorkerStatus): WorkerRow {
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
function sandboxOf(ctx: AppCtx, w: WorkerRow): WorkerSandbox | null {
  if (!w.container || !w.branch || w.previewPort === null) return null
  const feature = getFeatureRow(ctx, w.featureId)
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
function humanPreviewUrl(ctx: AppCtx, workerId: string): string {
  return `http://localhost:${phoneDesignPort(ctx.config)}${workerPreviewPath(workerId)}`
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
    // A drive review runs on the host, in the human's checkout: its launch (`acpLaunchInput`) briefs it there.
    if (isHostReview(w)) return base(spec, row)
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
  /** One of the human's annotated models; the feature chat's model when omitted. */
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

function workerModel(ctx: AppCtx, feature: Feature, model: string | undefined): ModelEntry {
  requireAnnotatedModels(ctx, [model])
  const roster = rosterConfig(ctx)
  return model?.trim() ? modelEntryFor(model.trim(), roster) : resolveModelEntry('chat', roster, projectForFeature(ctx, feature))
}

/** The short tail of a worker id its container and branch are named by. */
function shortId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '').slice(-10).toLowerCase()
}

/**
 * Start a worker on `feature`: its thread, its record, its sandbox, then its
 * kickoff. Resolves once the sandbox is up and the kickoff is on its way. A
 * sandbox that fails to come up leaves the worker `failed` with what failed.
 */
export async function startWorker(ctx: AppCtx, feature: Feature, input: StartWorkerInput): Promise<StartedWorker> {
  const model = workerModel(ctx, feature, input.model)
  const engine = sandboxEngine(ctx.config.sandbox)
  if (!(await engine.available())) throw new GateError(noEngineMessage(engine.name))
  const project = projectForFeature(ctx, feature)
  const mainChat = newestThread(ctx, { featureId: feature.id }, 'chat')
  // Nothing of the worker lives on the host: a stand-in dir, so host-side snapshots find nothing.
  const placeholder = join(workersDir(), 'host')
  mkdirSync(placeholder, { recursive: true })
  const session = createSessionRow(ctx, {
    featureId: feature.id,
    kind: 'worker',
    worktreePath: placeholder,
    model,
    ...(mainChat ? { openedBeside: mainChat.id } : {}),
  })
  setSessionTitle(ctx, session.id, input.label)
  const now = Date.now()
  ctx.db
    .insert(workers)
    .values({
      id: session.id,
      featureId: feature.id,
      label: input.label,
      purpose: input.purpose,
      kind: input.kind,
      goal: input.goal?.trim() || null,
      doneWhen: input.doneWhen?.trim() || null,
      model: model.id,
      runtime: model.runtime,
      startedBy: input.startedBy,
      status: 'working',
      engine: engine.name,
      featureBranch: feature.branch,
      ...(input.review ? { reviewMode: 'gates' as const, reviewVerify: input.review.verify } : {}),
      createdAt: now,
      updatedAt: now,
    })
    .run()
  if (input.review) keepReviewAssignment(session.id, input.review.assignment)
  const short = shortId(session.id)
  let sb: WorkerSandbox
  try {
    // The image first: a build that fails fails this start like a setup failure (decision 11).
    await engine.prepare({ image: imageBuildCtx(ctx, feature, session.id), config: ctx.config })
    sb = await engine.create({
      id: session.id,
      engine: engine.name,
      runtime: model.runtime,
      container: `runcastle-worker-${short}`,
      branch: `runcastle/worker/${short}`,
      // Read again: the build may have adopted a new project image.
      image: resolveSandboxImage(ctx.config, projectForFeature(ctx, feature)),
      repoPath: project.repoPath,
      featureBranch: feature.branch,
      // A review reads its diff against the base, which a worker's copy of the feature branch alone lacks.
      ...(input.review && feature.baseBranch ? { baseBranch: feature.baseBranch } : {}),
      takenPorts: takenPorts(ctx),
      ...sandboxSetup(ctx, project),
    })
  } catch (err) {
    const failure = err instanceof Error ? err.message : String(err)
    const failed = updateWorker(ctx, session.id, { status: 'failed', failure: failure.slice(0, 2000) })
    emitWorker(ctx, failed, 'worker.failed', `worker "${input.label}" could not start its sandbox`, { failure })
    throw new GateError(`worker "${input.label}" could not start its sandbox: ${failure}`)
  }
  const started = updateWorker(ctx, session.id, { container: sb.container, branch: sb.branch, previewPort: sb.port })
  emitWorker(ctx, started, 'worker.started', `worker "${input.label}" started in its sandbox`, {
    sessionId: session.id,
    kind: input.kind,
    startedBy: input.startedBy,
    branch: sb.branch,
    previewUrl: humanPreviewUrl(ctx, session.id),
  })
  await agentHost(ctx).prompt(session.id, { text: workerKickoff(ctx, started) }, { source: 'runcastle' })
  return { workerId: session.id, branch: sb.branch, previewUrl: humanPreviewUrl(ctx, session.id) }
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
  /** `gates` when the feature has nothing to drive; omitted, a drive whenever this host can drive the project. */
  mode?: ReviewWorkerMode
  /** A verify review's findings and fix commits; omitted for a first review. */
  verify?: ReviewVerify
  model?: string
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
    const assignment = await renderReviewAssignment(ctx, feature, project, { mode, passId: '' }, verify)
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
  const model = workerModel(ctx, feature, input.model)
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
  keepReviewAssignment(session.id, await renderReviewAssignment(ctx, feature, project, { mode, passId: session.id }, verify))
  const w = requireWorker(ctx, session.id)
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
  const feature = getFeatureRow(ctx, w.featureId)
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

/** A drive review is done with the drive (handed back, failed, dropped, stopped): give the slot back and stop its recorder. */
async function giveDriveBack(ctx: AppCtx, w: WorkerRow): Promise<void> {
  if (!isHostReview(w)) return
  stopDriveWait(w.id)
  forgetDriveWait(w.id)
  const feature = tryGetFeature(ctx, w.featureId)
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
  // A drive review's conversation is on the host: its tokens are counted as it hands back (decision 12).
  if (isHostReview(w)) await keepConversation(ctx, w)
  const handed = updateWorker(ctx, w.id, {
    status: 'handed-back',
    handbackSummary: note.summary,
    handbackCommits: [],
    handbackFiles: [],
    outcome: null,
    outcomeNote: null,
  })
  const findings = listFindings(ctx, w.featureId).filter((f) => f.reviewWorkerId === w.id)
  emitWorker(ctx, handed, 'worker.handed_back', `worker "${w.label}" handed back`, { commits: 0, files: 0, findings: findings.length })
  const feature = tryGetFeature(ctx, w.featureId)
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
  const feature = getFeatureRow(ctx, w.featureId)
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
 * one that ended otherwise without a handback leaves a working worker needing
 * the human (decision 5).
 */
export async function workerTurnEnded(ctx: AppCtx, row: Pick<SessionRow, 'id'>, end?: TurnEnding): Promise<void> {
  const w = getWorker(ctx, row.id)
  if (!w) return
  // The usage limit is left to the host, under the human's carry-on setting (burns-become-workers decision 7).
  const error = end?.reason === 'error' && !isUsageLimitText(end.error ?? '') ? end.error || 'the turn failed' : undefined
  const failed = error !== undefined && w.status === 'working' ? { error, verdict: classifyAgentError(error, w.runtime) } : undefined
  // Held before anything here awaits: the slot this turn just gave back must not start a queued turn on the same account.
  const held = failed?.verdict === 'account' ? holdQueue(ctx, w, errorLine(failed.error)) : undefined
  const sb = sandboxOf(ctx, w)
  const engine = sandboxEngine(w.engine)
  const note = sb ? await engine.takeHandback(sb) : isHostReview(w) ? takeHostHandback(w.id) : undefined
  if (sb && !w.devServer && (await engine.devServerStarted(sb))) updateWorker(ctx, w.id, { devServer: true })
  if (!note && failed) return recoverFromError(ctx, w, failed.error, failed.verdict, held)
  forgetRetries(w.id)
  if (note && w.kind === 'review') return reviewHandedBack(ctx, w, note)
  // A drive review stopped mid-turn gives the human their drive back; it takes it again with review_drive.
  if (!note && end?.reason === 'cancelled') await giveDriveBack(ctx, w)
  if (!note || !sb) {
    if (w.status === 'working') setStatus(ctx, w, 'needs-you')
    return
  }
  await engine.fetchBranch(sb)
  const changes = await branchChangesAhead(sb.repoPath, w.featureBranch, sb.branch)
  const commits = changes.commits.map((c) => `${c.sha.slice(0, 7)} ${c.subject}`)
  const handed = updateWorker(ctx, w.id, {
    status: 'handed-back',
    handbackSummary: note.summary,
    handbackCommits: commits,
    handbackFiles: changes.files,
    outcome: null,
    outcomeNote: null,
  })
  emitWorker(ctx, handed, 'worker.handed_back', `worker "${w.label}" handed back`, { commits: commits.length, files: changes.files.length })
  const feature = tryGetFeature(ctx, w.featureId)
  if (!feature) return
  const display: PromptDisplay = {
    handback: { workerId: w.id, label: w.label, kind: w.kind, summary: note.summary, commits, files: changes.files, threadId: w.id },
  }
  await deliverToLead(ctx, feature, { text: handbackText(handed, commits, changes.files), source: 'runcastle', display })
}

/** What the lead reads of a handback: the summary, the work, and its three choices. */
function handbackText(w: WorkerRow, commits: string[], files: string[]): string {
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

// --- recovering by itself (burns-become-workers decisions 8, 9, 21) ---------------

/** How many times a worker's failed turn is retried on a transient error before it fails. */
export const MAX_TRANSIENT_RETRIES = 3

/** A worker turn's stall bounds (decision 9): ten quiet minutes with no command running, or one command for 45. */
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

/** Why a queued worker is held (decision 21), or null when it is not. */
export function queueHoldOf(ctx: AppCtx, w: WorkerRow): string | null {
  return w.status === 'queued' ? (agentSlots(ctx.config.burnConcurrency).holdOf(w.runtime) ?? null) : null
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
 */
export function workerTurnSlot(ctx: AppCtx): (row: SessionRow) => Promise<() => void> | undefined {
  return (row) => (row.kind === 'worker' ? takeWorkerSlot(ctx, row.id) : undefined)
}

async function takeWorkerSlot(ctx: AppCtx, id: string): Promise<() => void> {
  const slots = agentSlots(ctx.config.burnConcurrency)
  const w = getWorker(ctx, id)
  const now = slots.tryTake(w?.runtime)
  if (now) return now
  if (w && (w.status === 'working' || w.status === 'needs-you')) setStatus(ctx, w, 'queued')
  let release = await slots.take(w?.runtime)
  // Admitted by a slot freed by a turn whose failure then held this runtime: wait again.
  while (w && slots.holdOf(w.runtime) !== undefined) {
    release()
    release = await slots.take(w.runtime)
  }
  const after = getWorker(ctx, id)
  if (after?.status === 'queued') setStatus(ctx, after, 'working')
  return release
}

/**
 * A permission or question ask opened on a worker's thread: its agent halts
 * mid-turn on the human, so the worker needs them until it is answered. The
 * feature's need already pings for the ask itself (interactive-workers decision
 * 10); this only makes the worker's own row say so. An MCP server's form or link
 * is the agent's own errand, as it is for the feature's need.
 */
export function workerAskOpened(ctx: AppCtx, id: string, kind: Ask['kind']): void {
  if (kind !== 'approval' && kind !== 'question') return
  const w = getWorker(ctx, id)
  if (w?.status === 'working') setStatus(ctx, w, 'needs-you')
}

/** The human answered a worker's open ask: it is working again. */
export function workerAskAnswered(ctx: AppCtx, id: string): void {
  workerPrompted(ctx, id)
}

/** The human typed to a worker: a worker waiting on them is working again. */
export function workerPrompted(ctx: AppCtx, id: string): void {
  const w = getWorker(ctx, id)
  if (w?.status === 'needs-you') setStatus(ctx, w, 'working')
}

/**
 * The feature's Stop (burns-become-workers decision 15): cancel the turn of
 * every worker of it that is working or queued — a turn waiting for its slot,
 * a retry waiting out its backoff, a drive review waiting for the drive. Each
 * stays where it is, enterable, and needs the human; nothing starts it again
 * until someone writes to it.
 */
export async function stopFeatureWorkers(ctx: AppCtx, featureId: string): Promise<void> {
  const live = listWorkers(ctx, featureId).filter((w) => w.status === 'working' || w.status === 'queued')
  for (const w of live) {
    forgetRetries(w.id)
    stopDriveWait(w.id)
    // Needs the human first, so a turn its cancel ends finds nothing left to move.
    setStatus(ctx, w, 'needs-you')
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
  if (!sb || w.status === 'dropped') return
  await sandboxEngine(w.engine).stop(sb)
  if (tryGetFeature(ctx, w.featureId)) emitWorker(ctx, w, 'worker.stopped', `worker "${w.label}" sandbox stopped (${reason})`, { reason })
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
  const feature = tryGetFeature(ctx, w.featureId)
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

function requireOpen(w: WorkerRow): void {
  if (w.status === 'dropped') throw new GateError(`worker "${w.label}" was dropped`)
  if (w.status === 'failed') throw new GateError(`worker "${w.label}" failed: ${w.failure ?? 'its sandbox is gone'}`)
}

/**
 * Send a worker a message (decision 17): a runcastle prompt into its thread,
 * which waits for the end of a turn that is running. A worker waiting on the
 * human is working again.
 */
export async function messageWorker(ctx: AppCtx, id: string, text: string): Promise<{ ok: true }> {
  const w = requireWorker(ctx, id)
  requireOpen(w)
  // Working before the prompt goes: a turn that must wait for a slot then reads `queued` over it.
  const next = w.status === 'needs-you' ? setStatus(ctx, w, 'working') : w
  await agentHost(ctx).prompt(w.id, { text }, { source: 'runcastle' })
  emitWorker(ctx, next, 'worker.messaged', `message sent to worker "${w.label}"`, { text })
  return { ok: true }
}

/** The Hand back button (decision 5): ask the worker to write its summary and hand back. */
export function askWorkerToHandBack(ctx: AppCtx, id: string): Promise<{ ok: true }> {
  return messageWorker(
    ctx,
    id,
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
  if (w.kind === 'review') throw new GateError(`worker "${w.label}" is a review: it writes no code, so nothing lands. Resolve its findings instead.`)
  if (w.status !== 'handed-back') throw new GateError(`worker "${w.label}" is ${w.status}: only a handed-back worker lands`)
  const sb = sandboxOf(ctx, w)
  if (!sb) throw new GateError(`worker "${w.label}" has no sandbox to land from`)
  const feature = getFeatureRow(ctx, w.featureId)
  await sandboxEngine(w.engine).fetchBranch(sb)
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
      await sendBack(ctx, w, conflictSendBackText(feature.branch, files, behind), 'runcastle sent it back to resolve a landing conflict', { conflict: true, files })
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
  emitWorker(ctx, landed, 'worker.landed', `worker "${w.label}" landed ${changes.commits.length} commit(s) on ${feature.branch}`, {
    commits: changes.commits.length,
    files: changes.files.length,
  })
  return { ok: true, commits: changes.commits.length, files: changes.files.length }
}

/** Send a handed-back worker's work back with a note (decision 4): the note goes to the worker, which works again. */
export async function sendBackWorker(ctx: AppCtx, id: string, note: string): Promise<{ ok: true }> {
  const w = requireWorker(ctx, id)
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
  await agentHost(ctx).prompt(w.id, { text }, { source: 'runcastle' })
}

/** How many times runcastle has sent `w` back to resolve a landing conflict, read off its feature's timeline. */
function conflictSendBacks(ctx: AppCtx, w: WorkerRow): number {
  return listAfter(ctx, w.featureId, 0).filter((e) => {
    const data = e.data as { workerId?: string; conflict?: boolean } | null
    return e.type === 'worker.sent_back' && data?.workerId === w.id && data.conflict === true
  }).length
}

/** What a worker sent back over a landing conflict is told: the files, the commits it lacks, and how to resolve it. */
function conflictSendBackText(featureBranch: string, files: string[], behind: string[]): string {
  return [
    `Your work could not land: it conflicts with ${featureBranch}, which moved on since you started.`,
    '',
    `Conflicting files: ${files.length ? files.join(', ') : 'git did not name them'}`,
    '',
    `Commits on ${featureBranch} your branch lacks:`,
    ...(behind.length ? behind.map((c) => `- ${c}`) : ['- none listed']),
    '',
    `Run \`git fetch origin && git merge origin/${featureBranch}\` on your branch, resolve each conflict keeping both sides' intent, ` +
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
  if (w.status === 'landed') throw new GateError(`worker "${w.label}" already landed; there is nothing to drop`)
  await retireWorker(ctx, w)
  return { ok: true }
}

/** Stop a worker's process, remove its sandbox and branch, and mark it dropped unless it landed. */
async function retireWorker(ctx: AppCtx, w: WorkerRow): Promise<void> {
  forgetRetries(w.id)
  const drops = w.status !== 'dropped' && w.status !== 'landed'
  const dropped = drops ? updateWorker(ctx, w.id, { status: 'dropped', outcome: 'dropped', outcomeNote: null }) : w
  await agentHost(ctx).stop(w.id, 'archived')
  await giveDriveBack(ctx, w)
  if (hasConversation(w)) await keepConversation(ctx, w)
  const sb = sandboxOf(ctx, w)
  if (sb) await sandboxEngine(w.engine).remove(sb)
  if (drops) emitWorker(ctx, dropped, 'worker.dropped', `worker "${w.label}" was dropped`)
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
    const read = isHostReview(w) ? keepHostConversation(ctx, w, kept) : await keepSandboxConversation(ctx, w, kept)
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
 * A drive review's conversation file is on the host already (it ran there):
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

/** Whether a worker has a conversation file to keep: a sandbox's, or a drive review's on the host. */
function hasConversation(w: WorkerRow): boolean {
  return !!w.container || isHostReview(w)
}

/** Keep every worker's conversation of a feature, so a record written before its sandboxes go (the outcome) carries their tokens. */
export async function keepFeatureConversations(ctx: AppCtx, featureId: string): Promise<void> {
  for (const w of listWorkers(ctx, featureId)) if (hasConversation(w) && w.status !== 'dropped') await keepConversation(ctx, w)
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
const HOLDS_READY: ReadonlySet<WorkerStatus> = new Set(['working', 'queued', 'needs-you', 'handed-back'])

/** The feature's workers still at work or holding work that has not landed; a review that handed back holds nothing to land. */
export function workersHoldingReady(ctx: AppCtx, featureId: string): WorkerRow[] {
  return listWorkers(ctx, featureId).filter((w) => HOLDS_READY.has(w.status) && !(w.kind === 'review' && w.status === 'handed-back'))
}

/**
 * Server boot: the idle stops that would have stopped worker sandboxes lived in
 * the last server's memory, so every sandbox it left running (an agent's, or one
 * woken only for its preview) would run on forever. Each worker's running
 * container is stopped, to wake at its next message or preview as usual; one of
 * a landed or dropped worker, which should be gone, is removed. Only this data
 * dir's workers are touched, never another install's containers on the same
 * engine, and none whose agent still runs (a `bun --hot` reload keeps them).
 */
export async function stopLeftoverWorkerSandboxes(ctx: AppCtx): Promise<{ stopped: number; removed: number }> {
  const done = { stopped: 0, removed: 0 }
  const rows = ctx.db.select().from(workers).all().filter((w) => w.container)
  const host = agentHost(ctx)
  const containersOf = new Map<string, Promise<Map<string, boolean>>>()
  for (const w of rows) {
    const engine = sandboxEngine(w.engine)
    if (!containersOf.has(w.engine)) containersOf.set(w.engine, engine.containers().catch(() => new Map<string, boolean>()))
    const running = (await containersOf.get(w.engine)!).get(w.container!)
    if (running === undefined || host.isRunning(w.id)) continue
    try {
      const sb = sandboxOf(ctx, w)
      if (!sb) continue
      const terminal = w.status === 'landed' || w.status === 'dropped'
      if (!terminal && !running) continue
      if (terminal) await engine.remove(sb)
      else await engine.stop(sb)
      done[terminal ? 'removed' : 'stopped']++
      if (!tryGetFeature(ctx, w.featureId)) continue
      if (terminal) emitWorker(ctx, w, 'worker.sandbox_removed', `worker "${w.label}" leftover sandbox removed at server start`)
      else emitWorker(ctx, w, 'worker.stopped', `worker "${w.label}" sandbox stopped (server restart)`, { reason: 'restart' })
    } catch (err) {
      console.error(`worker ${w.id}: leftover sandbox`, err)
    }
  }
  return done
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
      const found = previewSandbox(ctx, id)
      return found ? `http://127.0.0.1:${found.sb.port}/` : undefined
    },
    async wake(id) {
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

/** A worker as the lead reads it in `get_feature_context` (spec, "Lead tools"). */
export interface LeadWorker {
  id: string
  label: string
  purpose: string
  kind: WorkerKind
  status: WorkerStatus
  startedBy: WorkerStartedBy
  model: string
  branch: string | null
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
    status: w.status,
    startedBy: w.startedBy,
    model: w.model,
    branch: w.branch,
    updatedAt: w.updatedAt,
    ...(w.handbackSummary !== null
      ? { handback: { summary: w.handbackSummary, commits: w.handbackCommits ?? [], files: w.handbackFiles ?? [] } }
      : {}),
    ...(w.outcome ? { outcome: { did: w.outcome, ...(w.outcomeNote ? { note: w.outcomeNote } : {}) } } : {}),
  }))
}
