import type { SessionKind, SessionRow } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
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
 * A converge session additionally gets its kickoff line injected into the PTY:
 * its job is fully specified upfront, so it should not idle at the prompt.
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
    if (existing.kind === 'converge') scheduleConvergeKickoff(ctx, existing)
  }
  return getSessionRow(ctx, id)
}

/**
 * Converge kickoff (kind=converge only). The session-start hook fires while the
 * claude TUI is still mounting, so writing immediately can race the input
 * handler; a short fixed delay after `live` is the pragmatic point where the
 * prompt is interactive (any trust/permission dialog blocks startup BEFORE the
 * SessionStart hook, so it cannot swallow this input). Best-effort by design:
 * no PTY entry (window mode / tests) or an exited PTY is a silent no-op, and the
 * worst failure mode is the line sitting unsubmitted in the input box.
 *
 * Submission is a SEPARATE `\r` keystroke, written a beat after the text
 * (E2E regression: text+`\r` in ONE write left the line sitting unsubmitted in
 * the input box — claude's TUI treats a carriage return arriving in the same
 * chunk as pasted text, not as the Enter key; it must land as its own
 * keystroke after the text has settled).
 */
export const CONVERGE_KICKOFF_DELAY_MS = 1500
export const CONVERGE_KICKOFF_SUBMIT_DELAY_MS = 350
export const CONVERGE_KICKOFF_LINE =
  'Proceed with your task: invoke /runcastle:converge and drive spec then tickets ' +
  'from map.md + decisions.md, per your system prompt.'

/**
 * The two-write kickoff sequence (exported seam, unit-tested): write the prompt
 * TEXT alone, then — after `submitDelayMs` — write `\r` as its own keystroke.
 * `alive()` is consulted before each write so a PTY that exits between the two
 * never gets a stray carriage return; `onSubmitted` fires only after the `\r`
 * actually went out (the launcher emits `session.kickoff` there — the event
 * means "submitted", not "typed").
 */
export function writeKickoffSequence(
  io: {
    write: (data: string) => void
    alive: () => boolean
    onSubmitted?: () => void
  },
  submitDelayMs: number = CONVERGE_KICKOFF_SUBMIT_DELAY_MS,
): void {
  if (!io.alive()) return
  io.write(CONVERGE_KICKOFF_LINE)
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

function scheduleConvergeKickoff(ctx: AppCtx, session: SessionRow): void {
  const timer = setTimeout(() => {
    try {
      writeKickoffSequence({
        write: (data) => ptyRegistry().get(session.id)?.pty.write(data),
        alive: () => {
          const entry = ptyRegistry().get(session.id)
          return !!entry && !entry.exited
        },
        onSubmitted: () => {
          emit(ctx, session.featureId, {
            type: 'session.kickoff',
            message: 'converge session kicked off automatically',
            data: { sessionId: session.id },
          })
        },
      })
    } catch {
      // best-effort — a failed kickoff just leaves the user to type
    }
  }, CONVERGE_KICKOFF_DELAY_MS)
  // Never hold the process open for a kickoff (tests, shutdown).
  timer.unref?.()
}

/** Mark a session `ended`; returns the updated row, or null if unknown. */
export function markSessionEnded(ctx: AppCtx, id: string): SessionRow | null {
  const existing = getSessionRow(ctx, id)
  if (!existing) return null
  ctx.db.update(sessions).set({ status: 'ended' }).where(eq(sessions.id, id)).run()
  return getSessionRow(ctx, id)
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
