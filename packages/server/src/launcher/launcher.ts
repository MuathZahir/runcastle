import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AgentRuntime,
  Effort,
  Feature,
  MergeBranchPair,
  ModelEntry,
  Project,
  SessionKind,
  SessionPurpose,
  SessionRow,
} from '@runcastle/core'
import { DEFAULT_RUNTIME, newId, resolveModelEntry } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { runtimeAdapterFor } from './runtimes'
import { chatKickoffFor, projectTriageKickoffFor, selfPlanKickoffFor } from './runtimes/skills'
import { GateError } from '../errors'
import { emit, emitForSession, emitProject, emitScoped, type EmitScope } from '../services/events'
import { rosterConfig } from '../services/model-discovery'
import * as git from '../services/git'
import { getFeatureRow, projectForFeature, requireProjectById } from '../services/repo'
import { requireNotDraft } from '../services/features'
import { ensureTalkWorktreeDuringDrive } from '../services/chat-branch'
import { renderScenarioFollowUp } from './artifacts'
import { mainChatContext } from '../services/main-chat-excerpt'
import { featureStateLine } from '../services/feature-state'
import { tagRuncastlePrompt } from '../services/lead-prompt'
import { hasThreadLog } from '../threads/log'
import { agentHost, appendThreadEvent } from '../threads/types'
import {
  createSessionRow,
  getSessionRow,
  kickoffLineFor,
  newestThread,
  planKickoff,
  reentryCount,
  reportProjectLanding,
  resumeCapExceeded,
  resumeGoneReason,
  setThreadPurpose,
  transcriptBytes,
  type ResumeCapVerdict,
} from './sessions'

// Re-exported so the `feature.endSession` router imports the ending of a thread
// from the launcher, where it always has.
export { endSession, type EndSessionResult } from '../pty/end-session'

/**
 * Conversation launcher (chat-as-web-components; ADR-0015). Every agent
 * conversation is a thread: a session row that keeps its id for life, a log,
 * and an agent process the host starts on the thread's first prompt and stops
 * when it idles. A launcher finds or creates the thread's one row and says the
 * launch's briefing into it as a runcastle prompt; it spawns nothing itself.
 *
 * The briefing files (settings, MCP config, system prompt) are written when the
 * process starts (`threads/launch.ts`), so they carry the state of that moment.
 */

export interface LaunchSessionInput {
  featureId: string
  kind: SessionKind
  /**
   * A briefing of the caller's own, said ahead of the feature-state header
   * (e.g. a conflict to resolve, or a drive stopped to iterate on).
   */
  kickoffLine?: string
  /**
   * The errand this launch opens the chat on, when its `kind` cannot express
   * it. Both conflict-resolve launch sites pass `resolve-conflict` (with the
   * branch pair below), which is what lets the edit guard exempt the session's
   * writes while the merge is in progress.
   */
  purpose?: SessionPurpose
  /** The merge a `resolve-conflict` session is about (base → feature, or ticket branch → feature). */
  purposeData?: MergeBranchPair
  /** Start a new main-chat thread even when the feature has one. */
  fresh?: boolean
  /**
   * The model, effort and fast mode the human picked before the chat existed
   * (a-new-feature-waits-for-start decision 10): a new thread is created on the
   * model, and the opening turn runs on all three. Unset, Settings decide.
   */
  pick?: LaunchPick
}

/** What the composer's pickers chose for a chat not started yet. */
export interface LaunchPick {
  model?: string
  effort?: Effort
  fast?: boolean
}

/**
 * Fresh orientation for the feature's persistent chat: the one opening every
 * feature chat gets ({@link chatKickoffFor}), then the feature's state in the
 * status words the page shows ({@link featureStateLine}). `opening` replaces
 * that first sentence for a launch that brings its own (a self-planning run);
 * the feature state after it is the same either way.
 */
export function chatKickoffHeader(
  ctx: AppCtx,
  feature: Feature,
  runtime: AgentRuntime = DEFAULT_RUNTIME,
  opening: string = chatKickoffFor(runtime),
): string {
  return `${opening} Feature status: ${featureStateLine(ctx, feature)}. Call get_feature_context for the full picture.`
}

export interface LaunchSessionOptions {
  /**
   * Start the thread's agent (default true). Set false to fabricate a launch
   * MINUS the process: the row, the talk worktree and the briefing prompt in
   * the thread's log are all real; only the agent host is not asked to run it.
   * Used by the scripted smoke (SPEC §11) and by tests.
   */
  spawn?: boolean
  /**
   * Hold the launch's opening for the human's first message instead of sending
   * it (decision 12): it is logged, and goes to the agent ahead of that message
   * as one prompt. Passed by the web when a thread starts on its first send.
   */
  holdOpening?: boolean
}

export interface LaunchSessionResult {
  sessionId: string
  /** Whether the launch reopened a conversation already under way. */
  resumed?: boolean
}

/**
 * Refuse a launch whose runtime cannot run right now (decision 7) — before the
 * row and the worktree exist, so a refusal leaves nothing behind. The
 * `spawn:false` path is exempt: the process is the only thing readiness is about.
 */
function assertRuntimeReady(runtime: AgentRuntime, opts: LaunchSessionOptions): void {
  if (opts.spawn === false) return
  const ready = runtimeAdapterFor(runtime).checkReady()
  if (!ready.ok) throw new GateError(`${ready.reason}. ${ready.doctorHint}`)
}

/**
 * What a launch stamps on its `session.launching` event: the model and the
 * runtime it implies, as the row carries them.
 */
function modelStamp(row: SessionRow): { model: string | null; runtime: AgentRuntime } {
  return { model: row.model ?? null, runtime: row.runtime ?? DEFAULT_RUNTIME }
}

/**
 * Ensure the talk worktree.
 *
 * While a drive of the feature holds it on the main checkout, the conversation opens in the
 * worktree the drive detached, and what it commits lands when the drive stops.
 * Called by the launchers and again when a thread's process starts.
 */
export async function ensureFeatureWorktree(ctx: AppCtx, project: Project, feature: Feature): Promise<string> {
  return git.activeTestDriveFeatureId(project.id) === feature.id
    ? await ensureTalkWorktreeDuringDrive(ctx, project, feature)
    : await git.ensureTalkWorktree(project, feature, () =>
        emit(ctx, feature.id, {
          type: 'repo.head_healed',
          message: 'created runcastle: initial commit so branches can be cut',
        }),
      )
}

/**
 * The re-entry cap: past a transcript size or a re-entry count, picking a
 * conversation back up costs more than it carries, so the launch opens a new
 * thread instead. `null` (including for a thread with no conversation yet)
 * means carry on.
 */
function applyResumeCap(
  ctx: AppCtx,
  prior: SessionRow | null,
  scope: { featureId?: string; projectId?: string; kind?: SessionKind },
): ResumeCapVerdict | null {
  if (!prior?.ccSessionId) return null
  return resumeCapExceeded({ bytes: transcriptBytes(prior), reentries: reentryCount(ctx, scope) })
}

/** Whether a thread has a conversation under way: an agent-side id, or anything said in its log. */
function underway(row: SessionRow): boolean {
  return !!row.ccSessionId || hasThreadLog(row.id)
}

/**
 * Say a launch's briefing into its thread as runcastle's prompt: queued behind
 * a running turn, sent at once otherwise, starting the agent when none runs.
 * `session.kickoff` records that the host took it. With `spawn:false` the
 * prompt is logged and nothing is started, so nothing claims it was delivered.
 * With `holdOpening` the host keeps it for the human's first message.
 */
async function sayToThread(
  ctx: AppCtx,
  row: SessionRow,
  line: string,
  message: string,
  opts: LaunchSessionOptions,
  summary?: string,
  pick?: LaunchPick,
): Promise<void> {
  const display = summary ? { summary } : undefined
  if (opts.spawn === false) {
    appendThreadEvent(row.id, { type: 'prompt', id: newId('prompt'), text: line, source: 'runcastle', ...(display ? { display } : {}) })
    return
  }
  const hold = opts.holdOpening === true
  const text = hold ? heldOpening(line) : line
  const runsOn = {
    ...(pick?.model ? { model: pick.model } : {}),
    ...(pick?.effort ? { effort: pick.effort } : {}),
    ...(pick?.fast !== undefined ? { fast: pick.fast } : {}),
  }
  await agentHost(ctx).prompt(row.id, { text }, { source: 'runcastle', ...(display ? { display } : {}), ...(hold ? { hold } : {}), ...runsOn })
  emitForSession(ctx, row, {
    type: 'session.kickoff',
    message,
    data: { sessionId: row.id, kind: row.kind, line: text, mechanism: hold ? 'held' : 'prompt' },
  })
}

/** How an opening held for the human's first message ends: that message follows it, in the same prompt (decision 12). */
export const HELD_OPENING_END = "The human's message follows."

/** An opening in the form that rides ahead of the human's first message. */
export function heldOpening(line: string): string {
  return `${line}\n\n${HELD_OPENING_END}`
}

/**
 * The briefing a new conversation of the row's kind opens with — what its
 * launcher says first, and (`held`) what goes ahead of the human's first
 * message in a thread opened empty (New thread). Feature conversations are
 * tagged as runcastle's, as their launchers tag them.
 */
export function kickoffFor(ctx: AppCtx, row: SessionRow, opts: { held?: boolean } = {}): string {
  const line = openingLine(ctx, row)
  return opts.held ? heldOpening(line) : line
}

/** What the human reads of a thread's opening in place of its briefing; absent for a kind with no plain words (it keeps the raw look). */
export function openingSummary(row: SessionRow, selfPlan = false): string | undefined {
  switch (row.kind) {
    case 'chat':
      return selfPlan ? 'Started this chat to plan the feature by itself' : 'Started this chat'
    case 'project':
      return 'Started this epic'
    default:
      return undefined
  }
}

function openingLine(ctx: AppCtx, row: SessionRow): string {
  const runtime = row.runtime ?? DEFAULT_RUNTIME
  switch (row.kind) {
    case 'chat':
      return tagRuncastlePrompt(chatKickoffHeader(ctx, getFeatureRow(ctx, row.featureId as string), runtime))
    default:
      return kickoffLineFor(row.kind, undefined, runtime)
  }
}

/**
 * Whether the agent host will hand this thread's next prompt the fresh feature
 * state itself (`threads/lifecycle.ts`): it does for a main chat whose
 * conversation is resumed into a process it is about to start.
 */
function hostSaysHeader(ctx: AppCtx, row: SessionRow, opts: LaunchSessionOptions): boolean {
  return opts.spawn !== false && !!row.ccSessionId && !agentHost(ctx).isRunning(row.id)
}

/**
 * Open the feature's main chat (backs `feature.launchSession`): the feature's
 * one conversation, `one-chat-per-feature`. The feature keeps one main-chat
 * thread: the newest chat row is reopened — a terminal-era one included, whose
 * conversation the first prompt resumes — and a row is created only when there
 * is none, `fresh` asks for one, or the conversation on record is gone.
 *
 * A plain open of a conversation under way says nothing: the thread just opens.
 * A purpose or an explicit briefing speaks, ahead of the feature's current
 * state, as runcastle's first prompt; a new conversation gets the opening and
 * the state. A self-planning launch (`purpose: 'self-plan'`) marks the thread
 * unattended (the host declines its asks) and opens on its own sentence.
 *
 * A feature's launches run one at a time: two opens at once (two tabs on a new
 * feature) would race for its worktree, and the second must find the chat the
 * first made.
 */
export async function launchSession(
  ctx: AppCtx,
  input: LaunchSessionInput,
  opts: LaunchSessionOptions = {},
): Promise<LaunchSessionResult> {
  const before = launches.get(input.featureId)
  const launch = (before ?? Promise.resolve()).catch(() => undefined).then(() => openMainChat(ctx, input, opts))
  launches.set(input.featureId, launch)
  try {
    return await launch
  } finally {
    if (launches.get(input.featureId) === launch) launches.delete(input.featureId)
  }
}

/** The launch running for each feature, which the next one waits for. */
const launches = new Map<string, Promise<LaunchSessionResult>>()

async function openMainChat(
  ctx: AppCtx,
  input: LaunchSessionInput,
  opts: LaunchSessionOptions,
): Promise<LaunchSessionResult> {
  if (input.kind === 'drive-fix') {
    throw new GateError(
      'a drive-fix session is opened by "Fix drive" on the failed drive itself, not as a talk ' +
        'session — it needs the failure in hand and the developer\'s own checkout to repair.',
    )
  }
  if (input.kind === 'scenario') {
    throw new GateError(
      'a scenario session is opened by ＋ New scenario or Fix it inside a running test drive, ' +
        'not as a talk session — it writes and lands scenarios against that drive.',
    )
  }
  if (input.kind === 'side') {
    throw new GateError('side chats are retired: start a worker with "+" on the feature instead.')
  }
  if (input.kind !== 'chat') throw new GateError(`a ${input.kind} conversation is opened from its project`)
  // Messages reach the lead as prompts into its chat now (`deliverToLead`); no run carries them.
  if (input.purpose === 'relay' || input.purpose === 'lead-wake') {
    throw new GateError(`a ${input.purpose} run no longer exists — send the message to the feature's chat instead`)
  }

  const feature = getFeatureRow(ctx, input.featureId)
  requireNotDraft(feature)
  // The retired Start-lap door is a plain chat open: the lead runs rounds, not laps.
  if (input.purpose === 'start-lap') input = { ...input, purpose: undefined }
  const selfPlan = input.purpose === 'self-plan'
  if (selfPlan && feature.status === 'shipped') {
    throw new GateError(`${feature.slug} is shipped, so there is nothing for it to plan — open its chat to change it`)
  }

  const project = projectForFeature(ctx, feature)
  let prior = input.fresh ? null : newestThread(ctx, { featureId: feature.id }, 'chat')
  const model = resolveModelEntry('chat', rosterConfig(ctx), project, input.pick?.model)
  // Before anything is created: a runtime that cannot run refuses the launch.
  assertRuntimeReady(prior?.runtime ?? model.runtime, opts)
  const worktreePath = await ensureFeatureWorktree(ctx, project, feature)

  // A conversation whose transcript is gone cannot come back, so the chat starts from the docs.
  const gone = prior?.ccSessionId && !hasThreadLog(prior.id) ? resumeGoneReason(prior, worktreePath) : undefined
  if (prior && gone) {
    emit(ctx, feature.id, {
      type: 'session.resume_gone',
      message: `the previous chat conversation can't be resumed — ${gone}; starting fresh from the docs`,
      data: { sessionId: prior.id, resumeSessionId: prior.ccSessionId, reason: gone },
    })
    prior = null
    assertRuntimeReady(model.runtime, opts)
  }

  const row: SessionRow = prior ?? newChatRow(ctx, feature, worktreePath, model, input)
  if (prior && input.purpose) setThreadPurpose(ctx, row.id, input.purpose, input.purposeData ?? null)
  const thread = getSessionRow(ctx, row.id) as SessionRow
  const runtime = thread.runtime ?? DEFAULT_RUNTIME
  const resumed = underway(thread)

  const plan = planKickoff({ kind: 'chat', kickoffLine: input.kickoffLine })
  emit(ctx, feature.id, {
    type: 'session.launching',
    message: selfPlan ? 'launching a self-planning run' : resumed ? 'opening the chat thread' : 'launching chat session',
    // The errand the thread is on after this launch — a plain open mid-errand
    // keeps it — which the token count files what follows under (honest-token-counts).
    data: { sessionId: thread.id, kind: 'chat', worktreePath, ...modelStamp(thread), ...(thread.purpose ? { purpose: thread.purpose } : {}) },
  })
  if (resumed) {
    emit(ctx, feature.id, {
      type: 'session.resumed',
      message: 'reopening the chat conversation',
      data: { sessionId: thread.id, kind: 'chat', resumeSessionId: thread.ccSessionId ?? null },
    })
  }

  // A plain open of a conversation under way says nothing: the thread just opens.
  if (resumed && !input.purpose && !plan.explicit) return { sessionId: thread.id, resumed }

  // Purpose-specific text comes first so it remains the immediate task, then
  // the feature's current state — which the host adds itself to the first
  // prompt of a resumed conversation it starts.
  const opening = selfPlan ? selfPlanKickoffFor(runtime, resumed) : chatKickoffFor(runtime, resumed)
  const header = hostSaysHeader(ctx, thread, opts) ? undefined : chatKickoffHeader(ctx, feature, runtime, opening)
  const said = [plan.line, header].filter(Boolean).join(' ') || opening
  const line = tagRuncastlePrompt(kickoffLineFor('chat', said, runtime))
  await sayToThread(
    ctx,
    thread,
    line,
    selfPlan ? 'opening the self-planning run with its briefing' : 'opening chat with its briefing',
    opts,
    openingSummary(thread, selfPlan),
    input.pick,
  )
  return { sessionId: thread.id, resumed }
}

/** A new main-chat row, carrying the launch's errand. */
function newChatRow(
  ctx: AppCtx,
  feature: Feature,
  worktreePath: string,
  model: ModelEntry,
  input: LaunchSessionInput,
): SessionRow {
  return createSessionRow(ctx, {
    featureId: feature.id,
    kind: 'chat',
    ...(input.purpose ? { purpose: input.purpose } : {}),
    ...(input.purposeData ? { purposeData: input.purposeData } : {}),
    worktreePath,
    model,
  })
}

export interface ProjectLaunchInput {
  projectId: string
  fresh?: boolean
  resumeSessionId?: string
  purpose?: 'triage'
}

/**
 * A new orchestrator chat's row, in its runcastle-owned worktree on
 * `runcastle/project` (decision 18) — never the human's checkout. Ensuring the
 * worktree also retries a landing an earlier conversation left behind.
 */
export async function createProjectThread(ctx: AppCtx, project: Project): Promise<SessionRow> {
  const model = resolveModelEntry('project', rosterConfig(ctx), project)
  const { worktreePath } = await git.ensureProjectWorktree(
    project,
    (res) => reportProjectLanding(ctx, project, res, { retried: true }),
    () =>
      emitProject(ctx, project.id, {
        type: 'repo.head_healed',
        message: 'created runcastle: initial commit so branches can be cut',
      }),
  )
  const row = createSessionRow(ctx, { projectId: project.id, kind: 'project', worktreePath, model })
  emitProject(ctx, project.id, {
    type: 'session.project_opened',
    message: 'orchestrator chat opened',
    data: { sessionId: row.id },
  })
  return row
}

/**
 * Open a project conversation (backs `project.talkToProject`) — the project's
 * orchestrator (`one-orchestrator-no-mode` decision 1), which turns raw intent
 * into features (decisions 17–20). It writes the whole repo from its own
 * worktree, and its commits land on the base branch when its process stops.
 *
 * The orchestrator chat is a list of threads. `resumeSessionId` names one (a row id
 * from the list) to open as it is; anything else opens a new thread briefed
 * with its kickoff — `purpose: 'triage'` with the Notes card's briefing to work
 * the open notes. `fresh` is the explicit spelling of the default and wins over
 * a row id, so a "New chat" click never reopens something. A named thread is
 * reopened however long its transcript has grown: runcastle compacts orchestrator
 * chats at quiet moments, so the resume cap would measure the whole file, not
 * what the agent carries (agents-are-woken-only-when-it-matters decision 26).
 */
export async function launchProjectSession(
  ctx: AppCtx,
  input: ProjectLaunchInput,
  opts: LaunchSessionOptions = {},
): Promise<LaunchSessionResult> {
  const project = requireProjectById(ctx, input.projectId)

  const named = input.fresh || input.purpose || !input.resumeSessionId ? null : getSessionRow(ctx, input.resumeSessionId)
  const prior = named?.kind === 'project' && named.projectId === project.id ? named : null
  if (prior) {
    emitProject(ctx, project.id, {
      type: 'session.resumed',
      message: 'reopening a project conversation',
      data: { sessionId: prior.id, resumeSessionId: prior.ccSessionId ?? null, resumedFrom: prior.id },
    })
    return { sessionId: prior.id, resumed: underway(prior) }
  }

  assertRuntimeReady(resolveModelEntry('project', rosterConfig(ctx), project).runtime, opts)
  const row = await createProjectThread(ctx, project)
  emitProject(ctx, project.id, {
    type: 'session.launching',
    message: 'launching a new orchestrator chat',
    data: { sessionId: row.id, kind: 'project', worktreePath: row.worktreePath, branch: git.PROJECT_BRANCH, ...modelStamp(row), fresh: true },
  })
  if (input.resumeSessionId && !input.fresh && !input.purpose) {
    emitProject(ctx, project.id, {
      type: 'session.resume_unavailable',
      message: 'that conversation is not one of this project\'s — starting a new chat instead',
      data: { sessionId: row.id, resumedFrom: input.resumeSessionId },
    })
  }

  const runtime = row.runtime ?? DEFAULT_RUNTIME
  const line = input.purpose === 'triage' ? kickoffLineFor('project', projectTriageKickoffFor(runtime), runtime) : kickoffFor(ctx, row)
  await sayToThread(ctx, row, line, 'opening orchestrator with its briefing', opts, openingSummary(row))
  return { sessionId: row.id, resumed: false }
}

