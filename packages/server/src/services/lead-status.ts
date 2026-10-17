import { eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { features } from '../db/schema'
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
 * line shows. The next human message or round dispatch clears it.
 */
export function setWaiting(ctx: AppCtx, featureId: string, why: string | null): void {
  const reason = why?.trim() || null
  ctx.db.update(features).set({ waitingReason: reason }).where(eq(features.id, featureId)).run()
  emit(ctx, featureId, {
    type: 'feature.waiting',
    message: reason ? `waiting for you · ${reason}` : 'no longer waiting for you',
    data: { why: reason },
  })
}

/**
 * A human message reached the lead: their chat turn, Send to agent, or the
 * orchestrator's `send_to_feature`. Stamps the mark the Ask-mode dispatch check
 * reads, and clears the waiting reason — the human has acted.
 */
export function markHumanMessage(ctx: AppCtx, featureId: string): void {
  const at = Date.now()
  ctx.db
    .update(features)
    .set({ lastHumanMessageAt: at, waitingReason: null })
    .where(eq(features.id, featureId))
    .run()
  emit(ctx, featureId, {
    type: 'lead.human_message',
    message: 'a human message reached the agent',
    data: { at },
  })
}
