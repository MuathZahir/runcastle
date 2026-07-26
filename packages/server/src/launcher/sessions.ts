import type { SessionKind, SessionRow } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { sessions } from '../db/schema'
import { ptyRegistry } from '../pty/registry'
import { emit } from '../services/events'
import { promoteLastSession } from '../services/waypoints'
import { rowToSession } from '../services/repo'

/**
 * Session-row persistence for the launcher + hook receiver + MCP server. There
 * is no A1 service for session mutation (sessions are entirely a B1 concern), so
 * these helpers own the `sessions` table via the drizzle query builder (never
 * raw SQL). They perform no event emission — callers (launcher.ts, hooks.ts)
 * emit the lifecycle events so the timeline messages stay meaningful.
 */

export interface CreateSessionInput {
  featureId: string
  kind: SessionKind
  worktreePath: string
}

/** Insert a fresh session row in the `launching` state; returns it (with id). */
export function createSessionRow(ctx: AppCtx, input: CreateSessionInput): SessionRow {
  const row = ctx.db
    .insert(sessions)
    .values({
      id: newId('sess'),
      featureId: input.featureId,
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

function scheduleKickoff(ctx: AppCtx, session: SessionRow): void {
  const line = kickoffLineFor(session.kind, pendingKickoffOverrides.get(session.id))
  pendingKickoffOverrides.delete(session.id)
  const timer = setTimeout(() => {
    try {
      writeKickoffSequence(line, {
        write: (data) => ptyRegistry().get(session.id)?.pty.write(data),
        alive: () => {
          const entry = ptyRegistry().get(session.id)
          return !!entry && !entry.exited
        },
        onSubmitted: () => {
          emit(ctx, session.featureId, {
            type: 'session.kickoff',
            message: `${session.kind} session kicked off automatically`,
            data: { sessionId: session.id, kind: session.kind },
          })
        },
      })
    } catch {
      // best-effort — a failed kickoff just leaves the user to type
    }
  }, KICKOFF_DELAY_MS)
  // Never hold the process open for a kickoff (tests, shutdown).
  timer.unref?.()
}

/** Mark a session `ended`; returns the updated row, or null if unknown. */
export function markSessionEnded(ctx: AppCtx, id: string): SessionRow | null {
  const existing = getSessionRow(ctx, id)
  if (!existing) return null
  // Drop any un-consumed kickoff override (session ended before going live).
  pendingKickoffOverrides.delete(id)
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
