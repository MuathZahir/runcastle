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
  Waypoint,
} from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import { DEFAULT_RUNTIME, resolveModelEntry } from '@runcastle/core'
import { and, eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { spawnTargetFor } from '../util/resolve-executable'
import { runtimeAdapterFor, type AgentRuntimeAdapter, type RuntimeLaunchSpec } from './runtimes'
import { chatKickoffFor, prepareConfirmKickoffFor } from './runtimes/skills'
import { runs } from '../db/schema'
import { GateError, isNotImplemented } from '../errors'
import { endSession } from '../pty/end-session'
import { ptyRegistry } from '../pty/registry'
import { carriedWork } from '../services/carried-work'
import { startDocsWatch } from '../services/docs-watch'
import { emit, emitForSession, emitProject } from '../services/events'
import * as git from '../services/git'
import {
  getFeatureRow,
  listRunsByFeature,
  listSessionsByFeature,
  projectForFeature,
  requireProjectById,
  rowToRun,
} from '../services/repo'
import { requireNotDraft } from '../services/features'
import { listByFeature as listTicketsByFeature } from '../services/tickets'
import {
  claim as claimWaypoint,
  getWaypoint,
  listByFeature as listWaypointsByFeature,
  releaseForSession,
} from '../services/waypoints'
import { startRun, workflowClaimsFeatureBranch } from '../workflows/runner'
import { ensureTalkWorktreeDuringRun } from '../services/chat-branch'
import { listFindings } from '../services/findings'
import { keysToPrepare } from '../services/prep'
import { planningFacts } from '../services/planning'
import { noteResolvedMerge } from '../services/resolved-merge'
import { chatOpening, serverUrlFor, type PrepareBrief, type PrepareHost } from './artifacts'
import {
  activeProjectSession,
  activeSessionsForFeature,
  armSessionReadyWatchdog,
  createSessionRow,
  getSessionRow,
  hasCompletedProjectSession,
  kickoffLineFor,
  landProjectSession,
  lapInFlight,
  markSessionEnded,
  mostRecentResumableProjectSession,
  mostRecentResumableSession,
  planKickoff,
  reentryCount,
  reportProjectLanding,
  resumeCapExceeded,
  transcriptBytes,
  type ResumeCapVerdict,
} from './sessions'

const CODEX_RESUME_UNAVAILABLE_MESSAGE =
  'no resumable conversation was recorded — starting a fresh session'

// Re-exported so the `feature.endSession` router (W2) imports the real,
// PTY-killing service from `../../launcher/launcher` per its coordination note —
// the implementation lives in the PTY layer (`pty/end-session`).
export { endSession, type EndSessionResult } from '../pty/end-session'

/**
 * Session launcher (SPEC §5 / UI-SPEC §5). Spawns a real, injected agent session
 * inside a server-owned embedded PTY: resolves the model (and with it the
 * runtime — decision 2), creates the session row, ensures the talk worktree,
 * then hands the whole launch to that runtime's adapter, which writes the
 * artifacts and hands back the argv + env to spawn. The PTY is registered by
 * session id and streamed to the in-app xterm view over
 * `/ws/terminal/:sessionId` (cross-platform; no `wt.exe`).
 *
 * Everything runtime-specific — the CLI name, the flags, the artifact files, the
 * env scrub list, the kickoff spelling — lives behind {@link
 * AgentRuntimeAdapter}; this module knows only the shape of a launch.
 */

/**
 * Human-readable `session.pty_exited` message. The backend hands us a numeric
 * exit code (`{ exitCode }` from the native/sidecar PTY, sourced from node-pty's
 * `onExit` / the sidecar's `{ t:'exit', code }` frame). If a code is genuinely
 * absent (e.g. a host that died without reporting one), render `unknown` rather
 * than the literal string `undefined`.
 */
export function ptyExitMessage(exitCode: number | undefined | null): string {
  const label = typeof exitCode === 'number' ? String(exitCode) : 'unknown'
  return `terminal exited (code ${label})`
}

export interface LaunchSessionInput {
  featureId: string
  kind: SessionKind
  /**
   * When set, claim this waypoint for the freshly-created session BEFORE spawning
   * (kind=waypoint sessions). The claim re-checks the frontier transactionally
   * and throws if the waypoint is no longer claimable; the session row is then
   * marked ended and the error propagates, so no orphaned session lingers.
   */
  waypointId?: string
  /**
   * Optional kickoff line, replacing the per-kind default typed into the PTY once
   * the session goes live (`KICKOFF_LINES`). Callers pass a per-purpose briefing
   * here — e.g. a revisit told to resolve a merge conflict or iterate on review.
   */
  kickoffLine?: string
  /**
   * The errand this session is opened on, when its `kind` cannot express it.
   * Both conflict-resolve launch sites pass `resolve-conflict` (with the branch
   * pair below), which is what lets the edit guard exempt the session's writes
   * while the merge is in progress — the kickoff briefs it to resolve and commit.
   */
  purpose?: SessionPurpose
  /** The merge a `resolve-conflict` session is about (base → feature, or ticket branch → feature). */
  purposeData?: MergeBranchPair
}

/**
 * Fresh orientation for the feature's persistent chat, opening with the move its
 * state calls for.
 *
 * The opening comes from {@link chatOpening} — the same predicate the injected
 * system prompt splits on — so a brand-new Planning feature is told to ideate by
 * both, and a feature with a record on disk is told to revisit by both.
 */
export function chatKickoffHeader(
  ctx: AppCtx,
  feature: Feature,
  runtime: AgentRuntime = DEFAULT_RUNTIME,
): string {
  const counts = new Map<string, number>()
  for (const ticket of listTicketsByFeature(ctx, feature.id)) {
    counts.set(ticket.status, (counts.get(ticket.status) ?? 0) + 1)
  }
  const ticketSummary = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${status} ${count}`)
    .join(', ') || 'none'
  const latestRun = listRunsByFeature(ctx, feature.id)[0]
  const review = feature.phase === 'review'
    ? ' Drive outcome: review; see the review evidence in get_feature_context.'
    : ''
  const opening = chatKickoffFor(runtime, chatOpening(feature, planningFacts(ctx, feature)))
  return `${opening} Feature state: ${feature.phase}; lap ${feature.lap}; tickets: ${ticketSummary}; latest run: ${latestRun?.status ?? 'none'}.${review} Call get_feature_context for the full picture.`
}

export interface LaunchSessionOptions {
  /**
   * Spawn the embedded PTY (default true). Set false to fabricate a session
   * end-to-end MINUS the process — the row, talk worktree and launch artifacts
   * are all created for real; only the PTY spawn is skipped. Used by the scripted
   * smoke (SPEC §11) so it can drive hooks/MCP against a real live session
   * without a live terminal.
   */
  spawn?: boolean
}

export interface LaunchSessionResult {
  sessionId: string
}

/** Working a research waypoint starts a headless run instead of a session. */
export interface WorkRunResult {
  runId: string
}

/**
 * Refuse a launch whose runtime cannot run right now (decision 7) — the AFK
 * auth-precheck extended to talk sessions. Called BEFORE the session row, the
 * worktree and the artifacts exist, so a refusal leaves nothing behind and the
 * human reads a sentence naming the doctor fix instead of watching a terminal
 * open and close on an ENOENT.
 *
 * The `spawn:false` smoke path is exempt: it fabricates a session MINUS the
 * process (SPEC §11), and the process is the only thing readiness is about.
 */
function assertRuntimeReady(runtime: AgentRuntimeAdapter, opts: LaunchSessionOptions): void {
  if (opts.spawn === false) return
  const ready = runtime.checkReady()
  if (!ready.ok) throw new GateError(`${ready.reason}. ${ready.doctorHint}`)
}

/**
 * What a launch stamps on its `session.launching` event: the model that won the
 * chain and the runtime it implies. The row carries the same pair (see the
 * `sessions` db schema) — this is the mutation announcing itself, so the UI and
 * the timeline can say which agent a terminal is talking to.
 */
function modelStamp(model: ModelEntry): { model: string; runtime: AgentRuntime } {
  return { model: model.id, runtime: model.runtime }
}

/**
 * The launch as one command line, for the `spawn:false` smoke event. The program
 * word is the runtime's own CLI name, so a second runtime renders as itself
 * rather than as `claude` with foreign flags after it.
 *
 * The env the runtime asked for is rendered as a `KEY=value` prefix, because for
 * a runtime configured through a synthetic home rather than through flags
 * (`CODEX_HOME=…`) the environment IS most of the launch — a bare argv would
 * describe a session pointed at the human's real config.
 */
function renderCommand(runtime: AgentRuntimeAdapter, spec: RuntimeLaunchSpec): string {
  const env = Object.entries(spec.env).map(([key, value]) => `${key}=${value}`)
  return [...env, runtime.binary, ...spec.argv].join(' ')
}

/**
 * The feature's currently-running AFK run, if any. A run no longer refuses a
 * terminal — that clause was the post-mortem's worst hour, a dead burn with
 * nothing to talk to — but a BRANCH-CLAIMING run (e.g. ticket-burner) does
 * decide where the talk worktree stands: it holds `feature/<slug>`, so the
 * session works on a chat temp branch beside it (`one-chat-per-feature`
 * decision 2). Research runs work on temp branches (ADR-0001 §7 "parallel AFK")
 * and change nothing.
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
 * Throw when an HITL session must not spawn on this feature right now: another
 * session row is `launching`/`live` (one live HITL session per feature — one
 * talk worktree, git forbids two checkouts of one branch). Guarding on session
 * ROWS, not waypoint claims, means resolving a waypoint while its terminal is
 * still open can no longer sneak a second live session in.
 * `excludeSessionId` skips the caller's own just-created row.
 *
 * A live AFK run used to refuse here too. It no longer does: a branch-claiming
 * run parks the talk worktree on a chat temp branch instead of detaching it, so
 * a session spawned mid-run has a branch of its own to commit to and its docs
 * land through the feature's queue (`one-chat-per-feature` decision 2).
 */
function assertSpawnable(ctx: AppCtx, feature: Feature, excludeSessionId?: string): void {
  const live = activeSessionsForFeature(ctx, feature.id).filter((s) => s.id !== excludeSessionId)
  if (live.length > 0) {
    throw new GateError(
      `a ${live[0].kind} session is already live for ${feature.slug} — only one terminal per feature; end or resume it first`,
    )
  }
}

/**
 * Whether a live session's work is demonstrably DONE (decision #8):
 * - a kind=`waypoint` session whose own waypoint — the one remembering it as
 *   `lastSessionId` — has gone terminal (`resolved`/`dropped`). While it is still
 *   working, that waypoint is `claimed`, so this is false.
 * - a kind=`ideation`/`converge` session once the feature is `mapped`: charting
 *   the map is the job those two were opened to do, and the map is on disk.
 * - nothing else. A `qa` question or a `revisit` ("I remembered something") is a
 *   conversation with the human, and no state on this side can prove one is
 *   over — saying so is what the `endLive` confirmation is for.
 * A session that never went live has no waypoint remembering it, so it is never
 * finished — abandoning it needs the explicit `endLive` confirmation.
 *
 * This answered `feature.mapped` for every non-waypoint kind, and its only call
 * site is reached only once the feature IS mapped — so it was constant `true`,
 * and working a waypoint silently killed whatever conversation was live and told
 * the timeline it had "finished".
 */
function sessionFinished(ctx: AppCtx, feature: Feature, session: SessionRow): boolean {
  if (session.kind === 'chat' || session.kind === 'converge') return feature.mapped
  if (session.kind !== 'waypoint') return false
  const own = listWaypointsByFeature(ctx, feature.id).find((w) => w.lastSessionId === session.id)
  return !!own && (own.status === 'resolved' || own.status === 'dropped')
}

/**
 * End the live sessions standing between the human and the waypoint they just
 * clicked Work on (decision #8). Ordinarily only FINISHED sessions are ended, so
 * the ordinary click is one click instead of "End session" then "Work". With
 * `endLive` — the human having confirmed the inline affordance — every active
 * session goes, abandoning its mid-work claim (`endSession` releases it back to
 * the frontier, so nothing is lost).
 *
 * `assertSpawnable` still runs after this and is deliberately untouched: a
 * mid-work session with no `endLive` survives the sweep and is refused there.
 */
function sweepActiveSessions(ctx: AppCtx, feature: Feature, endLive: boolean): void {
  for (const session of activeSessionsForFeature(ctx, feature.id)) {
    const finished = sessionFinished(ctx, feature, session)
    if (!finished && !endLive) continue
    endSession(ctx, session.id)
    emit(ctx, feature.id, {
      type: 'session.auto_ended',
      message: finished
        ? `ended the finished ${session.kind} session to work the next waypoint`
        : `abandoned the in-flight ${session.kind} session to work the next waypoint`,
      data: {
        sessionId: session.id,
        kind: session.kind,
        reason: finished ? 'finished' : 'abandoned',
      },
    })
  }
}

/**
 * Ensure the talk worktree, tolerating B2's stub (mirrors features.createFeature).
 *
 * While a branch-claiming run holds `feature/<slug>` the worktree rides a chat
 * temp branch instead, so a session that spawns mid-run has somewhere of its own
 * to commit and never lands docs on a detached HEAD.
 */
async function ensureWorktree(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
): Promise<string> {
  const running = activeRunFor(ctx, feature.id)
  const besideRun = !!running && workflowClaimsFeatureBranch(running.workflow)
  try {
    return besideRun
      ? await ensureTalkWorktreeDuringRun(ctx, project, feature)
      : await git.ensureTalkWorktree(project, feature)
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
 * The re-entry cap, applied at one place per launcher: measure the transcript
 * that is about to be restored and how many times this conversation has already
 * been picked back up, and return a verdict when resuming should be skipped in
 * favour of a fresh window. `null` (including for a launch that was never going
 * to resume) means carry on.
 */
function applyResumeCap(
  ctx: AppCtx,
  resumeSessionId: string | undefined,
  resumedFrom: SessionRow | undefined,
  scope: { featureId?: string; projectId?: string; kind?: SessionKind },
): ResumeCapVerdict | null {
  if (!resumeSessionId) return null
  return resumeCapExceeded({
    bytes: transcriptBytes(resumedFrom ?? null),
    reentries: reentryCount(ctx, scope),
  })
}

export async function launchSession(
  ctx: AppCtx,
  input: LaunchSessionInput,
  opts: LaunchSessionOptions = {},
): Promise<LaunchSessionResult> {
  // The one feature-scoped kind this door does not open: a drive-fix session
  // runs in the REAL checkout holding a failed drive, and everything below
  // (talk worktree, resume-by-kind, the feature brief) is wrong for it. It has
  // its own launcher — see {@link launchDriveFixSession}.
  if (input.kind === 'drive-fix') {
    throw new GateError(
      'a drive-fix session is opened by "Fix drive" on the failed drive itself, not as a talk ' +
        'session — it needs the failure in hand and the developer\'s own checkout to repair.',
    )
  }

  const feature = getFeatureRow(ctx, input.featureId)
  requireNotDraft(feature)
  const project = projectForFeature(ctx, feature)

  // The session kind IS a model step (issue #48): resolve per-step model,
  // falling back through the per-project override to the global default. The
  // winner decides the runtime too (decision 2), so the adapter — and whether it
  // can run at all — is settled before anything is created.
  const model = resolveModelEntry(input.kind, ctx.config, project)
  const runtime = runtimeAdapterFor(model.runtime)
  assertRuntimeReady(runtime, opts)

  const worktreePath = await ensureWorktree(ctx, project, feature)
  const session = createSessionRow(ctx, {
    featureId: feature.id,
    kind: input.kind,
    purpose: input.purpose,
    purposeData: input.purposeData,
    worktreePath,
    model,
  })

  // What this terminal opens with, decided before anything else. An explicit
  // briefing makes non-chat sessions fresh; chat briefings ride the persistent
  // conversation's resume. A lap in flight additionally tells the artifacts
  // which lap they are rendering for.
  //
  // The lap is read off FEATURE STATE — phase, lap number, and whether tickets
  // exist at that lap — not off what the caller typed. `listTicketsByFeature` is
  // already this module's import, so "does lap N have tickets" costs nothing
  // extra and, unlike a kickoff string, it is still true tomorrow. See
  // `lapInFlight` for the stranding bug this closes.
  //
  // What the last lap handed this one rides along with it: the same counts brief
  // the kickoff line and the injected prompt, so a lap opens knowing its agenda
  // whichever door it came through.
  const carried = carriedWork(ctx, feature.id)
  const plan = planKickoff({
    kind: input.kind,
    lap: feature.lap,
    kickoffLine: input.kickoffLine,
    lapInFlight: lapInFlight({
      lap: feature.lap,
      phase: feature.phase,
      ticketLaps: listTicketsByFeature(ctx, feature.id).map((t) => t.lap),
    }),
    carried,
  })
  if (input.kind === 'chat') {
    // Every opening re-orients the persistent conversation. Purpose-specific
    // text comes first so it remains the immediate task, followed by current
    // feature state rather than the state captured on the previous turn.
    const header = chatKickoffHeader(ctx, feature, runtime.id)
    plan.line = plan.line ? `${plan.line} ${header}` : header
  }

  // A waypoint session claims its waypoint BEFORE spawning (SPEC §13.2). The
  // prior LIVE session's cc id (`lastSessionId` — promoted only when a session
  // actually started) is captured so a released-then-reworked waypoint resumes
  // the same conversation. A failed claim (no longer on the frontier) ends the
  // just-created session row and rethrows.
  let waypoint: Waypoint | undefined
  let resumeSessionId: string | undefined
  let resumeUnavailableFrom: string | undefined
  // The row whose conversation is coming back, used by the re-entry cap.
  let resumedFrom: SessionRow | undefined
  if (input.waypointId) {
    const before = getWaypoint(ctx, input.waypointId)
    if (before.lastSessionId) {
      resumedFrom = getSessionRow(ctx, before.lastSessionId) ?? undefined
      resumeSessionId = resumedFrom?.ccSessionId ?? undefined
      // No cc id recorded for the remembered session → nothing the CLI could
      // `--resume`. Spawn fresh WITHOUT the flag (a bogus --resume makes claude
      // exit with "No conversation found") and say so on the timeline.
      if (!resumeSessionId) resumeUnavailableFrom = before.lastSessionId
    }
    try {
      // Re-check the one-live-session guard here, synchronously adjacent to the
      // claim itself (no `await` between the two). `workWaypoint` already checks
      // up front, but that check runs before this function's `await
      // ensureWorktree` above — leaving a window where two concurrent Work calls
      // on two DIFFERENT waypoints of the same feature both pass it before
      // either claims. This recheck is the race-free, authoritative gate. It
      // guards on live session ROWS (not claims), so a resolved-but-still-open
      // terminal blocks a second spawn too (E2E finding 8).
      assertSpawnable(ctx, feature, session.id)
      waypoint = claimWaypoint(ctx, input.waypointId, session.id)
    } catch (e) {
      markSessionEnded(ctx, session.id)
      throw e
    }
  }

  // Chat resumes the feature's one conversation. One-live-session guard first — same failure mode
  // as the waypoint path (end the just-created row, rethrow). No resumable
  // conversation is fine: the docs carry the state, so it starts fresh and the
  // timeline says so.
  if (input.kind === 'chat') {
    try {
      assertSpawnable(ctx, feature, session.id)
    } catch (e) {
      markSessionEnded(ctx, session.id)
      throw e
    }
    const prior = mostRecentResumableSession(ctx, feature.id, 'chat')
    if (prior?.ccSessionId) {
      resumedFrom = prior
      resumeSessionId = prior.ccSessionId
    } else if (listSessionsByFeature(ctx, feature.id).some(
      (candidate) => candidate.id !== session.id && candidate.kind === 'chat' && candidate.status === 'ended',
    )) {
      resumeUnavailableFrom = 'chat'
    }
  }

  // Every other kind resumes its own most recent
  // conversation on this feature. A terminal is a real `claude` process in a
  // server-owned PTY, so quitting runcastle kills it and boot reconciliation
  // marks the row ended — but the Claude Code transcript survives on disk and
  // the row kept its `ccSessionId`, so reopening the same kind of terminal picks
  // the conversation back up instead of starting cold from the docs. No prior
  // conversation is the ordinary first-launch case, so unlike waypoint/revisit
  // it gets no `resume_unavailable` note — there is nothing to be unavailable.
  if (input.kind !== 'waypoint' && input.kind !== 'chat') {
    resumedFrom = mostRecentResumableSession(ctx, feature.id, input.kind) ?? undefined
    resumeSessionId = resumedFrom?.ccSessionId
    if (
      !resumeSessionId &&
      listSessionsByFeature(ctx, feature.id).some(
        (prior) => prior.id !== session.id && prior.kind === input.kind && prior.status === 'ended',
      )
    ) {
      resumeUnavailableFrom = input.kind
    }
  }

  if (input.kind !== 'chat' && plan.explicit && resumeSessionId) {
    emit(ctx, feature.id, {
      type: 'session.resume_skipped',
      message: `starting the ${input.kind} session fresh — its explicit briefing replaces the prior conversation`,
      data: { sessionId: session.id, kind: input.kind, resumeSessionId },
    })
    resumeSessionId = undefined
    resumedFrom = undefined
  }

  // The re-entry cap: past a transcript size or a re-entry count, resuming costs
  // more than it carries, so launch fresh from the docs instead (see
  // `resumeCapExceeded`).
  const capped = input.kind === 'chat' ? null : applyResumeCap(ctx, resumeSessionId, resumedFrom, {
    featureId: feature.id,
  })
  if (capped) {
    resumeSessionId = undefined
    resumedFrom = undefined
    emit(ctx, feature.id, {
      type: 'session.resume_capped',
      message: `starting the ${input.kind} session fresh — ${capped.detail}; the docs carry the state`,
      data: { sessionId: session.id, kind: input.kind, ...capped },
    })
  }

  const kickoffLine = resumeSessionId && input.kind !== 'chat'
    ? undefined
    : kickoffLineFor(input.kind, plan.line, runtime.id)
  emit(ctx, feature.id, {
    type: 'session.launching',
    message: `launching ${input.kind} session`,
    data: {
      sessionId: session.id,
      kind: input.kind,
      worktreePath,
      waypointId: waypoint?.id,
      ...modelStamp(model),
    },
  })

  if (resumeSessionId) {
    emit(ctx, feature.id, {
      type: 'session.resumed',
      message: `resuming the previous ${input.kind} conversation`,
      data: { sessionId: session.id, kind: input.kind, resumeSessionId },
    })
  }

  if (runtime.id === 'codex' && resumeUnavailableFrom) {
    emit(ctx, feature.id, {
      type: 'session.resume_unavailable',
      message: CODEX_RESUME_UNAVAILABLE_MESSAGE,
      data: { sessionId: session.id },
    })
  } else if (input.kind === 'chat' && resumeUnavailableFrom) {
    emit(ctx, feature.id, {
      type: 'session.resume_unavailable',
      message: 'no resumable conversation for this feature — starting chat fresh from the docs',
      data: { sessionId: session.id },
    })
  }

  if (runtime.id !== 'codex' && waypoint && resumeUnavailableFrom) {
    emit(ctx, feature.id, {
      type: 'session.resume_unavailable',
      message: `waypoint ${waypoint.seq} has no resumable conversation — starting fresh`,
      data: { sessionId: session.id, waypointId: waypoint.id, lastSessionId: resumeUnavailableFrom },
    })
  }

  const spec = await runtime.writeArtifacts({
    session,
    feature,
    project,
    config: ctx.config,
    waypoint,
    lap: plan.lap,
    carried: plan.lap === undefined ? undefined : carried,
    // Which of the chat's two openings its brief renders (see `chatOpening`).
    planning: planningFacts(ctx, feature),
    purpose: input.purpose,
    worktreePath,
    serverUrl: serverUrlFor(ctx.config),
    model: model.id,
    resumeSessionId,
    resumeSourceSessionId: resumedFrom?.id,
    kickoffLine,
  })

  // spawn:false fabricates a session MINUS any process (SPEC §11 smoke driver).
  if (opts.spawn === false) {
    emit(ctx, feature.id, {
      type: 'session.launched',
      message: 'session prepared (terminal spawn skipped)',
      data: { sessionId: session.id, command: renderCommand(runtime, spec), spawned: false },
    })
    return { sessionId: session.id }
  }

  const spawned = spawnEmbeddedPty(ctx, feature, session, worktreePath, runtime, spec, {
    waypoint,
    resumeSessionId,
  })
  if (spawned && kickoffLine) {
    emit(ctx, feature.id, {
      type: 'session.kickoff',
      message: `opening ${input.kind} session with its briefing`,
      data: { sessionId: session.id, kind: input.kind, line: kickoffLine, mechanism: 'argv' },
    })
  }
  return { sessionId: session.id }
}

/**
 * Open a project-scoped preparation conversation (backs `project.talkToPrep`).
 *
 * Everything that makes `launchSession` feature-shaped is skipped: no feature
 * row, no worktree, no waypoint claim, no one-live-session-per-feature guard.
 * The session runs in the project's REAL checkout, which is the whole point —
 * the host-only keys a container can only propose (`devCommand`,
 * `driveSetupCommand`, `driveStopCommand`, `dbResetCommand`) can be
 * executed and verified here, and the human is present to answer for the ones
 * no amount of reading the repo can settle.
 *
 * Running in the real checkout is also the one hazard no other session kind
 * has: this terminal can dirty the working tree. The brief tells the agent to
 * ask before anything stateful, but that is guidance, not a guard — a future
 * hardening could take the guard from the burner's PreToolUse deny hook.
 *
 * Resumes its own previous conversation when there is one, so closing the
 * terminal and reopening it continues where you left off rather than making the
 * human re-explain their database — unless `fresh` is set, which is how
 * "re-prepare from scratch" is asked for: a baseline that has gone stale wants
 * re-measuring, and a resumed conversation carries every conclusion the last one
 * reached, which is exactly what re-measuring is meant to question.
 */
export async function launchPrepareSession(
  ctx: AppCtx,
  input: { projectId: string; fresh?: boolean },
  opts: LaunchSessionOptions = {},
): Promise<LaunchSessionResult> {
  const project = requireProjectById(ctx, input.projectId)

  const model = resolveModelEntry('prepare', ctx.config, project)
  const runtime = runtimeAdapterFor(model.runtime)
  assertRuntimeReady(runtime, opts)

  const session = createSessionRow(ctx, {
    projectId: project.id,
    kind: 'prepare',
    // No worktree: preparation is about THIS machine's checkout, and a docs-only
    // talk worktree could neither run the dev server nor see the real .env.
    worktreePath: project.repoPath,
    model,
  })

  const resumedFrom = input.fresh
    ? undefined
    : (mostRecentResumableProjectSession(ctx, project.id, 'prepare') ?? undefined)
  let resumeSessionId = resumedFrom?.ccSessionId ?? undefined

  // Preparation is the kind most likely to be re-entered and the one measured
  // reaching 1.42 MB across four rows, so the cap matters most here.
  const capped = applyResumeCap(ctx, resumeSessionId, resumedFrom, {
    projectId: project.id,
    kind: 'prepare',
  })
  if (capped) resumeSessionId = undefined

  emitProject(ctx, project.id, {
    // A deliberate fresh start reads exactly like a first-ever preparation on
    // the timeline unless it says so — and it is the one the human chose over
    // the cheaper resume, which is worth being able to see later.
    type: 'session.launching',
    message: input.fresh
      ? 'launching preparation session from scratch'
      : 'launching preparation session',
    data: {
      sessionId: session.id,
      kind: 'prepare',
      worktreePath: project.repoPath,
      ...modelStamp(model),
      ...(input.fresh ? { fresh: true } : {}),
    },
  })
  if (resumeSessionId) {
    emitProject(ctx, project.id, {
      type: 'session.resumed',
      message: 'resuming the previous preparation conversation',
      data: { sessionId: session.id, resumeSessionId },
    })
  } else if (capped) {
    emitProject(ctx, project.id, {
      type: 'session.resume_capped',
      message: `starting the preparation session fresh — ${capped.detail}; the recorded findings carry the state`,
      data: { sessionId: session.id, kind: 'prepare', ...capped },
    })
  } else if (
    runtime.id === 'codex' &&
    !input.fresh &&
    hasCompletedProjectSession(ctx, project.id, 'prepare')
  ) {
    emitProject(ctx, project.id, {
      type: 'session.resume_unavailable',
      message: CODEX_RESUME_UNAVAILABLE_MESSAGE,
      data: { sessionId: session.id },
    })
  }

  const prepare = await buildPrepareBrief(ctx, project)

  const kickoffLine = resumeSessionId
    ? undefined
    : kickoffLineFor(
        'prepare',
        prepare.remainingKeys.length === 0 ? prepareConfirmKickoffFor(runtime.id) : undefined,
        runtime.id,
      )
  const spec = await runtime.writeArtifacts({
    session,
    project,
    config: ctx.config,
    prepare,
    worktreePath: project.repoPath,
    serverUrl: serverUrlFor(ctx.config),
    model: model.id,
    resumeSessionId,
    resumeSourceSessionId: resumedFrom?.id,
    kickoffLine,
  })

  if (opts.spawn === false) {
    emitProject(ctx, project.id, {
      type: 'session.launched',
      message: 'preparation session prepared (terminal spawn skipped)',
      data: { sessionId: session.id, command: renderCommand(runtime, spec), spawned: false },
    })
    return { sessionId: session.id }
  }

  const spawned = spawnEmbeddedPty(ctx, undefined, session, project.repoPath, runtime, spec, {
    resumeSessionId,
  })
  if (spawned && kickoffLine) {
    emitProject(ctx, project.id, {
      type: 'session.kickoff',
      message: 'opening preparation session with its briefing',
      data: { sessionId: session.id, kind: 'prepare', line: kickoffLine, mechanism: 'argv' },
    })
  }
  return { sessionId: session.id }
}

/**
 * Open the one-click recovery from a failed drive (backs `feature.fixDrive`) —
 * decision 9 of preparation-supports-multi-service-projects.
 *
 * Feature-scoped, and yet built from {@link launchPrepareSession} rather than
 * {@link launchSession}: no worktree, the developer's REAL checkout, host-side
 * ask-before-act rules. That is because the thing it repairs is the machine, not
 * the code — and the failed drive is standing right there with the feature
 * branch checked out, which is exactly the state the fix agent needs. So the
 * drive is deliberately NOT stopped here; `retry_drive` is what ends it, once
 * the agent has something to retry with.
 *
 * Refused unless a drive of THIS feature is currently failing. The affordance
 * only ever appears over a failure, and a session opened without one has no
 * mandate to carry out — its whole brief is the failure. It is never
 * auto-spawned (decision 4): an agent does not start running on someone's
 * machine uninvited.
 *
 * It counts as the feature's one terminal (`assertSpawnable`), because it is
 * one: a terminal open on this feature while another is live is the thing that
 * guard exists to prevent, whatever either was opened to do.
 */
export async function launchDriveFixSession(
  ctx: AppCtx,
  input: { featureId: string },
  opts: LaunchSessionOptions = {},
): Promise<LaunchSessionResult> {
  const feature = getFeatureRow(ctx, input.featureId)
  requireNotDraft(feature)
  const project = projectForFeature(ctx, feature)

  const drive = git.activeDriveInfo()
  if (drive?.featureId !== feature.id || !drive.hookFailure) {
    throw new GateError(
      `no failed drive to fix on ${feature.slug} — a drive-fix session is opened from a drive ` +
        'whose setup failed, and carries that failure as its whole brief. Start a drive first.',
    )
  }
  assertSpawnable(ctx, feature)

  // Prepare's step, deliberately: this is the same host-side environment work
  // under a narrower mandate, and a step of its own would be a settings field
  // nobody asked for.
  const model = resolveModelEntry('prepare', ctx.config, project)
  const runtime = runtimeAdapterFor(model.runtime)
  assertRuntimeReady(runtime, opts)

  const session = createSessionRow(ctx, {
    featureId: feature.id,
    kind: 'drive-fix',
    // No worktree, for preparation's reason: the environment that broke is this
    // machine's, and a docs-only talk worktree could neither run the setup
    // script nor see the drive.env it was supposed to write.
    worktreePath: project.repoPath,
    model,
  })

  emit(ctx, feature.id, {
    type: 'session.launching',
    message: `launching drive-fix session — ${drive.hookFailure.phase} failed on ${drive.branch}`,
    data: {
      sessionId: session.id,
      kind: 'drive-fix',
      worktreePath: project.repoPath,
      branch: drive.branch,
      command: drive.hookFailure.command,
      ...modelStamp(model),
    },
  })

  // Every "Fix drive" click used to be a COLD start: no `resumeSessionId` was
  // ever passed, so an agent on its third attempt re-theorised the same failure
  // from scratch with no memory of the two fixes it had already tried. Resume
  // this feature's last drive-fix conversation when there is one — the fault is
  // usually the same fault, and what did not work is the most useful thing it
  // knows. The re-entry cap still applies.
  const resumedFrom = mostRecentResumableSession(ctx, feature.id, 'drive-fix') ?? undefined
  let resumeSessionId = resumedFrom?.ccSessionId
  const capped = applyResumeCap(ctx, resumeSessionId, resumedFrom, {
    featureId: feature.id,
    kind: 'drive-fix',
  })
  if (capped) resumeSessionId = undefined

  if (resumeSessionId) {
    emit(ctx, feature.id, {
      type: 'session.resumed',
      message: 'resuming the previous drive-fix conversation — it already knows what it tried',
      data: { sessionId: session.id, kind: 'drive-fix', resumeSessionId },
    })
  } else if (capped) {
    emit(ctx, feature.id, {
      type: 'session.resume_capped',
      message: `starting the drive-fix session fresh — ${capped.detail}; the failure is in the brief`,
      data: { sessionId: session.id, kind: 'drive-fix', ...capped },
    })
  } else if (
    runtime.id === 'codex' &&
    listSessionsByFeature(ctx, feature.id).some(
      (prior) => prior.id !== session.id && prior.kind === 'drive-fix' && prior.status === 'ended',
    )
  ) {
    emit(ctx, feature.id, {
      type: 'session.resume_unavailable',
      message: CODEX_RESUME_UNAVAILABLE_MESSAGE,
      data: { sessionId: session.id },
    })
  }

  const kickoffLine = resumeSessionId
    ? undefined
    : kickoffLineFor('drive-fix', undefined, runtime.id)
  const spec = await runtime.writeArtifacts({
    session,
    project,
    config: ctx.config,
    driveFix: {
      project,
      feature,
      failure: drive.hookFailure,
      envKeys: drive.envKeys ?? [],
      delta: await git.featureBranchDelta(project, feature),
    },
    worktreePath: project.repoPath,
    serverUrl: serverUrlFor(ctx.config),
    model: model.id,
    resumeSessionId,
    resumeSourceSessionId: resumedFrom?.id,
    kickoffLine,
  })

  if (opts.spawn === false) {
    emit(ctx, feature.id, {
      type: 'session.launched',
      message: 'drive-fix session prepared (terminal spawn skipped)',
      data: { sessionId: session.id, command: renderCommand(runtime, spec), spawned: false },
    })
    return { sessionId: session.id }
  }

  // No docs watch (the `feature` argument): this session repairs the
  // environment and never writes the feature's docs.
  const spawned = spawnEmbeddedPty(ctx, undefined, session, project.repoPath, runtime, spec, {
    resumeSessionId,
  })
  if (spawned && kickoffLine) {
    emit(ctx, feature.id, {
      type: 'session.kickoff',
      message: 'opening drive-fix session with its briefing',
      data: { sessionId: session.id, kind: 'drive-fix', line: kickoffLine, mechanism: 'argv' },
    })
  }
  return { sessionId: session.id }
}

/**
 * Open the project's intake conversation (backs `project.talkToProject`) — the
 * session that turns a lump of raw intent into features (decisions 17–20).
 *
 * Modelled on {@link launchPrepareSession}, and differing from it in exactly the
 * ways decision 18 requires:
 * - it runs in a runcastle-owned worktree on `runcastle/project`, cut from the
 *   base tip at launch, NEVER in the human's checkout — this session writes the
 *   whole repo, and its commits land on the base branch when the terminal ends;
 * - `--permission-mode default` rather than `acceptEdits`: the docs-only
 *   justification feature terminals run on evaporates with whole-repo write
 *   access, and prompting is what the human's own Claude Code does anyway.
 *
 * One live project session per project. That guard is `assertSpawnable`'s
 * cousin, not `assertSpawnable` itself: the feature rule exists because git
 * forbids two checkouts of one branch, which says nothing about feature
 * terminals — they and this session are orthogonal and never contend.
 *
 * A launch is FRESH unless it names a conversation to resume (decision 5). The
 * project chat is a list now, so "open the chat" means a new conversation and
 * picking up an old one is a click on that old one — the reverse of what this
 * used to do, which was to silently resume the single endless conversation
 * whatever the human meant by opening it. `resumeSessionId` is a runcastle
 * SESSION ROW id (what the conversation list hands back), not a Claude Code id;
 * `fresh` is the explicit spelling of the default, and wins over a row id, so a
 * "New chat" click can never resume something.
 */
export async function launchProjectSession(
  ctx: AppCtx,
  input: { projectId: string; fresh?: boolean; resumeSessionId?: string },
  opts: LaunchSessionOptions = {},
): Promise<LaunchSessionResult> {
  const project = requireProjectById(ctx, input.projectId)

  const live = activeProjectSession(ctx, project.id, 'project')
  if (live) {
    throw new GateError(
      `a project session is already open for ${project.name} — resume or end it first`,
    )
  }

  const model = resolveModelEntry('project', ctx.config, project)
  const runtime = runtimeAdapterFor(model.runtime)
  assertRuntimeReady(runtime, opts)

  const { worktreePath, base } = await git.ensureProjectWorktree(project, (res) =>
    reportProjectLanding(ctx, project, res, { retried: true }),
  )
  const session = createSessionRow(ctx, {
    projectId: project.id,
    kind: 'project',
    worktreePath,
    model,
  })

  // The chosen conversation's Claude Code id. Absent means the row never went
  // live and has nothing the CLI could `--resume` (a bogus `--resume` makes
  // claude exit with "No conversation found"), so we spawn fresh and say so.
  const resumeRowId = input.fresh ? undefined : input.resumeSessionId
  const resumedFrom = resumeRowId ? (getSessionRow(ctx, resumeRowId) ?? undefined) : undefined
  let resumeSessionId = resumedFrom?.ccSessionId ?? undefined

  const capped = applyResumeCap(ctx, resumeSessionId, resumedFrom, {
    projectId: project.id,
    kind: 'project',
  })
  if (capped) resumeSessionId = undefined

  emitProject(ctx, project.id, {
    type: 'session.launching',
    message: resumeSessionId ? 'resuming a project conversation' : 'launching a new project chat',
    data: {
      sessionId: session.id,
      kind: 'project',
      worktreePath,
      branch: git.PROJECT_BRANCH,
      ...modelStamp(model),
      ...(resumeSessionId ? {} : { fresh: true }),
    },
  })
  if (resumeSessionId) {
    emitProject(ctx, project.id, {
      type: 'session.resumed',
      message: 'resuming the previous project conversation',
      data: { sessionId: session.id, resumeSessionId, resumedFrom: resumeRowId },
    })
  } else if (capped) {
    emitProject(ctx, project.id, {
      type: 'session.resume_capped',
      message: `starting a new project chat — ${capped.detail}; the repo and the charter carry the state`,
      data: { sessionId: session.id, kind: 'project', ...capped },
    })
  } else if (resumeRowId) {
    emitProject(ctx, project.id, {
      type: 'session.resume_unavailable',
      message:
        runtime.id === 'codex'
          ? CODEX_RESUME_UNAVAILABLE_MESSAGE
          : 'that conversation was never picked up by Claude Code — starting a new chat instead',
      data: {
        sessionId: session.id,
        ...(runtime.id === 'codex' ? {} : { resumedFrom: resumeRowId }),
      },
    })
  }

  const kickoffLine = resumeSessionId ? undefined : kickoffLineFor('project', undefined, runtime.id)
  const spec = await runtime.writeArtifacts({
    session,
    project,
    config: ctx.config,
    projectBrief: { project, branch: git.PROJECT_BRANCH, worktreePath, base },
    worktreePath,
    serverUrl: serverUrlFor(ctx.config),
    model: model.id,
    resumeSessionId,
    resumeSourceSessionId: resumedFrom?.id,
    kickoffLine,
    // Decision 18: whole-repo write access voids the acceptEdits justification.
    permissionMode: 'default',
  })

  if (opts.spawn === false) {
    emitProject(ctx, project.id, {
      type: 'session.launched',
      message: 'project session prepared (terminal spawn skipped)',
      data: { sessionId: session.id, command: renderCommand(runtime, spec), spawned: false },
    })
    return { sessionId: session.id }
  }

  const spawned = spawnEmbeddedPty(ctx, undefined, session, worktreePath, runtime, spec, {
    resumeSessionId,
  })
  if (spawned && kickoffLine) {
    emitProject(ctx, project.id, {
      type: 'session.kickoff',
      message: 'opening project session with its briefing',
      data: { sessionId: session.id, kind: 'project', line: kickoffLine, mechanism: 'argv' },
    })
  }
  return { sessionId: session.id }
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
async function buildPrepareBrief(ctx: AppCtx, project: Project): Promise<PrepareBrief> {
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

/** Lockfiles, newest-convention first — the first one present names the manager. */
const LOCKFILES: readonly (readonly [string, string])[] = [
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['uv.lock', 'uv'],
  ['poetry.lock', 'poetry'],
  ['Cargo.lock', 'cargo'],
  ['go.sum', 'go'],
]

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

/**
 * Work a waypoint (SPEC §13.2, backs `feature.workWaypoint`). A `research`
 * waypoint is worked AFK: it claims the waypoint for a headless `research` run
 * and returns `{ runId }`. Every other type opens a kind=`waypoint` HITL session
 * (claimed transactionally inside `launchSession`) and returns `{ sessionId }`.
 * Refuses up front when the feature is not mapped, the waypoint belongs to
 * another feature, or (HITL only) a waypoint session is already live (one live
 * HITL session per feature). The claim — inside `launchSession` for HITL, inside
 * `startRun` for research — is the transactional frontier gate, so a waypoint
 * that is claimed/terminal/blocked can never be worked.
 *
 * The HITL path owns the whole handoff atomically (decision #8): it first sweeps
 * away any live session it can prove is finished, and — with `endLive`, the
 * human having confirmed — any live session at all. Doing it here rather than as
 * a client-side end-then-work keeps it one mutation with no window where the
 * feature holds nothing.
 */
export async function workWaypoint(
  ctx: AppCtx,
  input: { featureId: string; waypointId: string; endLive?: boolean },
  opts: LaunchSessionOptions = {},
): Promise<LaunchSessionResult | WorkRunResult> {
  const feature = getFeatureRow(ctx, input.featureId)
  requireNotDraft(feature)
  if (!feature.mapped) {
    throw new GateError(`feature ${feature.slug} is not mapped — it has no waypoints to work`)
  }

  const wp = getWaypoint(ctx, input.waypointId)
  if (wp.featureId !== feature.id) {
    throw new GateError(`waypoint ${wp.seq} does not belong to feature ${feature.slug}`)
  }

  // Research waypoints run AFK (SPEC §13.2): claim the waypoint for the run (the
  // transactional frontier gate lives in `startRun`) and hand it the waypoint as
  // per-run input. Run failure/cancel auto-releases it back to the frontier.
  if (wp.type === 'research') {
    const { runId } = await startRun(ctx, feature.id, 'research', {
      input: wp,
      claimWaypointId: wp.id,
    })
    return { runId }
  }

  // Make room: end the live sessions that are finished (or, with `endLive`, all
  // of them). Research is deliberately above this — an AFK run is not a session
  // and runs in parallel, so it is neither swept nor blocked by the sweep.
  sweepActiveSessions(ctx, feature, input.endLive === true)

  // Fast-fail guard on live HITL SESSION rows + active runs (never on waypoint
  // claims — a parallel research run's claim must not block HITL work, and a
  // resolved claim must not unblock a second terminal while the first is live).
  // The race-free authoritative recheck runs inside `launchSession`.
  assertSpawnable(ctx, feature)

  return launchSession(ctx, { featureId: feature.id, kind: 'waypoint', waypointId: wp.id }, opts)
}

/**
 * Converge a mapped feature (ADR-0001 / SPEC §13.2, backs `feature.converge`).
 *
 * Open waypoints no longer refuse it: with the gates gone, an unfinished map is
 * something the human reads and converges anyway, the same as remaining fog
 * (`Not yet specified` prose), which was never enforced either.
 *
 * Convergence moves the feature nowhere — the map is a mode inside planning, so
 * the fresh kind=`converge` session it spawns lands in the state it started in,
 * with NO downstream special-casing: it reads only the compressed knowledge
 * (map + decisions) and runs the existing spec → tickets skills unbroken.
 */
export async function converge(
  ctx: AppCtx,
  input: { featureId: string },
  opts: LaunchSessionOptions = {},
): Promise<LaunchSessionResult> {
  const feature = getFeatureRow(ctx, input.featureId)
  requireNotDraft(feature)
  if (!feature.mapped) {
    throw new GateError(`feature ${feature.slug} is not mapped — convergence is only for mapped features`)
  }
  if (feature.phase !== 'planning') {
    throw new GateError(`converge runs during planning — feature ${feature.slug} is already at ${feature.phase}`)
  }
  return launchSession(ctx, { featureId: feature.id, kind: 'converge' }, opts)
}

/** Spawn-time context the PTY exit handler needs to report honestly. */
export interface SpawnMeta {
  /** The waypoint this session claimed (kind=waypoint), if any. */
  waypoint?: Waypoint
  /** The cc session id this launch tried to `--resume`, if any. */
  resumeSessionId?: string
}

/**
 * PTY exit finalizer (exported for the vitest seam). Marks the session ended,
 * auto-releases its waypoint (SPEC §13.2 — no-op when already resolved), and
 * emits `session.pty_exited`. When a RESUME attempt dies before ever reaching
 * `live` (the session-start hook never fired — e.g. claude exited with "No
 * conversation found with session ID"), it additionally emits
 * `session.resume_failed` so the UI can toast; the waypoint's `lastSessionId`
 * still points at the previous good session (promotion happens only at live),
 * so the next Resume targets the right conversation instead of silently
 * spawning fresh.
 */
export function handlePtyExit(
  ctx: AppCtx,
  feature: Feature | undefined,
  session: SessionRow,
  meta: SpawnMeta,
  exitCode: number | undefined | null,
): void {
  const diedBeforeLive = getSessionRow(ctx, session.id)?.status === 'launching'
  markSessionEnded(ctx, session.id)
  // Closing a waypoint terminal without resolving auto-releases its waypoint
  // back to the frontier (SPEC §13.2); no-op for non-waypoint sessions or when
  // the agent already resolved.
  releaseForSession(ctx, session.id)
  // A project session's commits land on the base branch when its terminal goes
  // (decision 18) — including when it dies on its own; no-op for other kinds.
  landProjectSession(ctx, session)
  if (session.runtime === 'codex' && feature) {
    void noteResolvedMerge(ctx, session, feature).catch(() => {})
  }
  if (diedBeforeLive && meta.resumeSessionId) {
    const label = meta.waypoint ? `waypoint ${meta.waypoint.seq} (${meta.waypoint.title})` : session.kind
    emitForSession(ctx, session, {
      type: 'session.resume_failed',
      message: `resume failed for ${label} — the session exited before starting (code ${exitCode ?? 'unknown'}); the previous conversation is still resumable`,
      data: {
        sessionId: session.id,
        waypointId: meta.waypoint?.id ?? null,
        resumeSessionId: meta.resumeSessionId,
        exitCode: exitCode ?? null,
      },
    })
  }
  emitForSession(ctx, session, {
    type: 'session.pty_exited',
    message: ptyExitMessage(exitCode),
    data: { sessionId: session.id, exitCode: exitCode ?? null },
  })
}

/**
 * Spawn the runtime's CLI inside a server-owned PTY from its {@link
 * RuntimeLaunchSpec}. A native `.exe` is spawned directly; a `.cmd`/`.bat`/`.ps1`
 * shim goes through its interpreter (ConPTY cannot exec any of them directly) —
 * see {@link spawnTargetFor}. The env is the server's own, plus what the runtime
 * asked for and minus what it asked to have scrubbed (UI-SPEC §5 — no `cmd /k`
 * env prefix, no `wt.exe`).
 *
 * The PTY is registered by session id and the WS endpoint streams it. On process
 * exit we mark the session ended and emit `session.pty_exited`. A spawn failure
 * is surfaced as an event, never thrown — it comes back as `false`, which is how
 * callers know no CLI ever received the argv and so no kickoff was delivered.
 */
function spawnEmbeddedPty(
  ctx: AppCtx,
  feature: Feature | undefined,
  session: SessionRow,
  worktreePath: string,
  runtime: AgentRuntimeAdapter,
  spec: RuntimeLaunchSpec,
  meta: SpawnMeta = {},
): boolean {
  const { file, args } = spawnTargetFor(runtime.resolveBinary(), spec.argv)
  const env: Record<string, string | undefined> = { ...process.env, ...spec.env }
  for (const key of spec.envScrub) delete env[key]
  try {
    const entry = ptyRegistry().create({
      sessionId: session.id,
      cmd: file,
      args,
      opts: { cwd: worktreePath, env, cols: 80, rows: 24, useConpty: true },
      onExit: ({ exitCode }) => handlePtyExit(ctx, feature, session, meta, exitCode),
    })
    // The session is about to write docs; watch them so the UI sees the spec
    // appear as it is written. Feature sessions only — the prepare and project
    // sessions have no feature and so no feature docs dir.
    if (feature) startDocsWatch(ctx, feature)
    emitForSession(ctx, session, {
      type: 'session.launched',
      message: 'embedded terminal spawned',
      data: { sessionId: session.id, mode: 'embedded', pid: entry.pty.pid },
    })
    // A spawned process is not a working session: everything downstream (going
    // live, the kickoff, the cc session id) hangs off the SessionStart hook, so
    // a terminal that never reports ready must say so instead of sitting there
    // looking healthy.
    armSessionReadyWatchdog(ctx, session)
    return true
  } catch (err) {
    // A session that never got a process must not linger `launching` — the
    // one-live-session guard reads session rows, so a leaked row would block
    // every future terminal on this feature until the next boot reconciliation.
    markSessionEnded(ctx, session.id)
    releaseForSession(ctx, session.id)
    emitForSession(ctx, session, {
      type: 'session.spawn_failed',
      message: `failed to spawn embedded terminal: ${err instanceof Error ? err.message : String(err)}`,
      data: { sessionId: session.id, mode: 'embedded' },
    })
    return false
  }
}
