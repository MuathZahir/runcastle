import { and, desc, eq, sql } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { events, features } from '../db/schema'
import { emit } from './events'

/**
 * The mark the feature lead's loop reads off the feature row
 * (`the-feature-lead-runs-rounds` spec, "Settings and data"): when a human
 * message last reached the lead. What the lead waits on the human for lives on
 * its session row (`waits.ts`).
 *
 * Its own module rather than `features.ts` because delivery sets it too
 * (`lead-delivery.ts`), and delivery is reached from the run finalizer — which
 * `features.ts` itself imports.
 */

/**
 * A human message reached the lead: their chat turn, Send to agent, or the
 * orchestrator's `send_to_feature`. Stamps the mark the after-Stop dispatch
 * check reads and clears the stopped mark. It does not clear what the lead
 * waits on: only the human writing in its chat does (needs-you decision 7).
 */
export function markHumanMessage(ctx: AppCtx, featureId: string, opts: { typed?: boolean } = {}): void {
  const at = Date.now()
  ctx.db.update(features).set({ lastHumanMessageAt: at, stoppedAt: null }).where(eq(features.id, featureId)).run()
  emit(ctx, featureId, {
    type: 'lead.human_message',
    message: 'a human message reached the agent',
    data: { at, ...(opts.typed ? { typed: true } : {}) },
  })
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
