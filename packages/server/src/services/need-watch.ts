import { FEATURE_NEEDS_YOU, type Need, type NeedsYouData } from '@runcastle/core'
import { isNotNull } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { sessions } from '../db/schema'
import { getSessionRow } from '../launcher/sessions'
import { threadNeed } from '../threads/read'
import { subscribeLive } from './bus'
import { emitForSession, getEventRow } from './events'
import { SESSION_WAIT_CLEARED, SESSION_WAITING } from './waits'

/**
 * The one event pings hang off (needs-you-is-the-agent-s-call decision 14):
 * `feature.needs_you` `{ why, threadId, by, featureId }`, emitted once each time
 * a chat — a lead, a worker, an orchestrator chat — enters a need it was not
 * in: its agent's wait, or an open permission prompt or question box. Never on
 * a re-read, an unchanged need, or at boot.
 */
export { FEATURE_NEEDS_YOU }

/**
 * How long a chat's changes settle before its need is read again: a service
 * call can write more than once, and a need read between two of its writes
 * would ping for a state that never really stood.
 */
export const NEED_SETTLE_MS = 50

export interface NeedWatch {
  /** Detach from the bus. */
  stop(): void
}

/** What tells one need from the next: a replaced wait is a new one, even in the same words. */
const keyOf = (need: Need | null): string | null => (need ? `${need.since}\u0000${need.why}` : null)

/**
 * Watch every chat's need: re-read a chat after its wait is set or cleared, or
 * after a turn change in it (an ask opening or answered moves a `turn` signal),
 * and emit {@link FEATURE_NEEDS_YOU} when it enters a need. What each chat was
 * last seen needing is kept in memory, seeded at start without emitting.
 * Called once at boot.
 */
export function startNeedWatch(ctx: AppCtx): NeedWatch {
  const seen = new Map<string, string | null>()
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined

  function check(sessionId: string): void {
    try {
      const row = getSessionRow(ctx, sessionId)
      const need = row ? threadNeed(ctx, row) : null
      const key = keyOf(need)
      const prev = seen.get(sessionId) ?? null
      seen.set(sessionId, key)
      if (!row || !need || key === prev) return
      const data: NeedsYouData = { why: need.why, threadId: need.threadId, by: need.by, featureId: row.featureId ?? null }
      emitForSession(ctx, row, { type: FEATURE_NEEDS_YOU, message: `needs you · ${need.why}`, data })
    } catch (err) {
      console.error('need watch failed', err)
    }
  }

  function flush(): void {
    timer = undefined
    const ids = [...pending]
    pending.clear()
    for (const id of ids) check(id)
  }

  function schedule(sessionId: string): void {
    pending.add(sessionId)
    if (timer) return
    timer = setTimeout(flush, NEED_SETTLE_MS)
    timer.unref?.()
  }

  const waiting = ctx.db.select({ id: sessions.id }).from(sessions).where(isNotNull(sessions.waitWhy)).all()
  for (const { id } of waiting) {
    try {
      const row = getSessionRow(ctx, id)
      seen.set(id, keyOf(row ? threadNeed(ctx, row) : null))
    } catch (err) {
      console.error('need watch failed', err)
    }
  }

  const unsubscribe = subscribeLive((signal) => {
    if (signal.kind === 'turn') return schedule(signal.sessionId)
    if (signal.kind !== 'event') return
    const event = getEventRow(ctx, signal.eventId)
    if (!event || (event.type !== SESSION_WAITING && event.type !== SESSION_WAIT_CLEARED)) return
    const sessionId = (event.data as { sessionId?: unknown } | null)?.sessionId
    if (typeof sessionId === 'string') schedule(sessionId)
  })

  return {
    stop() {
      unsubscribe()
      if (timer) clearTimeout(timer)
      pending.clear()
      seen.clear()
    },
  }
}
