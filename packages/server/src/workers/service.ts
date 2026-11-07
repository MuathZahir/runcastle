import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { eq, ne } from 'drizzle-orm'
import {
  type Feature,
  type ModelEntry,
  type PromptDisplay,
  type SessionRow,
  type WorkerKind,
  type WorkerRow,
  type WorkerStartedBy,
  type WorkerStatus,
  modelEntryFor,
  resolveModelEntry,
  resolveSandboxImage,
} from '@runcastle/core'
import { envPath } from '@runcastle/core/paths'
import { workers } from '../db/schema'
import type { AppCtx } from '../db/types'
import { GateError, NotFoundError } from '../errors'
import { chatKickoffHeader } from '../launcher/launcher'
import { createSessionRow, newestThread, setSessionTitle } from '../launcher/sessions'
import { agentSlots } from '../services/agent-slots'
import { emit } from '../services/events'
import { branchChangesAhead, mergeTempBranch, type TempBranchMergeResult } from '../services/git'
import { featureLandingQueue } from '../services/landing-queue'
import { deliverToLead } from '../services/lead-delivery'
import { mainChatExcerpt } from '../services/main-chat-excerpt'
import { rosterConfig } from '../services/model-discovery'
import { getFeatureRow, projectForFeature, tryGetFeature } from '../services/repo'
import { requireAnnotatedModels } from '../services/tickets'
import type { AgentTransport } from '../threads/host'
import type { StopReason } from '../threads/types'
import { agentHost, readThreadEvents } from '../threads/types'
import { sandboxEngine } from './engine'
import { type WorkerPreviews, workerPreviewPath } from '../routes/design-pass-paths'
import { phoneDesignPort } from '../services/phone-link'
import { IDLE_STOP_MS } from '../threads/host'
import type { WorkerPermissionMode } from './permissions'
import { codexHomeDir } from '../services/codex-auth'
import { codexSetup } from './codex-setup'
import { workerMcpServer } from './sandbox'
import { type WorkerSetup, claudeSetup } from './setup-copy'
import { workerTools } from './tools'
import { type WorkerBrief, type WorkerSandbox, workerBriefing, workersDir } from './worker'

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
    const sb = sandboxOf(ctx, w)
    if (!sb) throw new Error(`worker "${w.label}" has no sandbox${w.failure ? `: ${w.failure}` : ''}`)
    const launched = sb.runtime === 'claude-code' ? (spec.sessionMeta as { claudeCode?: { options?: { model?: string } } } | undefined)?.claudeCode?.options?.model : undefined
    const model = launched ?? w.model
    const engine = sandboxEngine(w.engine)
    // At every start and wake, so a change to the human's setup reaches the worker's next turn (decisions 8, 12).
    await engine.copySetup(sb, workerSetup(sb, briefOf(w), model))
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
  return codexSetup(codexHomeDir(), { model, briefing: workerBriefing(sb, brief), mcp: workerMcpServer(sb.port, sb.previewUrl) })
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
  setSessionTitle(ctx, session.id, `Worker: ${input.label}`)
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
      createdAt: now,
      updatedAt: now,
    })
    .run()
  const short = shortId(session.id)
  let sb: WorkerSandbox
  try {
    sb = await engine.create({
      id: session.id,
      engine: engine.name,
      runtime: model.runtime,
      container: `runcastle-worker-${short}`,
      branch: `runcastle/worker/${short}`,
      image: resolveSandboxImage(ctx.config, project),
      repoPath: project.repoPath,
      featureBranch: feature.branch,
      takenPorts: takenPorts(ctx),
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

/**
 * A worker's first prompt. An assigned worker starts on its goal; an
 * unassigned one is told the feature's state and the lead's latest turns (as a
 * side chat was) and to wait for the human. Its briefing (how it works, how it
 * hands back) rides its system prompt.
 */
export function workerKickoff(ctx: AppCtx, w: WorkerRow): string {
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
 * files, marks it handed back and wakes the lead once (decision 4); a turn that
 * ended without one leaves a working worker needing the human (decision 5).
 */
export async function workerTurnEnded(ctx: AppCtx, row: Pick<SessionRow, 'id'>): Promise<void> {
  const w = getWorker(ctx, row.id)
  if (!w) return
  const sb = sandboxOf(ctx, w)
  const engine = sandboxEngine(w.engine)
  const note = sb ? await engine.takeHandback(sb) : undefined
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

/**
 * The slot a worker's turn holds under the machine's limit of agents working
 * at once (decision 14), for the agent host's `turnSlot`: none for any other
 * thread. A worker that has to wait is `queued` until its slot comes, then
 * working again; one waiting on the human or stopped holds none, since only a
 * running turn asks.
 */
export function workerTurnSlot(ctx: AppCtx): (row: SessionRow) => Promise<() => void> | undefined {
  return (row) => (row.kind === 'worker' ? takeWorkerSlot(ctx, row.id) : undefined)
}

async function takeWorkerSlot(ctx: AppCtx, id: string): Promise<() => void> {
  const slots = agentSlots(ctx.config.burnConcurrency)
  const now = slots.tryTake()
  if (now) return now
  const w = getWorker(ctx, id)
  if (w && (w.status === 'working' || w.status === 'needs-you')) setStatus(ctx, w, 'queued')
  const release = await slots.take()
  const after = getWorker(ctx, id)
  if (after?.status === 'queued') setStatus(ctx, after, 'working')
  return release
}

/** The human typed to a worker: a worker waiting on them is working again. */
export function workerPrompted(ctx: AppCtx, id: string): void {
  const w = getWorker(ctx, id)
  if (w?.status === 'needs-you') setStatus(ctx, w, 'working')
}

/**
 * A worker's process stopped: an idle or archive stop stops its sandbox too; a
 * crash (its container died, its sandbox would not wake, its agent exited)
 * fails it (decision 16).
 */
export async function workerStopped(ctx: AppCtx, row: Pick<SessionRow, 'id'>, reason: StopReason): Promise<void> {
  const w = getWorker(ctx, row.id)
  if (!w) return
  if (reason === 'crashed') return failWorker(ctx, w, crashFailure(w.id))
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
async function failWorker(ctx: AppCtx, w: WorkerRow, failure: string): Promise<void> {
  if (w.status === 'failed' || w.status === 'dropped' || w.status === 'landed') return
  const short = failure.slice(0, 2000)
  const failed = updateWorker(ctx, w.id, { status: 'failed', failure: short })
  emitWorker(ctx, failed, 'worker.failed', `worker "${w.label}" failed: ${short}`, { failure: short, from: w.status })
  const feature = tryGetFeature(ctx, w.featureId)
  if (!feature) return
  await deliverToLead(ctx, feature, {
    text:
      `Worker "${w.label}" failed (worker ${w.id}): ${short}\n\n` +
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
  | { ok: false; conflict: boolean; files: string[]; error: string }

/**
 * Land a handed-back worker's branch on the feature branch, through the
 * feature's landing queue like the lead's own commits (decision 4). A conflict
 * comes back to the lead to resolve, and the worker stays handed back.
 */
export async function landWorker(ctx: AppCtx, id: string): Promise<LandWorkerResult> {
  const w = requireWorker(ctx, id)
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
    emitWorker(ctx, w, 'worker.land_failed', `worker "${w.label}" could not land: ${error}`, { conflict: !!result.conflict, files: result.files ?? [] })
    return {
      ok: false,
      conflict: !!result.conflict,
      files: result.files ?? [],
      error: result.conflict
        ? `${sb.branch} conflicts with ${feature.branch}. Merge ${sb.branch} into your checkout yourself, resolve and commit, then call land_worker again.`
        : error,
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
  const sent = updateWorker(ctx, w.id, { status: 'working', outcome: 'sent-back', outcomeNote: note })
  emitWorker(ctx, sent, 'worker.sent_back', `worker "${w.label}" was sent back`, { note })
  await agentHost(ctx).prompt(w.id, { text: `Your lead sent your work back:\n\n${note}\n\nWork on it, then hand back again.` }, { source: 'runcastle' })
  return { ok: true }
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
  const drops = w.status !== 'dropped' && w.status !== 'landed'
  const dropped = drops ? updateWorker(ctx, w.id, { status: 'dropped', outcome: 'dropped', outcomeNote: null }) : w
  await agentHost(ctx).stop(w.id, 'archived')
  const sb = sandboxOf(ctx, w)
  if (sb) await sandboxEngine(w.engine).remove(sb)
  if (drops) emitWorker(ctx, dropped, 'worker.dropped', `worker "${w.label}" was dropped`)
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

/** The feature's workers still at work or holding work that has not landed. */
export function workersHoldingReady(ctx: AppCtx, featureId: string): WorkerRow[] {
  return listWorkers(ctx, featureId).filter((w) => HOLDS_READY.has(w.status))
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
