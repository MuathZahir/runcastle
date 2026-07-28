import type { SessionKind, SessionRow } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { sessions } from '../db/schema'
import { ptyRegistry } from '../pty/registry'
import { emit, emitForSession } from '../services/events'
import { promoteLastSession } from '../services/waypoints'
import { rowToSession } from '../services/repo'

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
      ccSessionId: null,
      transcriptPath: null,
      status: 'launching',
      worktreePath: input.worktreePath,
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

/** The converge kickoff line, unchanged (E2E-proven — kept named for clarity). */
export const CONVERGE_KICKOFF_LINE =
  'Proceed with your task: invoke /runcastle:converge and drive spec then tickets ' +
  'from map.md + decisions.md, per your system prompt.'

/**
 * The per-kind kickoff line typed into a freshly-live session so no session
 * starts dead. Each line names the same opening skill its appended system prompt
 * does (`renderSystemPrompt` in artifacts.ts) so the injected line and the brief
 * agree on the first move. A later ticket's per-purpose revisit briefings arrive
 * via the `launchSession` override (see `setKickoffOverride`), not this table.
 */
export const KICKOFF_LINES: Record<SessionKind, string> = {
  ideation:
    'Proceed with your task: invoke the /runcastle:ideate skill and drive the ideation session.',
  qa:
    'Proceed with your task: invoke the /runcastle:qa skill and answer questions from the ' +
    'docs and code — do not advance phases or emit tickets.',
  waypoint:
    'Proceed with your task: invoke the /runcastle:waypoint skill and work your assigned ' +
    'waypoint to a resolution.',
  converge: CONVERGE_KICKOFF_LINE,
  revisit:
    'Proceed with your task: invoke the /runcastle:revisit skill and work through what the ' +
    'human brings up.',
  // No skill: the preparation brief is the whole task, and it arrives as the
  // appended system prompt (renderPreparePrompt). The line only has to make the
  // agent open its mouth — a headless run already measured what it could, so
  // the useful first move is naming the gap, not re-deriving the repo.
  prepare:
    'Proceed with your task: work through the unestablished preparation fields with the human. ' +
    'Start by telling them which fields are still open and what you need from them for each; ' +
    'ask before running anything that touches their database or services.',
}

/** The kickoff line for a session: an explicit override wins, else the per-kind default. */
export function kickoffLineFor(kind: SessionKind, override?: string): string {
  return override ?? KICKOFF_LINES[kind]
}

/**
 * Framing prepended to the kickoff line of a RESUMED session. `--resume` restores
 * the whole conversation, so typing the bare per-kind line ("invoke /runcastle:…
 * and drive the session") reads as an instruction to start over — the agent
 * re-runs its opening move on a conversation that is already mid-flight. This
 * prefix says what actually happened (the terminal died, the conversation did
 * not) and asks for a short re-orientation before it carries on.
 *
 * Only applied when the caller passed no explicit `kickoffLine`: a per-purpose
 * briefing (merge-conflict resolution, review iteration) IS the new opening move
 * and must not be reframed as "carry on with what you were doing".
 */
export const RESUME_KICKOFF_PREFIX =
  'We are picking this conversation back up — runcastle restarted and closed the terminal, ' +
  'but this conversation is intact. Do NOT start over: tell me in one or two lines where we ' +
  'left off and what is next, then carry on. Your original instruction was: '

/** The kickoff line typed into a resumed session of `kind` (see {@link RESUME_KICKOFF_PREFIX}). */
export function resumeKickoffLine(kind: SessionKind): string {
  return RESUME_KICKOFF_PREFIX + KICKOFF_LINES[kind]
}

/**
 * Pending per-session kickoff overrides, keyed by session id. `launchSession`
 * stashes an override here BEFORE spawning; `scheduleKickoff` consumes it when
 * the session goes live (kickoff is scheduled from `markSessionLive`, decoupled
 * from launch by the SessionStart hook, so the override must survive the gap).
 * Cleared on consume and on session end so the map never grows unbounded.
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
 */
export function noteKickoffPrompt(ctx: AppCtx, sessionId: string, prompt?: string): void {
  const d = deliveries.get(sessionId)
  if (!d || d.confirmed) return
  const session = getSessionRow(ctx, sessionId)
  if (!session) return
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
    // The override is normally consumed at go-live; falling back to the per-kind
    // default keeps the button useful for a session whose record was dropped.
    line: kickoffLineFor(session.kind, pendingKickoffOverrides.get(sessionId)),
    attempts: 0,
    confirmed: false,
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
  const line = kickoffLineFor(session.kind, pendingKickoffOverrides.get(session.id))
  pendingKickoffOverrides.delete(session.id)
  const existing = deliveries.get(session.id)
  if (existing) stopTimers(existing)
  const d: KickoffDelivery = { line, attempts: 0, confirmed: false, settled: false, timers: new Set() }
  deliveries.set(session.id, d)
  attemptKickoff(ctx, session, d, KICKOFF_DELAY_MS)
}

/** Mark a session `ended`; returns the updated row, or null if unknown. */
export function markSessionEnded(ctx: AppCtx, id: string): SessionRow | null {
  const existing = getSessionRow(ctx, id)
  if (!existing) return null
  // Drop any un-consumed override and stop an in-flight delivery: the PTY it
  // types into is gone, and a pending retry must never outlive its session.
  forgetKickoff(id)
  ctx.db.update(sessions).set({ status: 'ended' }).where(eq(sessions.id, id)).run()
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
