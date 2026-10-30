import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AgentRuntime,
  Feature,
  MergeBranchPair,
  ModelEntry,
  Project,
  Run,
  SessionKind,
  SessionPurpose,
  SessionRow,
} from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import { DEFAULT_RUNTIME, newId, resolveModelEntry } from '@runcastle/core'
import { and, eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { runtimeAdapterFor } from './runtimes'
import { chatKickoffFor, prepareConfirmKickoffFor, projectTriageKickoffFor, selfPlanKickoffFor, sideKickoffFor } from './runtimes/skills'
import { runs } from '../db/schema'
import { GateError, isNotImplemented } from '../errors'
import { emit, emitForSession, emitProject, emitScoped, type EmitScope } from '../services/events'
import { rosterConfig } from '../services/model-discovery'
import * as git from '../services/git'
import { getFeatureRow, listRunsByFeature, projectForFeature, requireProjectById, rowToRun } from '../services/repo'
import { requireNotDraft } from '../services/features'
import { listByFeature as listTicketsByFeature } from '../services/tickets'
import { workflowClaimsFeatureBranch } from '../workflows/runner'
import { ensureTalkWorktreeDuringDrive, ensureTalkWorktreeDuringRun } from '../services/chat-branch'
import { listFindings } from '../services/findings'
import { keysToPrepare } from '../services/prep'
import { renderScenarioFollowUp, type PrepareBrief, type PrepareHost } from './artifacts'
import { mainChatContext } from '../services/main-chat-excerpt'
import { featureStateLine } from '../services/feature-state'
import { tagRuncastlePrompt } from '../services/lead-prompt'
import { hasThreadLog } from '../threads/log'
import { agentHost, appendThreadEvent } from '../threads/types'
import { LOCKFILES } from './lockfiles'
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
  const counts = new Map<string, number>()
  for (const ticket of listTicketsByFeature(ctx, feature.id)) {
    counts.set(ticket.status, (counts.get(ticket.status) ?? 0) + 1)
  }
  const ticketSummary = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${status} ${count}`)
    .join(', ') || 'none'
  const runs = listRunsByFeature(ctx, feature.id)
  const latestRun = runs[0]
  return `${opening} Feature status: ${featureStateLine(ctx, feature)}; rounds run: ${runs.length}; tickets: ${ticketSummary}; latest run: ${latestRun?.status ?? 'none'}. Call get_feature_context for the full picture.`
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
 * The feature's currently-running AFK run, if any. A BRANCH-CLAIMING run (e.g.
 * ticket-burner) decides where the talk worktree stands: it holds
 * `feature/<slug>`, so the chat works on a chat temp branch beside it
 * (`one-chat-per-feature` decision 2).
 */
function activeRunFor(ctx: AppCtx, featureId: string): Run | null {
  const row = ctx.db
    .select()
    .from(runs)
    .where(and(eq(runs.featureId, featureId), eq(runs.status, 'running')))
    .limit(1)
    .get()
  return row ? rowToRun(row) : null
}

/**
 * Ensure the talk worktree, tolerating B2's stub (mirrors features.createFeature).
 *
 * While a branch-claiming run holds `feature/<slug>` the worktree rides a chat
 * temp branch instead, so a conversation that starts mid-run has somewhere of
 * its own to commit and never lands docs on a detached HEAD. While a drive of
 * the feature holds it on the main checkout, the conversation opens in the
 * worktree the drive detached, and what it commits lands when the drive stops.
 * Called by the launchers and again when a thread's process starts.
 */
export async function ensureFeatureWorktree(ctx: AppCtx, project: Project, feature: Feature): Promise<string> {
  const running = activeRunFor(ctx, feature.id)
  const besideRun = !!running && workflowClaimsFeatureBranch(running.workflow)
  try {
    if (besideRun) return await ensureTalkWorktreeDuringRun(ctx, project, feature)
    return git.activeTestDriveFeatureId(project.id) === feature.id
      ? await ensureTalkWorktreeDuringDrive(ctx, project, feature)
      : await git.ensureTalkWorktree(project, feature, () =>
          emit(ctx, feature.id, {
            type: 'repo.head_healed',
            message: 'created runcastle: initial commit so branches can be cut',
          }),
        )
  } catch (e) {
    if (isNotImplemented(e)) {
      const fallback = worktreeDir(project.id, feature.slug)
      emit(ctx, feature.id, {
        type: 'session.worktree_pending',
        message: 'talk worktree not created (git service pending) — using computed path',
        data: { worktreePath: fallback },
      })
      return fallback
    }
    throw e
  }
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
): Promise<void> {
  if (opts.spawn === false) {
    appendThreadEvent(row.id, { type: 'prompt', id: newId('prompt'), text: line, source: 'runcastle' })
    return
  }
  const hold = opts.holdOpening === true
  const text = hold ? heldOpening(line) : line
  await agentHost(ctx).prompt(row.id, { text }, { source: 'runcastle', ...(hold ? { hold } : {}) })
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
  const line = openingLine(ctx, row, opts.held === true)
  return opts.held ? heldOpening(line) : line
}

function openingLine(ctx: AppCtx, row: SessionRow, held: boolean): string {
  const runtime = row.runtime ?? DEFAULT_RUNTIME
  switch (row.kind) {
    case 'chat':
      return tagRuncastlePrompt(chatKickoffHeader(ctx, getFeatureRow(ctx, row.featureId as string), runtime))
    case 'side':
      return tagRuncastlePrompt(sideKickoff(ctx, getFeatureRow(ctx, row.featureId as string), row.id, runtime, held))
    case 'prepare': {
      const project = requireProjectById(ctx, row.projectId as string)
      const nothingLeft = keysToPrepare(ctx, project).length === 0
      return kickoffLineFor('prepare', nothingLeft ? prepareConfirmKickoffFor(runtime) : undefined, runtime)
    }
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
    throw new GateError('a side session is opened by New side session, beside the main chat.')
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
  const model = resolveModelEntry('chat', rosterConfig(ctx), project)
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
    data: { sessionId: thread.id, kind: 'chat', worktreePath, ...modelStamp(thread), ...(input.purpose ? { purpose: input.purpose } : {}) },
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
  const opening = selfPlan ? selfPlanKickoffFor(runtime) : chatKickoffFor(runtime)
  const header = hostSaysHeader(ctx, thread, opts) ? undefined : chatKickoffHeader(ctx, feature, runtime, opening)
  const said = [plan.line, header].filter(Boolean).join(' ') || opening
  const line = tagRuncastlePrompt(kickoffLineFor('chat', said, runtime))
  await sayToThread(ctx, thread, line, selfPlan ? 'opening the self-planning run with its briefing' : 'opening chat with its briefing', opts)
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

export interface LaunchSideSessionInput {
  featureId: string
  /** A `side` row of this feature to reopen. Absent opens a new one. */
  reopenSessionId?: string
}

/**
 * A new side session's opening prompt: its role (`sideKickoffFor`) followed by
 * the same feature-state header the chat kickoff carries. The one place a side
 * session's first message is composed, so what it is told about the main chat
 * grows here. `held`: the form that rides ahead of the human's first message.
 */
export function sideKickoff(
  ctx: AppCtx,
  feature: Feature,
  sessionId: string,
  runtime: AgentRuntime = DEFAULT_RUNTIME,
  held = false,
): string {
  return mainChatContext(
    ctx,
    feature,
    sessionId,
    chatKickoffHeader(ctx, feature, runtime, kickoffLineFor('side', held ? sideKickoffFor(true) : undefined, runtime)),
  )
}

/**
 * A new side thread's row (several-sessions-per-feature): beside the feature's
 * main chat, on the chat's model step and talk worktree, recording the main
 * chat it was opened beside. Nothing is said until its first prompt.
 */
export async function createSideThread(ctx: AppCtx, feature: Feature): Promise<SessionRow> {
  requireNotDraft(feature)
  const project = projectForFeature(ctx, feature)
  const model = resolveModelEntry('chat', rosterConfig(ctx), project)
  const worktreePath = await ensureFeatureWorktree(ctx, project, feature)
  const mainChat = newestThread(ctx, { featureId: feature.id }, 'chat')
  const row = createSessionRow(ctx, {
    featureId: feature.id,
    kind: 'side',
    worktreePath,
    model,
    ...(mainChat ? { openedBeside: mainChat.id } : {}),
  })
  emit(ctx, feature.id, {
    type: 'session.side_opened',
    message: 'side session opened beside the main chat',
    data: { sessionId: row.id, openedBeside: mainChat?.id ?? null, reopened: false },
  })
  return row
}

/**
 * Open a side session (backs `feature.openSideSession`): an extra conversation
 * on the feature beside its main chat. A reopen is the side thread itself —
 * it opens as it is, and its next prompt picks its conversation back up. A new
 * one is briefed with {@link sideKickoff} as its first prompt.
 */
export async function launchSideSession(
  ctx: AppCtx,
  input: LaunchSideSessionInput,
  opts: LaunchSessionOptions = {},
): Promise<LaunchSessionResult> {
  const feature = getFeatureRow(ctx, input.featureId)
  requireNotDraft(feature)

  if (input.reopenSessionId) {
    const reopen = getSessionRow(ctx, input.reopenSessionId)
    if (reopen?.kind !== 'side' || reopen.featureId !== feature.id) {
      throw new GateError(`no side session ${input.reopenSessionId} on ${feature.slug} to reopen`)
    }
    return { sessionId: reopen.id, resumed: underway(reopen) }
  }

  assertRuntimeReady(resolveModelEntry('chat', rosterConfig(ctx), projectForFeature(ctx, feature)).runtime, opts)
  const row = await createSideThread(ctx, feature)
  emit(ctx, feature.id, {
    type: 'session.launching',
    message: 'launching a new side session',
    data: { sessionId: row.id, kind: 'side', worktreePath: row.worktreePath, ...modelStamp(row) },
  })
  await sayToThread(ctx, row, kickoffFor(ctx, row), 'opening side session with its briefing', opts)
  return { sessionId: row.id, resumed: false }
}

/**
 * Open a project-scoped preparation conversation (backs `project.talkToPrep`).
 *
 * It runs in the project's REAL checkout, which is the whole point — the
 * host-only keys a container can only propose (`devCommand`,
 * `driveSetupCommand`, `driveStopCommand`, `dbResetCommand`) can be executed
 * and verified here, and the human is present to answer for the ones no amount
 * of reading the repo can settle. That is also the one hazard no other kind
 * has: this conversation can dirty the working tree. The brief tells the agent
 * to ask before anything stateful.
 *
 * Reopens the project's preparation thread when there is one, so the human
 * never re-explains their database — unless `fresh` is set, which is how
 * "re-prepare from scratch" is asked for: a baseline that has gone stale wants
 * re-measuring, not a conversation that believes it already measured. Past the
 * re-entry cap a new thread is opened too.
 */
export async function launchPrepareSession(
  ctx: AppCtx,
  input: { projectId: string; fresh?: boolean },
  opts: LaunchSessionOptions = {},
): Promise<LaunchSessionResult> {
  const project = requireProjectById(ctx, input.projectId)

  const prior = input.fresh ? null : newestThread(ctx, { projectId: project.id }, 'prepare')
  // Preparation is the kind most likely to be re-entered and the one measured
  // reaching 1.42 MB across four rows, so the cap matters most here.
  const capped = applyResumeCap(ctx, prior, { projectId: project.id, kind: 'prepare' })
  const reopen = prior && !capped ? prior : null

  const model = resolveModelEntry('prepare', rosterConfig(ctx), project)
  assertRuntimeReady(reopen ? (reopen.runtime ?? DEFAULT_RUNTIME) : model.runtime, opts)
  const row =
    reopen ??
    createSessionRow(ctx, {
      projectId: project.id,
      kind: 'prepare',
      // No worktree: preparation is about THIS machine's checkout, and a docs-only
      // talk worktree could neither run the dev server nor see the real .env.
      worktreePath: project.repoPath,
      model,
    })

  emitProject(ctx, project.id, {
    // A deliberate fresh start reads exactly like a first-ever preparation on
    // the timeline unless it says so — and it is the one the human chose over
    // the cheaper resume, which is worth being able to see later.
    type: 'session.launching',
    message: input.fresh ? 'launching preparation session from scratch' : 'launching preparation session',
    data: {
      sessionId: row.id,
      kind: 'prepare',
      worktreePath: project.repoPath,
      ...modelStamp(row),
      ...(input.fresh ? { fresh: true } : {}),
    },
  })
  if (capped) {
    emitProject(ctx, project.id, {
      type: 'session.resume_capped',
      message: `starting the preparation session fresh — ${capped.detail}; the recorded findings carry the state`,
      data: { sessionId: row.id, kind: 'prepare', ...capped },
    })
  }
  if (reopen && underway(reopen)) {
    emitProject(ctx, project.id, {
      type: 'session.resumed',
      message: 'resuming the previous preparation conversation',
      data: { sessionId: row.id, resumeSessionId: reopen.ccSessionId ?? null },
    })
    return { sessionId: row.id, resumed: true }
  }

  await sayToThread(ctx, row, kickoffFor(ctx, row), 'opening preparation session with its briefing', opts)
  return { sessionId: row.id, resumed: false }
}

/**
 * Open the one-click recovery from a failed drive (backs `feature.fixDrive`) —
 * decision 9 of preparation-supports-multi-service-projects.
 *
 * Host-side like preparation: the developer's REAL checkout, where the failed
 * drive stands with the feature branch checked out. The drive is deliberately
 * NOT stopped here; `retry_drive` ends it, once the agent has something to
 * retry with. Refused unless a drive of THIS feature is currently failing: its
 * whole brief is the failure.
 *
 * The feature keeps one Fix-it thread: the newest is reopened, so an agent on
 * its third attempt remembers the two fixes it already tried (past the
 * re-entry cap, a new one opens). Every click is an errand, so it always says
 * its kickoff; the failure itself is in the brief written when the process
 * starts.
 */
export async function launchDriveFixSession(
  ctx: AppCtx,
  input: { featureId: string },
  opts: LaunchSessionOptions = {},
): Promise<LaunchSessionResult> {
  const feature = getFeatureRow(ctx, input.featureId)
  requireNotDraft(feature)
  const project = projectForFeature(ctx, feature)

  const drive = git.activeDriveInfo(project.id)
  if (drive?.featureId !== feature.id || !drive.hookFailure) {
    throw new GateError(
      `no failed drive to fix on ${feature.slug} — a drive-fix session is opened from a drive ` +
        'whose setup failed, and carries that failure as its whole brief. Start a drive first.',
    )
  }

  const prior = newestThread(ctx, { featureId: feature.id }, 'drive-fix')
  const capped = applyResumeCap(ctx, prior, { featureId: feature.id, kind: 'drive-fix' })
  const reopen = prior && !capped ? prior : null
  // Prepare's step, deliberately: the same host-side environment work under a narrower mandate.
  const model = resolveModelEntry('prepare', rosterConfig(ctx), project)
  assertRuntimeReady(reopen ? (reopen.runtime ?? DEFAULT_RUNTIME) : model.runtime, opts)
  const row =
    reopen ??
    createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'drive-fix',
      // No worktree, for preparation's reason: the environment that broke is this machine's.
      worktreePath: project.repoPath,
      model,
    })

  emit(ctx, feature.id, {
    type: 'session.launching',
    message: `launching drive-fix session — ${drive.hookFailure.phase} failed on ${drive.branch}`,
    data: {
      sessionId: row.id,
      kind: 'drive-fix',
      worktreePath: project.repoPath,
      branch: drive.branch,
      command: drive.hookFailure.command,
      ...modelStamp(row),
    },
  })
  if (reopen && underway(reopen)) {
    emit(ctx, feature.id, {
      type: 'session.resumed',
      message: 'resuming the previous drive-fix conversation — it already knows what it tried',
      data: { sessionId: row.id, kind: 'drive-fix', resumeSessionId: reopen.ccSessionId ?? null },
    })
  } else if (capped) {
    emit(ctx, feature.id, {
      type: 'session.resume_capped',
      message: `starting the drive-fix session fresh — ${capped.detail}; the failure is in the brief`,
      data: { sessionId: row.id, kind: 'drive-fix', ...capped },
    })
  }

  await sayToThread(ctx, row, kickoffFor(ctx, row), 'opening drive-fix session with its briefing', opts)
  return { sessionId: row.id, resumed: !!reopen && underway(reopen) }
}

/**
 * Open the `scenario` session docked beside the project's live drive (backs
 * `feature.openScenarioChat`, drive-scenarios decision 8): ＋ New scenario with
 * the human's `description`, or **Fix it** with the failed `fixFile`.
 *
 * Host-side, in the developer's own checkout where the drive has the driven
 * branch checked out, so the scenario commits onto that branch (decision 4).
 * Its scope follows the drive — a feature drive's thread carries the
 * `featureId`, a project drive's only the `projectId`.
 *
 * Refused unless a human feature drive or a project drive is live and its app
 * answers. One per drive: while the drive has its docked thread, this says the
 * new ask (the failed file or the description) into it. Setup mode (decision
 * 5) is decided once, when the thread is created, from whether
 * `.runcastle/scenarios/` exists, and recorded as its purpose.
 */
export async function launchScenarioSession(
  ctx: AppCtx,
  input: { projectId: string; description?: string; fixFile?: string },
  opts: LaunchSessionOptions = {},
): Promise<{ sessionId: string }> {
  const project = requireProjectById(ctx, input.projectId)
  const drive = git.activeDriveInfo(project.id)
  const driveEnv = git.scenarioDriveEnv(ctx, project.id)
  const humanDrive = drive && (drive.projectDrive || (drive.featureId && drive.purpose === 'human'))
  if (!drive || !humanDrive || !drive.devReady || !driveEnv) {
    throw new GateError(
      'a scenario session lands scenarios on a running test drive, so it needs a human test drive ' +
        'or project drive whose app is answering — start one and wait for Open app.',
    )
  }

  const feature = drive.featureId ? getFeatureRow(ctx, drive.featureId) : undefined
  const scope: EmitScope = feature ? { featureId: feature.id } : { projectId: project.id }
  const fixFailure = input.fixFile && drive.scenario?.file === input.fixFile ? drive.scenario.failure : undefined
  const ask = renderScenarioFollowUp({
    description: input.description,
    fix: input.fixFile ? { file: input.fixFile, failure: fixFailure } : undefined,
  })

  const docked = drive.scenarioSessionId ? getSessionRow(ctx, drive.scenarioSessionId) : null
  if (docked) {
    if (ask) {
      await sayToThread(
        ctx,
        docked,
        ask,
        input.fixFile ? `handing the scenario chat ${input.fixFile} to fix` : 'handing the scenario chat a new scenario',
        opts,
      )
    }
    return { sessionId: docked.id }
  }

  const setup = !existsSync(join(project.repoPath, '.runcastle', 'scenarios'))
  // Prepare's step, as drive-fix uses it: host-side work in the developer's checkout.
  const model = resolveModelEntry('prepare', rosterConfig(ctx), project)
  assertRuntimeReady(model.runtime, opts)
  const row = createSessionRow(ctx, {
    ...(feature ? { featureId: feature.id } : { projectId: project.id }),
    kind: 'scenario',
    ...(setup ? { purpose: 'scenario-setup' as const } : {}),
    worktreePath: project.repoPath,
    model,
  })

  emitScoped(ctx, scope, {
    type: 'session.launching',
    message: `launching scenario session${setup ? ' in setup mode' : ''} on ${drive.branch}`,
    data: { sessionId: row.id, kind: 'scenario', worktreePath: project.repoPath, branch: drive.branch, setup, ...modelStamp(row) },
  })
  git.attachScenarioSession(project.id, row.id)
  emitScoped(ctx, scope, {
    type: 'scenario.chat_opened',
    message: input.fixFile
      ? `scenario chat opened to fix ${input.fixFile}`
      : `scenario chat opened${setup ? ' — setting scenarios up' : ''}`,
    data: { sessionId: row.id, setup, fixFile: input.fixFile ?? null },
  })

  // On a feature drive it opens knowing the feature and the main chat's latest
  // turns; the human's ask follows its opening.
  const scenarioLine = kickoffLineFor('scenario', undefined, model.runtime)
  const opening = feature
    ? mainChatContext(ctx, feature, row.id, chatKickoffHeader(ctx, feature, model.runtime, scenarioLine))
    : scenarioLine
  const line = ask ? `${opening}\n\n${ask}` : opening
  await sayToThread(ctx, row, line, 'opening scenario session with its briefing', opts)
  return { sessionId: row.id }
}

export interface ProjectLaunchInput {
  projectId: string
  fresh?: boolean
  resumeSessionId?: string
  purpose?: 'triage'
}

/**
 * A new project chat's row, in its runcastle-owned worktree on
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
    message: 'project chat opened',
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
 * The project chat is a list of threads. `resumeSessionId` names one (a row id
 * from the list) to open as it is; anything else opens a new thread briefed
 * with its kickoff — `purpose: 'triage'` with the Notes card's briefing to work
 * the open notes. `fresh` is the explicit spelling of the default and wins over
 * a row id, so a "New chat" click never reopens something. Past the re-entry
 * cap, a named thread is not reopened either.
 */
export async function launchProjectSession(
  ctx: AppCtx,
  input: ProjectLaunchInput,
  opts: LaunchSessionOptions = {},
): Promise<LaunchSessionResult> {
  const project = requireProjectById(ctx, input.projectId)

  const named = input.fresh || input.purpose || !input.resumeSessionId ? null : getSessionRow(ctx, input.resumeSessionId)
  const prior = named?.kind === 'project' && named.projectId === project.id ? named : null
  const capped = applyResumeCap(ctx, prior, { projectId: project.id, kind: 'project' })
  if (prior && !capped) {
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
    message: 'launching a new project chat',
    data: { sessionId: row.id, kind: 'project', worktreePath: row.worktreePath, branch: git.PROJECT_BRANCH, ...modelStamp(row), fresh: true },
  })
  if (capped) {
    emitProject(ctx, project.id, {
      type: 'session.resume_capped',
      message: `starting a new project chat — ${capped.detail}; the repo and the charter carry the state`,
      data: { sessionId: row.id, kind: 'project', ...capped },
    })
  } else if (input.resumeSessionId && !input.fresh && !input.purpose) {
    emitProject(ctx, project.id, {
      type: 'session.resume_unavailable',
      message: 'that conversation is not one of this project\'s — starting a new chat instead',
      data: { sessionId: row.id, resumedFrom: input.resumeSessionId },
    })
  }

  const runtime = row.runtime ?? DEFAULT_RUNTIME
  const line = input.purpose === 'triage' ? kickoffLineFor('project', projectTriageKickoffFor(runtime), runtime) : kickoffFor(ctx, row)
  await sayToThread(ctx, row, line, 'opening project session with its briefing', opts)
  return { sessionId: row.id, resumed: false }
}

/**
 * Seed the conversation with what is established already, what is not, and what
 * the server can see about the host without being asked.
 *
 * `verifiedAt` and `staleCommits` are passed through rather than dropped:
 * `listFindings` has always computed both, and without them the brief could not
 * distinguish a value measured today from one measured a year and 400 commits
 * ago — which is exactly the judgement the session has to make about every
 * established key before it decides whether to re-derive it.
 */
export async function buildPrepareBrief(ctx: AppCtx, project: Project): Promise<PrepareBrief> {
  const findings = await listFindings(ctx, project)
  return {
    project,
    remainingKeys: keysToPrepare(ctx, project),
    established: findings.map((f) => ({
      key: f.key,
      source: f.source,
      ...(f.evidence ? { evidence: f.evidence } : {}),
      ...(f.verifiedAt !== undefined ? { verifiedAt: f.verifiedAt } : {}),
      ...(f.staleCommits !== undefined ? { staleCommits: f.staleCommits } : {}),
    })),
    host: probePrepareHost(project.repoPath),
  }
}

const COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
] as const

/**
 * What the host is, answered by the process that IS the host. The prepare prompt
 * used to send the agent off to discover every one of these — the platform, the
 * package manager, whether there is a compose file, whether `.runcastle/`
 * already exists — which is several tool calls and a paragraph of prose to learn
 * four things a `statSync` away from the code writing the prompt.
 */
export function probePrepareHost(repoPath: string): PrepareHost {
  const has = (rel: string): boolean => existsSync(join(repoPath, rel))
  const lock = LOCKFILES.find(([file]) => has(file))
  return {
    platform: process.platform,
    hasCompose: COMPOSE_FILES.some(has),
    hasDriveMachinery: has('.runcastle'),
    ...(lock ? { packageManager: lock[1] } : {}),
  }
}
