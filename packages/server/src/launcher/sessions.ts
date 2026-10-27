import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  AgentRuntime,
  MergeBranchPair,
  ModelEntry,
  Project,
  SessionKind,
  SessionPurpose,
  SessionRow,
} from '@runcastle/core'
import { DEFAULT_RUNTIME, newId } from '@runcastle/core'
import { and, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { sessions } from '../db/schema'
import { publishLive } from '../services/bus'
import { stopDocsWatch } from '../services/docs-watch'
import { emitProject } from '../services/events'
import {
  landProjectBranch,
  PROJECT_BRANCH,
  resolveSessionBranch,
  type ProjectLandResult,
} from '../services/git'
import { getProjectById, rowToSession } from '../services/repo'
import { hasThreadLog } from '../threads/log'
import { runtimeAdapterFor } from './runtimes'
import { prepareConfirmKickoffFor } from './runtimes/skills'

/**
 * Session-row persistence for the launcher + hook receiver + MCP server. There
 * is no A1 service for session mutation (sessions are entirely a B1 concern), so
 * these helpers own the `sessions` table via the drizzle query builder (never
 * raw SQL). They perform no event emission — callers (launcher.ts, hooks.ts)
 * emit the lifecycle events so the timeline messages stay meaningful.
 */

/**
 * Exactly one of `featureId` / `projectId` is set: feature sessions carry their
 * feature and derive the project through it; a project-scoped `prepare` session
 * carries the project directly because it has no feature to derive one from.
 */
export type CreateSessionInput = {
  kind: SessionKind
  worktreePath: string
  /** The errand this session was opened on, when `kind` cannot say it (see {@link SessionPurpose}). */
  purpose?: SessionPurpose
  /** The purpose's data — for `resolve-conflict`, the branch pair being merged. */
  purposeData?: MergeBranchPair
  /**
   * The `{ id, runtime }` pair this session launches on, resolved by
   * `resolveModelEntry`. Optional because a row can be created outside a launch
   * (fixtures, tests) and such a row resolved no model — see the db schema for
   * why a default is not stamped in its place.
   */
  model?: ModelEntry
  /** A `side` session's main-chat row at open time (see the db schema). */
  openedBeside?: string
} & ({ featureId: string; projectId?: never } | { projectId: string; featureId?: never })

/** Insert a fresh session row in the `launching` state; returns it (with id). */
export function createSessionRow(ctx: AppCtx, input: CreateSessionInput): SessionRow {
  const row = ctx.db
    .insert(sessions)
    .values({
      id: newId('sess'),
      featureId: input.featureId ?? null,
      projectId: input.projectId ?? null,
      kind: input.kind,
      purpose: input.purpose ?? null,
      purposeData: input.purposeData ?? null,
      ccSessionId: null,
      transcriptPath: null,
      status: 'launching',
      worktreePath: input.worktreePath,
      model: input.model?.id ?? null,
      runtime: input.model?.runtime ?? null,
      // Nothing runs headless any more (ADR-0015); the column stays for old rows.
      headless: false,
      // Named lazily from the transcript once there is one (see
      // `services/conversations.ts`) — a row born a millisecond ago has
      // nothing to be called yet.
      title: null,
      createdAt: Date.now(),
      openedBeside: input.openedBeside ?? null,
    })
    .returning()
    .get()
  return rowToSession(row)
}

export function getSessionRow(ctx: AppCtx, id: string): SessionRow | null {
  const row = ctx.db.select().from(sessions).where(eq(sessions.id, id)).get()
  return row ? rowToSession(row) : null
}

/**
 * Every non-ended session row (`launching` | `live`) for a feature. This is the
 * one-live-HITL-session-per-feature guard's source of truth (E2E findings 5+8):
 * the launcher refuses to spawn while any of these exist, so the guard cannot lie
 * about an AFK run (runs never create session rows).
 */
export function activeSessionsForFeature(ctx: AppCtx, featureId: string): SessionRow[] {
  return ctx.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.featureId, featureId), inArray(sessions.status, ['launching', 'live'])))
    .all()
    .map(rowToSession)
}

/**
 * Per-session TURN state (decisions §3): the agent has finished a turn and is
 * waiting on the human. Two hooks drive one bit — `UserPromptSubmit` means a
 * prompt went in and the agent is working on it, `Stop` means it has stopped —
 * and the triage lanes read the result through `feature.list`. Without it a
 * live session mid-thought and a live session that has been idle for an hour
 * are the same row, which is why every active ideation feature used to sit in
 * "Needs you" whether or not anyone was talking to it.
 *
 * Last hook wins, deliberately: the two interleave for the whole conversation,
 * and a prompt landing after a `Stop` is the human answering — the agent
 * working again. An unknown session id updates nothing rather than throwing;
 * these are called from the hook receiver, which must never break a session.
 */
export function markAgentWorking(ctx: AppCtx, id: string): void {
  setAwaitingInput(ctx, id, false)
}

/** @see {@link markAgentWorking} — the other half of the turn. */
export function markAwaitingInput(ctx: AppCtx, id: string): void {
  setAwaitingInput(ctx, id, true)
}

/**
 * Write the bit, and push when it actually moved: the feature header's status
 * line ("Working" vs "Ready for you") reads it, and with no signal the browser
 * would only see a turn end on the 30s safety poll.
 */
function setAwaitingInput(ctx: AppCtx, id: string, awaitingInput: boolean): void {
  const changed = ctx.db
    .update(sessions)
    .set({ awaitingInput })
    .where(and(eq(sessions.id, id), ne(sessions.awaitingInput, awaitingInput)))
    .returning({ id: sessions.id })
    .all()
  if (changed.length > 0) publishLive({ kind: 'turn', sessionId: id })
}

export interface MarkLiveInput {
  ccSessionId?: string
  transcriptPath?: string
}

/**
 * Mark a session `live` and store the Claude Code session id + transcript path
 * reported by the SessionStart hook. Returns the updated row, or null when the
 * session id is unknown (the caller must not break the user's session).
 *
 * Nothing is delivered here: a fresh session was opened with its kickoff already
 * in the CLI's argv, and a resumed one is picking a conversation back up.
 */
export function markSessionLive(
  ctx: AppCtx,
  id: string,
  input: MarkLiveInput = {},
): SessionRow | null {
  const existing = getSessionRow(ctx, id)
  if (!existing) return null
  ctx.db
    .update(sessions)
    .set({
      status: 'live',
      ccSessionId: input.ccSessionId ?? existing.ccSessionId ?? null,
      transcriptPath: input.transcriptPath ?? existing.transcriptPath ?? null,
    })
    .where(eq(sessions.id, id))
    .run()
  return getSessionRow(ctx, id)
}

/**
 * The kickoff line for a session: an explicit override wins, else the per-kind
 * default of the runtime the session runs on — the skill invocation is spelled
 * differently per runtime, so the line comes from the adapter and never from a
 * table here. `runtime` is optional because a session row written before the
 * column existed has none; those all ran on {@link DEFAULT_RUNTIME}.
 */
export function kickoffLineFor(
  kind: SessionKind,
  override?: string,
  runtime: AgentRuntime = DEFAULT_RUNTIME,
): string {
  return override ?? runtimeAdapterFor(runtime).kickoffLine(kind)
}

/**
 * The prepare kickoff for a project with NOTHING left to establish, spelled for
 * the default runtime (see {@link prepareConfirmKickoffFor} for the per-runtime
 * form the launcher uses).
 */
export const PREPARE_CONFIRM_KICKOFF = prepareConfirmKickoffFor(DEFAULT_RUNTIME)

/** What a launch is going to say to its thread, and what that implies. */
export interface KickoffPlan {
  /** The briefing to send; absent means the per-kind default line. */
  line?: string
  /**
   * The caller brought a briefing of its own (a merge-conflict hand-off), so
   * the launch speaks even when it reopens a conversation already under way.
   */
  explicit: boolean
}

/**
 * Decide a launch's kickoff (exported seam — see {@link KickoffPlan}): an
 * override passed by the caller is an explicit briefing, and no override means
 * the per-kind default. There is no lap to plan any more: the lead runs rounds
 * (`the-feature-lead-runs-rounds`), so nothing here briefs one.
 */
export function planKickoff(input: { kind: SessionKind; kickoffLine?: string }): KickoffPlan {
  const line = input.kickoffLine
  if (!line) return { explicit: false }
  return { line, explicit: true }
}

/**
 * Session ids whose landing is in flight. A project thread ended from the UI
 * runs BOTH end paths — `endSession` stops its process, whose stop then lands
 * too — and two concurrent merges of the same branch is not a race worth
 * having. An id is let go when its landing settles: a thread keeps its row for
 * life, so each time its process stops it lands what it wrote since.
 */
const landingProjectSessions = new Set<string>()

/**
 * Landings still in flight. Kicking one off is deliberately fire-and-forget (see
 * {@link landProjectSession}), but the git children it spawns hold handles on the
 * repo working tree, and they outlive the teardown path that started them. On
 * Windows an open handle fails a directory removal with EPERM outright rather
 * than waiting, so the work has to stay *observable*: anything about to delete
 * the repo can wait for it via {@link awaitProjectLandings}.
 */
const inFlightLandings = new Set<Promise<void>>()

/** What becomes of work a landing could not place — the same in every report. */
const LANDING_KEPT = `they are kept on ${PROJECT_BRANCH} and retried at the next launch`

/**
 * Resolve once every landing kicked off so far has finished — including any
 * started while we were waiting. Never rejects: a landing reports its own
 * failures to the timeline, so there is nothing here for a caller to handle.
 */
export async function awaitProjectLandings(): Promise<void> {
  while (inFlightLandings.size > 0) {
    await Promise.allSettled([...inFlightLandings])
  }
}

/**
 * Land a finished PROJECT session's work on the base branch (decision 18) and
 * report what happened on the project timeline. No-op for every other kind.
 *
 * The session commits its own work (its closing move is "land what you wrote
 * and leave the tree clean"); this only moves those commits from
 * `runcastle/project` onto the base branch, where they arrive in the human's
 * checkout the way a `git pull` does. A conflict is not a failure to hide: the
 * merge refuses, the branch keeps the work, and the next launch retries it.
 *
 * Fire-and-forget on purpose — both call sites are synchronous teardown paths
 * (a PTY exit handler and `endSession`), and a session must still close cleanly
 * when git is having a bad day. Forgotten, though, is not unobservable: the
 * in-flight work is tracked, so a caller that needs the git children gone before
 * it touches the repo directory can await {@link awaitProjectLandings}.
 */
export function landProjectSession(ctx: AppCtx, session: SessionRow): void {
  if (session.kind !== 'project' || !session.projectId) return
  if (landingProjectSessions.has(session.id)) return
  landingProjectSessions.add(session.id)
  const project = getProjectById(ctx, session.projectId)
  if (!project) return

  // `base` is null only when resolving it is what failed — a stored pick that
  // has vanished — and that GateError already names the branch and the picker.
  const landFailed = (base: string | null, e: unknown): void => {
    const error = e instanceof Error ? e.message : String(e)
    emitProject(ctx, project.id, {
      type: 'project.land_failed',
      message: `could not land the project session's work${
        base ? ` onto ${base}` : ''
      }: ${error} — ${LANDING_KEPT}`,
      data: { sessionId: session.id, branch: PROJECT_BRANCH, error },
    })
  }

  const landing = resolveSessionBranch(project).then(
    (base) =>
      landProjectBranch(project, base).then(
        (res) => {
          // The conversation wrote nothing — no timeline noise.
          if (res) reportProjectLanding(ctx, project, res, { sessionId: session.id })
        },
        (e: unknown) => landFailed(base, e),
      ),
    (e: unknown) => landFailed(null, e),
  )
  inFlightLandings.add(landing)
  void landing.finally(() => {
    inFlightLandings.delete(landing)
    landingProjectSessions.delete(session.id)
  })
}

/**
 * Put a project-branch landing on the project's timeline.
 *
 * Shared by both halves of the landing protocol: the attempt at session end
 * ({@link landProjectSession}) and the retry at the next launch
 * (`git.ensureProjectWorktree`). The retry used to be silent, which was the
 * worse of the two to lose — a successful retry is the ONLY thing that
 * supersedes the standing `project.land_conflict` from the attempt that failed,
 * so without it the UI went on claiming the work was stranded on
 * `runcastle/project` long after it had landed on the user's main branch.
 */
export function reportProjectLanding(
  ctx: AppCtx,
  project: Project,
  res: ProjectLandResult,
  data: Record<string, unknown> = {},
): void {
  const report = (type: string, message: string, extra: Record<string, unknown>): void => {
    emitProject(ctx, project.id, {
      type,
      message,
      data: { branch: PROJECT_BRANCH, ...data, ...extra },
    })
  }
  if (res.landed) {
    report(
      'project.landed',
      `landed ${res.commits} commit(s) from the project session onto ${res.base}`,
      { commits: res.commits },
    )
  } else if (res.conflict) {
    report(
      'project.land_conflict',
      `the project session's ${res.commits} commit(s) conflict with ${res.base} — nothing was overwritten; ${LANDING_KEPT}`,
      { commits: res.commits, files: res.files ?? [] },
    )
  } else {
    report(
      'project.land_failed',
      `could not land the project session's ${res.commits} commit(s) onto ${res.base}: ${res.error ?? 'unknown error'} — ${LANDING_KEPT}`,
      { commits: res.commits, error: res.error ?? null },
    )
  }
}

/** Mark a session `ended`; returns the updated row, or null if unknown. */
export function markSessionEnded(ctx: AppCtx, id: string): SessionRow | null {
  const existing = getSessionRow(ctx, id)
  if (!existing) return null
  // Stop the docs watcher: the terminal it was watching for is gone, and on
  // Windows a live watcher holds a lock on the directory, which would block the
  // worktree removal that follows a merge. Every end path funnels here — PTY
  // exit, the Stop hook, boot reconciliation — so this is the one place it must
  // happen.
  if (existing.featureId) stopDocsWatch(existing.featureId)
  // The ending is timestamped here and nowhere else, so "ended 2h ago" is a
  // recorded fact rather than the row's age wearing an end-time label. The end
  // paths can each fire on a row that is already ended (a SessionEnd hook
  // arriving after the host's stop, say), and re-stamping would walk the time
  // forward every time — so only a row that was running is stamped. A thread
  // keeps its row for life, so each of its process's stops is stamped anew.
  ctx.db
    .update(sessions)
    .set({ status: 'ended', ...(existing.status !== 'ended' || existing.endedAt === undefined ? { endedAt: Date.now() } : {}) })
    .where(eq(sessions.id, id))
    .run()
  return getSessionRow(ctx, id)
}

/**
 * The thread of `kind` on a feature or a project that the launchers reopen,
 * whatever its process is doing (chat-as-web-components): a thread keeps one
 * row for life. It is the newest row holding a conversation (an agent-side id
 * or a log) — a terminal-era feature has rows newer than its conversation that
 * never went live — else the newest row.
 */
export function newestThread(
  ctx: AppCtx,
  scope: { featureId: string } | { projectId: string },
  kind: SessionKind,
): SessionRow | null {
  const rows = 'featureId' in scope ? featureSessions(ctx, scope.featureId, [kind]) : projectSessions(ctx, scope.projectId, kind)
  return rows.find((row) => row.ccSessionId || hasThreadLog(row.id)) ?? rows[0] ?? null
}

/** Record the errand a thread was (re)opened on, which its brief and guards read. */
export function setThreadPurpose(
  ctx: AppCtx,
  id: string,
  purpose: SessionPurpose | null,
  purposeData: MergeBranchPair | null = null,
): void {
  ctx.db.update(sessions).set({ purpose, purposeData }).where(eq(sessions.id, id)).run()
}

/**
 * The open (launching or live) project-scoped session of this kind, if any —
 * what the UI needs to decide between "open a preparation conversation" and
 * "show the one already running".
 */
export function activeProjectSession(
  ctx: AppCtx,
  projectId: string,
  kind: SessionKind,
): SessionRow | null {
  const row = ctx.db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.projectId, projectId),
        eq(sessions.kind, kind),
        inArray(sessions.status, ['launching', 'live']),
      ),
    )
    .orderBy(desc(sql`rowid`))
    .limit(1)
    .get()
  return row ? rowToSession(row) : null
}

/**
 * Every project-scoped session of this kind, newest first — the rows behind
 * `project.conversations`, which groups them into conversations and decides
 * which are worth showing. Unlike {@link activeProjectSession} this filters on
 * nothing else: an ended conversation is still a conversation you can read back.
 * Ordered by the implicit sqlite `rowid`, which is insertion order and so agrees
 * with `createdAt` for every row that has one.
 */
export function projectSessions(
  ctx: AppCtx,
  projectId: string,
  kind: SessionKind,
): SessionRow[] {
  return ctx.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.projectId, projectId), eq(sessions.kind, kind)))
    .orderBy(desc(sql`rowid`))
    .all()
    .map(rowToSession)
}

/**
 * The feature's sessions of the given kinds, newest first — the feature-side
 * twin of {@link projectSessions}, behind the feature's session switcher.
 */
export function featureSessions(
  ctx: AppCtx,
  featureId: string,
  kinds: SessionKind[],
): SessionRow[] {
  return ctx.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.featureId, featureId), inArray(sessions.kind, kinds)))
    .orderBy(desc(sql`rowid`))
    .all()
    .map(rowToSession)
}

/** Cache a conversation's derived name on its row (see `services/conversations.ts`). */
export function setSessionTitle(ctx: AppCtx, id: string, title: string): void {
  ctx.db.update(sessions).set({ title }).where(eq(sessions.id, id)).run()
}

/**
 * Forget a cached name, putting the row back to deriving one on every read.
 * The list clears the titles it can tell were derived by an older, worse
 * derivation (see `junkTitle` in `services/conversations.ts`).
 */
export function clearSessionTitle(ctx: AppCtx, id: string): void {
  ctx.db.update(sessions).set({ title: null }).where(eq(sessions.id, id)).run()
}

/**
 * Whether this project has ever had a project-scoped conversation of this kind
 * run to an end. The signal behind "has the human done preparation" — a session
 * they opened and closed is one they sat through, whatever it managed to record.
 */
export function hasCompletedProjectSession(
  ctx: AppCtx,
  projectId: string,
  kind: SessionKind,
): boolean {
  return (
    ctx.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.projectId, projectId),
          eq(sessions.kind, kind),
          eq(sessions.status, 'ended'),
        ),
      )
      .limit(1)
      .get() !== undefined
  )
}

// --- re-entry cap -----------------------------------------------------------

/**
 * How large a restored transcript may get before a relaunch stops resuming it
 * and starts FRESH instead, in bytes and in re-entries.
 *
 * There is no compaction, pruning or summarization anywhere in runcastle, so
 * `--resume` is monotonic: every re-entry restores everything the last one had
 * plus whatever it added. Measured on real transcripts, a `prepare`
 * conversation resumed across four session rows reached 1.42 MB / 464 turns /
 * ~91k tokens; an ordinary revisit resumes into ~35k. At eight to ten re-entries
 * that approaches the window, at which point Claude Code's own auto-compact
 * fires and silently drops exactly the decision prose the revisit came back for
 * — the worst possible moment to lose it, because nothing says it happened.
 *
 * Starting fresh is not a loss, and the revisit prompt already says why: "The
 * docs are the artifact — later phases read them, never the transcripts." This
 * makes it the fallback for every kind.
 *
 * Both are overridable per-install by env var, and either set to `0` disables
 * that half of the check.
 */
export const RESUME_MAX_TRANSCRIPT_BYTES = envInt('RUNCASTLE_RESUME_MAX_BYTES', 1_000_000)
export const RESUME_MAX_REENTRIES = envInt('RUNCASTLE_RESUME_MAX_REENTRIES', 8)

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** Why a relaunch declined to resume; `null` means resuming is fine. */
export interface ResumeCapVerdict {
  reason: 'transcript-size' | 'reentry-count'
  /** Human-readable, used verbatim in the timeline event. */
  detail: string
  bytes?: number
  reentries: number
}

/**
 * Should this relaunch skip `--resume` and start fresh? Pure over the two
 * measurements so it is testable without a transcript on disk; the caller does
 * the `statSync` (see {@link transcriptBytes}).
 */
export function resumeCapExceeded(input: {
  bytes?: number
  reentries: number
}): ResumeCapVerdict | null {
  const { bytes, reentries } = input
  if (
    RESUME_MAX_TRANSCRIPT_BYTES > 0 &&
    bytes !== undefined &&
    bytes > RESUME_MAX_TRANSCRIPT_BYTES
  ) {
    return {
      reason: 'transcript-size',
      detail: `the previous conversation's transcript is ${Math.round(bytes / 1024)} KB, over the ${Math.round(
        RESUME_MAX_TRANSCRIPT_BYTES / 1024,
      )} KB re-entry cap`,
      bytes,
      reentries,
    }
  }
  if (RESUME_MAX_REENTRIES > 0 && reentries >= RESUME_MAX_REENTRIES) {
    return {
      reason: 'reentry-count',
      detail: `this conversation has already been re-entered ${reentries}× (cap ${RESUME_MAX_REENTRIES})`,
      reentries,
    }
  }
  return null
}

/**
 * Why `prior`'s conversation can no longer be resumed from `worktreePath`, or
 * undefined when it still can (`the-feature-lead-runs-rounds` decision 28).
 * Resuming a conversation whose transcript is gone exits at once — Claude Code
 * cleans up old transcripts, and looks a conversation up under the launch
 * directory, so one recorded in another worktree is as good as gone. A row
 * that recorded no transcript path cannot be judged and is resumed, the way
 * {@link transcriptBytes} fails open.
 */
export function resumeGoneReason(prior: SessionRow, worktreePath: string): string | undefined {
  if (prior.transcriptPath && !existsSync(prior.transcriptPath)) return 'its transcript is no longer on disk'
  if (
    (prior.runtime ?? DEFAULT_RUNTIME) === 'claude-code' &&
    prior.worktreePath &&
    samePathKey(prior.worktreePath) !== samePathKey(worktreePath)
  ) {
    return 'it was recorded in another worktree'
  }
  return undefined
}

/** A path as a comparable key: resolved, and case-folded where the filesystem ignores case (Windows). */
function samePathKey(path: string): string {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** Size of a session's transcript on disk, or undefined when there isn't one. */
export function transcriptBytes(session: SessionRow | null): number | undefined {
  if (!session?.transcriptPath) return undefined
  try {
    return statSync(session.transcriptPath).size
  } catch {
    // A transcript we cannot stat is one we cannot judge — fail OPEN and resume,
    // for the guard's usual reason: this must never be able to wedge a launch.
    return undefined
  }
}

/**
 * How many times this conversation has already been picked back up: the count of
 * ENDED rows carrying a Claude Code id in the same scope, which is one row per
 * terminal that ever went live on it. An approximation on purpose — the exact
 * resume chain is not recorded anywhere — but it is the number that grows every
 * time a human clicks Resume, which is precisely the thing being capped.
 */
export function reentryCount(
  ctx: AppCtx,
  scope: { featureId?: string; projectId?: string; kind?: SessionKind },
): number {
  const where = [
    eq(sessions.status, 'ended'),
    isNotNull(sessions.ccSessionId),
    ...(scope.featureId ? [eq(sessions.featureId, scope.featureId)] : []),
    ...(scope.projectId ? [eq(sessions.projectId, scope.projectId)] : []),
    ...(scope.kind ? [eq(sessions.kind, scope.kind)] : []),
  ]
  const row = ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(sessions)
    .where(and(...where))
    .get()
  return row?.n ?? 0
}

/**
 * The most recently created live session across all features — the MCP
 * session-identity fallback when the `X-Runcastle-Session` header is absent.
 *
 * M1 LIMITATION: there is at most one live ideation session at a time, so
 * "singleton live session" is acceptable. Ordered by the implicit sqlite
 * `rowid` (insertion order) since `sessions` carries no timestamp column.
 */
export function mostRecentLiveSession(ctx: AppCtx): SessionRow | null {
  const row = ctx.db
    .select()
    .from(sessions)
    .where(eq(sessions.status, 'live'))
    .orderBy(desc(sql`rowid`))
    .limit(1)
    .get()
  return row ? rowToSession(row) : null
}
