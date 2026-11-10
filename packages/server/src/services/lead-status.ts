import type { WaitingKind } from '@runcastle/core'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { events, features } from '../db/schema'
import { emit } from './events'

/**
 * The two marks the feature lead's loop reads off the feature row
 * (`the-feature-lead-runs-rounds` spec, "Settings and data"): why the feature
 * waits on the human, and when a human message last reached the lead.
 *
 * Their own module rather than `features.ts` because delivery sets them too
 * (`lead-delivery.ts`), and delivery is reached from the run finalizer — which
 * `features.ts` itself imports.
 */

/**
 * Set (or, with `null`, clear) the "Waiting for you · <why>" reason the status
 * line shows, with the kind of wait it is. The next human message or round
 * dispatch clears both.
 */
export function setWaiting(ctx: AppCtx, featureId: string, why: string | null, kind?: WaitingKind): void {
  const reason = why?.trim() || null
  // A reason sent with no kind is an answer (decision 2); a cleared reason takes its kind with it.
  const waitingKind = reason ? (kind ?? 'answer') : null
  ctx.db.update(features).set({ waitingReason: reason, waitingKind }).where(eq(features.id, featureId)).run()
  emit(ctx, featureId, {
    type: 'feature.waiting',
    message: reason ? `waiting for you · ${reason}` : 'no longer waiting for you',
    data: { why: reason, kind: waitingKind },
  })
}

/**
 * A human message reached the lead: their chat turn, Send to agent, or the
 * orchestrator's `send_to_feature`. Stamps the mark the after-Stop dispatch
 * check reads, and clears the stopped mark and the waiting reason — the human
 * has acted.
 */
export function markHumanMessage(ctx: AppCtx, featureId: string, opts: { typed?: boolean } = {}): void {
  const at = Date.now()
  ctx.db
    .update(features)
    .set({ lastHumanMessageAt: at, stoppedAt: null, waitingReason: null, waitingKind: null })
    .where(eq(features.id, featureId))
    .run()
  emit(ctx, featureId, {
    type: 'lead.human_message',
    message: 'a human message reached the agent',
    data: { at, ...(opts.typed ? { typed: true } : {}) },
  })
  // The human, or the orchestrator's send_to_feature, has answered the handback.
  clearHandback(ctx, featureId, 'message')
}

/** The event that records an outstanding handback's end. */
export const HANDBACK_CLEARED = 'feature.handback_cleared'

/** What ended a handback (the-status-tells-the-truth decision 7). */
export type HandbackEnd = 'message' | 'orchestrator' | 'hold' | 'closed'

/**
 * Record the lead's outstanding handback on its feature
 * (the-status-tells-the-truth decision 5): when, and its summary. A newer one
 * replaces it. The caller emits `lead.handed_back`, which says so.
 */
export function setHandback(ctx: AppCtx, featureId: string, summary: string, at = Date.now()): void {
  ctx.db.update(features).set({ handbackAt: at, handbackSummary: summary }).where(eq(features.id, featureId)).run()
}

/**
 * End the feature's outstanding handback (decision 7), saying why on its
 * timeline. Nothing happens, and nothing is emitted, when none stands.
 */
export function clearHandback(ctx: AppCtx, featureId: string, cause: HandbackEnd): void {
  const row = ctx.db.select({ at: features.handbackAt }).from(features).where(eq(features.id, featureId)).get()
  if (!row || row.at === null) return
  ctx.db.update(features).set({ handbackAt: null, handbackSummary: null }).where(eq(features.id, featureId)).run()
  emit(ctx, featureId, {
    type: HANDBACK_CLEARED,
    message: `the handback to the orchestrator is answered (${HANDBACK_END_WORDS[cause]})`,
    data: { cause, handedBackAt: row.at },
  })
}

const HANDBACK_END_WORDS: Record<HandbackEnd, string> = {
  message: 'a message reached the agent',
  orchestrator: 'the orchestrator acted on the feature',
  hold: 'the hold moved',
  closed: 'the feature is no longer active',
}

/** When the human last typed in the feature's chat, or null if they never have. */
export function humanTypedAt(ctx: AppCtx, featureId: string): number | null {
  const row = ctx.db
    .select({ ts: events.ts })
    .from(events)
    .where(
      and(
        eq(events.featureId, featureId),
        eq(events.type, 'lead.human_message'),
        sql`json_extract(${events.data}, '$.typed') = 1`,
      ),
    )
    .orderBy(desc(events.id))
    .limit(1)
    .get()
  return row?.ts ?? null
}
