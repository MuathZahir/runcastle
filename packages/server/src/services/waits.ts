import type { Need, NeedBy } from '@runcastle/core'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { sessions } from '../db/schema'
import { emitForSession } from './events'
import { rowToSession } from './repo'

/**
 * What a chat's agent waits on the human for (needs-you-is-the-agent-s-call):
 * one wait per session row — the lead's chat, each worker, each orchestrator
 * chat. Set by the agent (`wait_for_you`, `declare_ready`) or by runcastle for
 * a dead run; cleared only by the human writing in that chat (or answering its
 * ask, pressing Stop, closing the feature), or by the agent replacing or
 * withdrawing it (decision 7).
 */

/** The event a wait being set leaves on the timeline; the needs watcher pings off it. */
export const SESSION_WAITING = 'session.waiting'
/** The event a wait being cleared leaves on the timeline. */
export const SESSION_WAIT_CLEARED = 'session.wait_cleared'

/** What cleared a wait (decision 7). */
export type WaitEnd = 'human' | 'answered' | 'stopped' | 'withdrawn' | 'closed' | 'autopilot' | 'resumed'

const WAIT_END_WORDS: Record<WaitEnd, string> = {
  human: 'the human wrote in the chat',
  answered: 'the human answered its ask',
  stopped: 'the human pressed Stop',
  withdrawn: 'the agent withdrew it',
  closed: 'the work was closed',
  autopilot: 'the feature went on autopilot: its epic answers now',
  resumed: 'work started again',
}

type WaitColumns = { waitWhy: string | null; waitSince: number | null; waitBy: NeedBy | null }

function needOfColumns(id: string, row: WaitColumns): Need | null {
  return row.waitWhy !== null ? { why: row.waitWhy, since: row.waitSince ?? 0, threadId: id, by: row.waitBy ?? 'agent' } : null
}

/** The session's own wait, or null; an unknown session waits on nobody. */
export function waitOf(ctx: AppCtx, sessionId: string): Need | null {
  const row = ctx.db
    .select({ waitWhy: sessions.waitWhy, waitSince: sessions.waitSince, waitBy: sessions.waitBy })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get()
  return row ? needOfColumns(sessionId, row) : null
}

/** Every session wait standing on the given features, by feature, in one read. */
export function waitsByFeature(ctx: AppCtx, featureIds: readonly string[]): Map<string, Need[]> {
  const out = new Map<string, Need[]>()
  if (!featureIds.length) return out
  const rows = ctx.db
    .select({ id: sessions.id, featureId: sessions.featureId, waitWhy: sessions.waitWhy, waitSince: sessions.waitSince, waitBy: sessions.waitBy })
    .from(sessions)
    .where(and(isNotNull(sessions.waitWhy), inArray(sessions.featureId, [...featureIds])))
    .all()
  for (const row of rows) {
    const need = needOfColumns(row.id, row)
    if (!need || !row.featureId) continue
    out.set(row.featureId, [...(out.get(row.featureId) ?? []), need])
  }
  return out
}

/** One line: the agent's words with their line breaks folded (decision 3). */
function oneLine(why: string): string {
  return why.replace(/\s+/g, ' ').trim()
}

/**
 * Set the session's wait to `why`, replacing any it had (decision 7). Emits
 * {@link SESSION_WAITING}, which the needs watcher pings off. An empty line
 * sets nothing.
 */
export function setWait(ctx: AppCtx, sessionId: string, why: string, by: NeedBy = 'agent'): Need | null {
  const line = oneLine(why)
  if (!line) return null
  const since = Date.now()
  const row = ctx.db
    .update(sessions)
    .set({ waitWhy: line, waitSince: since, waitBy: by })
    .where(eq(sessions.id, sessionId))
    .returning()
    .get()
  if (!row) return null
  emitForSession(ctx, rowToSession(row), {
    type: SESSION_WAITING,
    message: `needs you · ${line}`,
    data: { sessionId, why: line, by },
  })
  return { why: line, since, threadId: sessionId, by }
}

/**
 * Clear the session's wait, saying why on the timeline. Nothing happens, and
 * nothing is emitted, when none stands.
 */
export function clearWait(ctx: AppCtx, sessionId: string, cause: WaitEnd): void {
  const had = waitOf(ctx, sessionId)
  if (!had) return
  const row = ctx.db
    .update(sessions)
    .set({ waitWhy: null, waitSince: null, waitBy: null })
    .where(eq(sessions.id, sessionId))
    .returning()
    .get()
  if (!row) return
  emitForSession(ctx, rowToSession(row), {
    type: SESSION_WAIT_CLEARED,
    message: `no longer needs you (${WAIT_END_WORDS[cause]})`,
    data: { sessionId, cause, why: had.why },
  })
}

/** Clear every wait on the feature's chats and workers: it was merged, archived or shelved (decision 19). */
export function clearFeatureWaits(ctx: AppCtx, featureId: string, cause: WaitEnd = 'closed'): void {
  const rows = ctx.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.featureId, featureId), isNotNull(sessions.waitWhy)))
    .all()
  for (const { id } of rows) clearWait(ctx, id, cause)
}
