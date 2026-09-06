import { statSync } from 'node:fs'
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
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { sessions } from '../db/schema'
import { ptyRegistry } from '../pty/registry'
import { stopDocsWatch } from '../services/docs-watch'
import { emit, emitForSession, emitProject } from '../services/events'
import {
  landProjectBranch,
  PROJECT_BRANCH,
  resolveSessionBranch,
  type ProjectLandResult,
} from '../services/git'
import { promoteLastSession } from '../services/waypoints'
import { getFeatureRow, getProjectById, rowToSession } from '../services/repo'
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
} & ({ featureId: string; projectId?: never } | { projectId: string; featureId?: never })

/** Insert a fresh session row in the `launching` state; returns it (with id). */
export function createSessionRow(ctx: AppCtx, input: CreateSessionInput): SessionRow {
  const row = ctx.db
    .insert(sessions)
    .values({
      id: newId('sess'),
      featureId: input.featureId ?? null,
      projectId: input.projectId ?? null,
      // A feature session belongs to the lap its feature is on; a project-scoped
      // `prepare` session has no feature to take one from (ADR-0010 §7).
      lap: input.featureId ? getFeatureRow(ctx, input.featureId).lap : 1,
      kind: input.kind,
      purpose: input.purpose ?? null,
      purposeData: input.purposeData ?? null,
      ccSessionId: null,
      transcriptPath: null,
      status: 'launching',
      worktreePath: input.worktreePath,
      model: input.model?.id ?? null,
      runtime: input.model?.runtime ?? null,
      // Named lazily from the transcript once there is one (see
      // `services/conversations.ts`) — a row born a millisecond ago has
      // nothing to be called yet.
      title: null,
      createdAt: Date.now(),
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
 * the launcher refuses to spawn while any of these exist, so the guard cannot be
 * dodged by resolving a waypoint (which clears its claim but not the terminal)
 * and cannot lie about an AFK run (runs never create session rows).
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

function setAwaitingInput(ctx: AppCtx, id: string, awaitingInput: boolean): void {
  ctx.db.update(sessions).set({ awaitingInput }).where(eq(sessions.id, id)).run()
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
 * Going live is the moment a session becomes RESUMABLE, so this is also where a
 * waypoint claim's `lastSessionId` is promoted (never at claim time — a resume
 * attempt that dies before this point must not clobber the previous good id).
 * Every session kind additionally gets its kickoff line injected into the PTY:
 * each kind has a defined opening move, so none should idle at the prompt waiting
 * for the human to type "Hi".
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
  const firstTimeLive = existing.status !== 'live'
  if (firstTimeLive) {
    promoteLastSession(ctx, id)
    scheduleKickoff(ctx, existing)
  }
  return getSessionRow(ctx, id)
}

/**
 * Kickoff (every session kind). The session-start hook fires while the claude
 * TUI is still mounting, so writing immediately can race the input handler; a
 * short fixed delay after `live` is the pragmatic point where the prompt is
 * interactive (any trust/permission dialog blocks startup BEFORE the SessionStart
 * hook, so it cannot swallow this input). Best-effort by design: no PTY entry
 * (spawn:false smoke / tests) or an exited PTY is a silent no-op, and the worst
 * failure mode is the line sitting unsubmitted in the input box.
 *
 * Submission is a SEPARATE `\r` keystroke, written a beat after the text
 * (E2E regression: text+`\r` in ONE write left the line sitting unsubmitted in
 * the input box — claude's TUI treats a carriage return arriving in the same
 * chunk as pasted text, not as the Enter key; it must land as its own
 * keystroke after the text has settled).
 */
export const KICKOFF_DELAY_MS = 1500
export const KICKOFF_SUBMIT_DELAY_MS = 350

/**
 * How long a written kickoff has to come back as a real `UserPromptSubmit` hook
 * before we assume the keystrokes were swallowed and type it again, and how many
 * times we are willing to type it in total.
 *
 * Writing into a PTY is fire-and-forget: whatever is on screen eats the text.
 * Claude Code can be showing a startup dialog when our timer fires — the
 * "resume from a summary?" chooser on `--resume`, a trust prompt, an update
 * notice — and then the briefing is simply gone, with the terminal looking
 * perfectly healthy. Confirmation closes that loop: the ONLY proof a kickoff
 * landed is Claude telling us it received the prompt.
 */
export const KICKOFF_CONFIRM_MS = 12_000
export const KICKOFF_MAX_ATTEMPTS = 3

/**
 * `Ctrl-U` (kill-line), written before every retry. If the first attempt did
 * reach the input box but never submitted, re-typing on top of it would produce
 * one garbled double-length prompt; clearing first makes a retry idempotent.
 */
export const CLEAR_INPUT = '\x15'

/**
 * How long after spawning a terminal we wait for `SessionStart` before telling
 * the human something is wrong. The hook fires within a second or two of a
 * healthy launch, so silence past this means the session is blocked on
 * something only they can see (a dialog waiting for an answer, a login prompt),
 * or the hook itself is broken. Either way the kickoff cannot be delivered
 * blind — we surface it and offer the manual Send.
 */
export const SESSION_READY_TIMEOUT_MS = 25_000

/**
 * The lap briefing (SPEC §15.2) — the `revisit` kickoff override a Rethink
 * passes, and the whole of a lap's ceremony: one terminal digests what the test
 * drive taught, amends the docs, emits the lap's tickets and advances itself
 * back to the human's Burn click (ADR-0010 §5).
 *
 * Both inputs it is told to read are genuinely optional and the line says so
 * out loud: `test-notes.md` is created lazily on the first note (a feature that
 * never captured one has no file at all), and `## Later laps` only exists when
 * the slicing conversation parked scope there. An agent that treats a missing
 * file as a broken environment stalls the lap on its first move.
 */
export function lapKickoff(lap: number): string {
  return (
    `Proceed with your task: invoke the /runcastle:revisit skill for LAP ${lap} REVIEW ITERATION. ` +
    `Call get_feature_context, then read this feature's test-notes.md (the "## Lap ${lap - 1}" ` +
    'section — what the last drive surfaced) and the "## Later laps" section of its spec.md. ' +
    'EITHER MAY NOT EXIST YET; that is normal, not an error — say so and carry on from what I ' +
    'tell you. Interview me about what the test drive taught: what was wrong, what was missing, ' +
    'what I want next. Write what we settle on into decisions.md and amend spec.md for this lap ' +
    '(pruning anything you promote out of "## Later laps"), then call emit_tickets for this ' +
    `lap's work. Finish in THIS session: complete_phase through ideation → spec → tickets, then ` +
    'tell me to review the cards and click Burn.'
  )
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

/** What a launch is going to type into its terminal, and what that implies. */
export interface KickoffPlan {
  /** The briefing to type; absent means the per-kind default line. */
  line?: string
  /**
   * The briefing IS this session's opening move (a lap briefing, a merge-conflict
   * hand-off) rather than a nudge to carry on. Such a launch must be FRESH: a
   * `--resume` shows Claude Code's "start from a summary?" chooser, which eats
   * the very keystrokes carrying the briefing (F2), and even when it survives, a
   * restored transcript argues with an instruction that means to start over.
   */
  explicit: boolean
  /** Set when this session is running a lap: which lap (see {@link lapInFlight}). */
  lap?: number
}

/**
 * Is this feature MID-LAP right now? The one question the launcher must answer
 * from FEATURE STATE rather than from what a caller happened to type.
 *
 * A lap is the front half of the pipeline run again: Rethink bumps `lap` and
 * flips the phase back to `ideation` BEFORE launching, and the lap session is
 * the only thing that will advance it out again — through `complete_phase`
 * ideation → spec → tickets, emitting that lap's tickets on the way. So a
 * feature sitting at `ideation` on lap N with no tickets AT lap N has a lap in
 * flight, whether the session that was running it is still alive or died an hour
 * ago.
 *
 * THE BUG THIS FIXES. `lap` used to be derived by comparing the kickoff line to
 * `lapKickoff(lap)` with `===`, three call frames from the renderer that
 * depended on it. That works exactly once — on the Rethink launch that passes
 * the line. If the terminal then died mid-lap, the feature was stranded: Rethink
 * refuses to run again (it requires the `review` phase, and the phase had
 * already moved to `ideation`), so the human's only door back was Revisit, which
 * passes no `kickoffLine` — string identity failed, `lap` came back `undefined`,
 * and the relaunch RESUMED the dead lap conversation while rendering "Do NOT
 * call `complete_phase` — a revisit never moves the pipeline" into a transcript
 * whose own earlier turn said to complete_phase through to tickets. The feature
 * could not be finished through the UI at all.
 *
 * Deriving it from state keeps {@link WriteArtifactsInput.lap}'s reasoning true
 * — an ordinary revisit on a lap-3 feature is NOT running a lap, because such a
 * feature is at `review` or `implementation`, not at `ideation` — while closing
 * the re-entry hole, because the state that says "mid-lap" survives the terminal
 * that was running it.
 *
 * `ticketLaps` is the set of laps this feature has tickets for. It comes from
 * the tickets the launcher already lists; no new query and no new service.
 */
export function lapInFlight(input: {
  lap: number
  phase: string
  ticketLaps: readonly number[]
}): boolean {
  return input.lap > 1 && input.phase === 'ideation' && !input.ticketLaps.includes(input.lap)
}

/**
 * Decide a launch's kickoff (exported seam — see {@link KickoffPlan}).
 *
 * Two things produce an explicit briefing. An override passed by the caller (the
 * review Iterate click passes `lapKickoff`), and a lap that is in flight — which
 * covers both the lap-N grill (the ideation next-step's "Start/Resume grill
 * session" on a feature past lap 1 used to open with the generic ideate line and
 * no lap framing at all, F4) and the re-entry after a lap terminal died.
 *
 * `lap` on the plan is set from {@link lapInFlight}, never from what the line
 * happens to equal — that is the whole fix. It drives the artifacts, so a lap
 * relaunched by any door renders the lap prompt and the lap's `complete_phase`
 * licence.
 */
export function planKickoff(input: {
  kind: SessionKind
  lap: number
  kickoffLine?: string
  /** Is a lap in flight on this feature? Defaults false (no lap framing). */
  lapInFlight?: boolean
}): KickoffPlan {
  const running = input.lapInFlight === true
  const lapBriefing = input.lap > 1 ? lapKickoff(input.lap) : undefined
  const line = input.kickoffLine ?? (running ? lapBriefing : undefined)
  const lap = running ? input.lap : undefined
  if (!line) return { explicit: false, ...(lap !== undefined ? { lap } : {}) }
  return { line, explicit: true, ...(lap !== undefined ? { lap } : {}) }
}

/**
 * Framing prepended to the kickoff line of a RESUMED session. `--resume` restores
 * the whole conversation, so typing the bare per-kind line ("invoke /runcastle:…
 * and drive the session") reads as an instruction to start over — the agent
 * re-runs its opening move on a conversation that is already mid-flight. This
 * prefix says what actually happened (the conversation survived, the terminal
 * did not) and asks for a short re-orientation before it carries on.
 *
 * It no longer claims a CAUSE. It used to open "runcastle restarted and closed
 * the terminal", which is one of several ways a session ends and flatly untrue
 * of the commonest: the human clicking Revisit on a conversation that closed
 * cleanly. A resumed agent that is told something false about the last five
 * minutes has no way to tell which other statements to trust.
 *
 * Only applied when the caller passed no explicit `kickoffLine`: a per-purpose
 * briefing (merge-conflict resolution, review iteration) IS the new opening move
 * and must not be reframed as "carry on with what you were doing".
 */
export const RESUME_KICKOFF_PREFIX =
  'We are picking this conversation back up — the terminal was closed, but this ' +
  'conversation is intact. Do NOT start over: tell me in one or two lines where we ' +
  'left off and what is next, then carry on. Your original instruction was: '

/**
 * The kickoff line typed into a resumed session, quoting the ORIGINAL
 * instruction of the conversation being resumed (see
 * {@link RESUME_KICKOFF_PREFIX}).
 *
 * `resumedKind` is the kind of the session row whose transcript is coming back,
 * which is not always the kind of the row being created. A revisit resumes
 * `mostRecentResumableSession` with NO kind filter — deliberately, because
 * "revisit" means "pick up the last thing we talked about", whatever that was —
 * so quoting the revisit line told an ideation conversation that its original
 * instruction had been "invoke the /runcastle:revisit skill", which it
 * demonstrably was not, with the real opening turn visible directly above in the
 * restored transcript. Quote what was actually said; fall back to the new kind's
 * line only when the resumed row's kind is unknown.
 *
 * `runtime` is the runtime that conversation ran on — the skill invocation is
 * spelled per runtime, so the quote has to match the spelling it was given.
 */
export function resumeKickoffLine(
  kind: SessionKind,
  resumedKind?: SessionKind,
  runtime: AgentRuntime = DEFAULT_RUNTIME,
): string {
  return RESUME_KICKOFF_PREFIX + runtimeAdapterFor(runtime).kickoffLine(resumedKind ?? kind)
}

/**
 * Pending per-session kickoff overrides, keyed by session id. `launchSession`
 * stashes an override here BEFORE spawning; `scheduleKickoff` consumes it when
 * the session goes live (kickoff is scheduled from `markSessionLive`, decoupled
 * from launch by the SessionStart hook, so the override must survive the gap).
 *
 * An entry OUTLIVES its consumption — it is the durable record of what this
 * terminal was opened to say, which `resendKickoff` needs verbatim (F6) — and is
 * dropped when the session ends, so the map never grows unbounded.
 */
const pendingKickoffOverrides = new Map<string, string>()

/** Register a kickoff line that replaces the per-kind default for one session. */
export function setKickoffOverride(sessionId: string, line: string): void {
  pendingKickoffOverrides.set(sessionId, line)
}

/**
 * The two-write kickoff sequence (exported seam, unit-tested): write the prompt
 * TEXT alone, then — after `submitDelayMs` — write `\r` as its own keystroke.
 * `alive()` is consulted before each write so a PTY that exits between the two
 * never gets a stray carriage return; `onSubmitted` fires only after the `\r`
 * actually went out (the launcher emits `session.kickoff` there — the event
 * means "submitted", not "typed").
 */
export function writeKickoffSequence(
  line: string,
  io: {
    write: (data: string) => void
    alive: () => boolean
    onSubmitted?: () => void
  },
  submitDelayMs: number = KICKOFF_SUBMIT_DELAY_MS,
): void {
  if (!io.alive()) return
  io.write(line)
  const submit = setTimeout(() => {
    try {
      if (!io.alive()) return
      io.write('\r')
      io.onSubmitted?.()
    } catch {
      // best-effort — a PTY that died between the two writes just misses Enter
    }
  }, submitDelayMs)
  // Never hold the process open for a kickoff (tests, shutdown).
  submit.unref?.()
}

/**
 * In-flight kickoff delivery for one session. Held in memory only: the PTY it
 * types into dies with the process, so a delivery cannot outlive the server that
 * owns it. The `line` is kept after the delivery settles so "Send briefing"
 * (`resendKickoff`) can re-type the exact same text on demand.
 */
interface KickoffDelivery {
  line: string
  attempts: number
  confirmed: boolean
  /**
   * We have typed the briefing into the PTY at least once. Until then no
   * submitted prompt can be a reaction to it — see {@link noteKickoffPrompt}.
   */
  written: boolean
  /** No further automatic attempts: confirmed, superseded, or out of attempts. */
  settled: boolean
  timers: Set<ReturnType<typeof setTimeout>>
}

const deliveries = new Map<string, KickoffDelivery>()

/** Public view of a session's kickoff delivery (tRPC/tests); null when unknown. */
export function kickoffDeliveryFor(
  sessionId: string,
): { line: string; attempts: number; confirmed: boolean; settled: boolean } | null {
  const d = deliveries.get(sessionId)
  return d ? { line: d.line, attempts: d.attempts, confirmed: d.confirmed, settled: d.settled } : null
}

function stopTimers(d: KickoffDelivery): void {
  for (const t of d.timers) clearTimeout(t)
  d.timers.clear()
}

/** Drop all kickoff state for a session (session end — the PTY is gone). */
export function forgetKickoff(sessionId: string): void {
  const d = deliveries.get(sessionId)
  if (d) stopTimers(d)
  deliveries.delete(sessionId)
  pendingKickoffOverrides.delete(sessionId)
}

function ptyIo(sessionId: string): { write: (data: string) => void; alive: () => boolean } {
  return {
    write: (data) => ptyRegistry().get(sessionId)?.pty.write(data),
    alive: () => {
      const entry = ptyRegistry().get(sessionId)
      return !!entry && !entry.exited
    },
  }
}

function track(d: KickoffDelivery, timer: ReturnType<typeof setTimeout>): void {
  // Never hold the process open for a kickoff (tests, shutdown).
  timer.unref?.()
  d.timers.add(timer)
}

/**
 * Type the kickoff line into the PTY after `delayMs`, then wait for Claude Code
 * to confirm it via the `UserPromptSubmit` hook (`noteKickoffPrompt`). No
 * confirmation inside {@link KICKOFF_CONFIRM_MS} means the keystrokes went
 * somewhere else — a startup dialog, a TUI that was not accepting input yet — so
 * we clear the input line and type it again, up to {@link KICKOFF_MAX_ATTEMPTS}.
 * The last failure is announced (`session.kickoff_undelivered`) rather than
 * swallowed: an undelivered briefing is exactly the state that used to look like
 * a working terminal that inexplicably did nothing.
 */
function attemptKickoff(
  ctx: AppCtx,
  session: SessionRow,
  d: KickoffDelivery,
  delayMs: number,
  clearFirst = false,
): void {
  track(
    d,
    setTimeout(() => {
      if (d.settled) return
      const io = ptyIo(session.id)
      // No PTY (spawn:false smoke, or the terminal already exited) — nothing to
      // deliver into and nothing to report; the exit path owns that story.
      if (!io.alive()) {
        d.settled = true
        return
      }
      d.attempts += 1
      d.written = true
      const attempt = d.attempts
      try {
        // Anything but the very first automatic write may be landing on top of a
        // half-typed earlier attempt that never submitted; kill the line first so
        // we never build one doubled prompt out of two good ones.
        if (clearFirst) io.write(CLEAR_INPUT)
        writeKickoffSequence(d.line, {
          write: io.write,
          alive: io.alive,
          onSubmitted: () =>
            emitForSession(ctx, session, {
              type: 'session.kickoff',
              message:
                attempt === 1
                  ? `${session.kind} session kicked off automatically`
                  : `${session.kind} kickoff re-sent (attempt ${attempt}) — the first was never acknowledged`,
              data: { sessionId: session.id, kind: session.kind, attempt },
            }),
        })
      } catch {
        // best-effort — a failed write still gets a confirmation window below
      }
      armConfirmation(ctx, session, d)
    }, delayMs),
  )
}

function armConfirmation(ctx: AppCtx, session: SessionRow, d: KickoffDelivery): void {
  track(
    d,
    setTimeout(() => {
      if (d.settled || d.confirmed) return
      if (d.attempts < KICKOFF_MAX_ATTEMPTS && ptyIo(session.id).alive()) {
        attemptKickoff(ctx, session, d, 0, true)
        return
      }
      settleUndelivered(ctx, session, d, 'unacknowledged')
    }, KICKOFF_CONFIRM_MS),
  )
}

function settleUndelivered(
  ctx: AppCtx,
  session: SessionRow,
  d: KickoffDelivery,
  reason: 'unacknowledged' | 'superseded',
): void {
  d.settled = true
  stopTimers(d)
  emitForSession(ctx, session, {
    type: 'session.kickoff_undelivered',
    message:
      reason === 'superseded'
        ? `the ${session.kind} briefing was never delivered — you typed first, so runcastle stopped injecting it`
        : `the ${session.kind} briefing was typed ${d.attempts}× but Claude Code never acknowledged it — send it again from the session strip`,
    data: { sessionId: session.id, kind: session.kind, reason, attempts: d.attempts, line: d.line },
  })
}

/**
 * A prompt was submitted in this session (`UserPromptSubmit` hook). If it is our
 * kickoff, the delivery is confirmed and retries stop. If it is anything else,
 * the human is already driving — stop injecting (typing into a conversation
 * mid-thought is worse than not briefing at all) and record the briefing as
 * undelivered so the UI can offer it as a one-click send.
 *
 * "Anything else" only counts once we have actually typed (`written`). A prompt
 * that arrives BEFORE our first write cannot be a human reacting to the briefing
 * — it is the session's own opening traffic (a resumed conversation replaying,
 * a queued prompt) — and treating it as "the human typed first" is how the
 * retry budget used to destroy itself: the briefing was swallowed by a startup
 * dialog, and attempts 2 and 3 were cancelled before the first even landed (F2).
 */
export function noteKickoffPrompt(ctx: AppCtx, sessionId: string, prompt?: string): void {
  const d = deliveries.get(sessionId)
  if (!d || d.confirmed) return
  const session = getSessionRow(ctx, sessionId)
  if (!session) return
  if (!d.written) return
  if (promptMatchesKickoff(d.line, prompt)) {
    d.confirmed = true
    d.settled = true
    stopTimers(d)
    return
  }
  if (d.settled) return
  settleUndelivered(ctx, session, d, 'superseded')
}

/**
 * Does a submitted prompt look like our kickoff line? Compared on collapsed
 * whitespace over the first {@link MATCH_PREFIX} characters: the TUI can wrap,
 * re-flow or trim what it echoes, and a startup dialog can eat a leading
 * fragment, so an exact equality check would report false failures and re-inject
 * a briefing the agent is already working on.
 */
const MATCH_PREFIX = 40
export function promptMatchesKickoff(line: string, prompt?: string): boolean {
  if (!prompt) return false
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const want = norm(line)
  const got = norm(prompt)
  if (!want || !got) return false
  return got.includes(want.slice(0, MATCH_PREFIX))
}

/**
 * Re-send a session's kickoff line on demand (the "Send briefing" escape hatch).
 * Resets the retry budget, so a human who has just dismissed whatever dialog ate
 * the first attempt gets the same automatic confirm-and-retry behaviour.
 */
export function resendKickoff(ctx: AppCtx, sessionId: string): { line: string } {
  const session = getSessionRow(ctx, sessionId)
  if (!session) throw new Error(`unknown session ${sessionId}`)
  if (session.status === 'ended') throw new Error('that session has ended — open a new terminal')
  if (!ptyIo(sessionId).alive()) throw new Error('the terminal for that session is no longer running')

  const existing = deliveries.get(sessionId)
  const d: KickoffDelivery = existing ?? {
    // No delivery record yet (the session has not gone live, so the kickoff was
    // never scheduled). The override outlives its consumption precisely for this
    // moment: without it, "Send briefing" on a lap terminal silently downgraded
    // the lap briefing to the generic per-kind line (F6).
    line: kickoffLineFor(session.kind, pendingKickoffOverrides.get(sessionId), session.runtime),
    attempts: 0,
    confirmed: false,
    written: false,
    settled: false,
    timers: new Set(),
  }
  stopTimers(d)
  d.attempts = 0
  d.confirmed = false
  d.settled = false
  deliveries.set(sessionId, d)
  // Always clear first: a manual send is the human's answer to a terminal that
  // may well have a stray fragment of the swallowed attempt sitting in its box.
  attemptKickoff(ctx, session, d, 0, true)
  return { line: d.line }
}

/**
 * Watchdog armed when a terminal spawns: if Claude Code has not reported
 * `SessionStart` by {@link SESSION_READY_TIMEOUT_MS}, the session is stuck on
 * something only the human can see (the `--resume` "start from a summary?"
 * chooser, a trust prompt, a login). We deliberately do NOT type into it blind —
 * answering an unseen dialog with a paragraph of prompt text is how briefings got
 * eaten in the first place, and a stray Enter could accept a permission
 * question. We say so instead, and the UI offers Send briefing once the human
 * has cleared whatever is on screen.
 */
export function armSessionReadyWatchdog(ctx: AppCtx, session: SessionRow): void {
  const timer = setTimeout(() => {
    const row = getSessionRow(ctx, session.id)
    if (!row || row.status !== 'launching') return
    if (!ptyIo(session.id).alive()) return
    emitForSession(ctx, session, {
      type: 'session.not_ready',
      message: `the ${session.kind} terminal is open but Claude Code has not reported ready — check it for a prompt or dialog waiting on you, then send the briefing`,
      data: { sessionId: session.id, kind: session.kind },
    })
  }, SESSION_READY_TIMEOUT_MS)
  timer.unref?.()
}

function scheduleKickoff(ctx: AppCtx, session: SessionRow): void {
  // The override is NOT dropped here. It is the only record of what this
  // terminal was opened to say, and `resendKickoff` needs it verbatim long
  // after go-live; `forgetKickoff` clears it when the session ends (F6).
  const line = kickoffLineFor(session.kind, pendingKickoffOverrides.get(session.id), session.runtime)
  const existing = deliveries.get(session.id)
  if (existing) stopTimers(existing)
  const d: KickoffDelivery = {
    line,
    attempts: 0,
    confirmed: false,
    written: false,
    settled: false,
    timers: new Set(),
  }
  deliveries.set(session.id, d)
  attemptKickoff(ctx, session, d, KICKOFF_DELAY_MS)
}

/**
 * Session ids whose landing has already been kicked off. A project terminal
 * closed from the UI runs BOTH end paths — `endSession` kills the PTY, whose
 * exit then reaches `handlePtyExit` — and two concurrent merges of the same
 * branch is not a race worth having. Ids are kept for the life of the process:
 * an ended session never lands twice, and the set grows by one entry per closed
 * project terminal.
 */
const landedProjectSessions = new Set<string>()

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
  if (landedProjectSessions.has(session.id)) return
  landedProjectSessions.add(session.id)
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
  void landing.finally(() => inFlightLandings.delete(landing))
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
  // Drop any un-consumed override and stop an in-flight delivery: the PTY it
  // types into is gone, and a pending retry must never outlive its session.
  forgetKickoff(id)
  // Same reasoning for the docs watcher, and one reason more: on Windows a live
  // watcher holds a lock on the directory, which would block the worktree
  // removal that follows a merge. Every end path funnels here — PTY exit, the
  // Stop hook, boot reconciliation — so this is the one place it must happen.
  if (existing.featureId) stopDocsWatch(existing.featureId)
  // The ending is timestamped here and nowhere else, so "ended 2h ago" is a
  // recorded fact rather than the row's age wearing an end-time label. Those
  // same three end paths can each fire on a row that is already ended (a Stop
  // hook arriving after the PTY exit, say), and re-stamping would walk the time
  // forward every time — so the first ending stands.
  ctx.db
    .update(sessions)
    .set({ status: 'ended', ...(existing.endedAt === undefined ? { endedAt: Date.now() } : {}) })
    .where(eq(sessions.id, id))
    .run()
  return getSessionRow(ctx, id)
}

/**
 * The feature's most recently ENDED session that recorded a Claude Code session
 * id — the conversation a relaunched terminal `--resume`s. Live sessions are
 * excluded (the one-live-session guard refuses a second terminal while one
 * exists) and sessions that never went live have no cc id, so they can't match.
 * Ordered by the implicit sqlite `rowid` (insertion order — `sessions` has no
 * timestamp).
 *
 * `kind` narrows the search to conversations of that kind, which is what every
 * ordinary relaunch wants: reopening the grill must land back in the grill
 * conversation, not in whatever qa session happened to run afterwards. A
 * kind=revisit launch omits it deliberately — revisit means "resume the last
 * thing we talked about", whatever kind that was.
 */
export function mostRecentResumableSession(
  ctx: AppCtx,
  featureId: string,
  kind?: SessionKind,
): SessionRow | null {
  const row = ctx.db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.featureId, featureId),
        eq(sessions.status, 'ended'),
        isNotNull(sessions.ccSessionId),
        ...(kind ? [eq(sessions.kind, kind)] : []),
      ),
    )
    .orderBy(desc(sql`rowid`))
    .limit(1)
    .get()
  return row ? rowToSession(row) : null
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

/**
 * The project-scoped twin of {@link mostRecentResumableSession}: the last ended
 * conversation of this kind for a project, so reopening a preparation terminal
 * continues it instead of making the human re-explain their database.
 *
 * Keyed on `project_id` rather than `feature_id`, which is the column a
 * project-scoped session actually has — the feature-keyed query would never
 * match one of these rows (NULL never equals anything), so it needs its own.
 */
export function mostRecentResumableProjectSession(
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
        eq(sessions.status, 'ended'),
        isNotNull(sessions.ccSessionId),
      ),
    )
    .orderBy(desc(sql`rowid`))
    .limit(1)
    .get()
  return row ? rowToSession(row) : null
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
 * docs are the artifact — later phases read them, never the transcripts."
 * `converge` is built on that premise deliberately. This makes it the fallback
 * for every kind rather than a property of one.
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
