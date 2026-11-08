import type { Feature } from '@runcastle/core'
import { and, count, eq, inArray } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { workers } from '../db/schema'

/**
 * The status words a feature's chats are told each turn, at session start and in
 * the kickoff (tickets-and-review-are-tools-not-phases decision 7): the same
 * fact-based words the feature page's status line uses, read off what is
 * happening rather than off a stored phase.
 */
export function featureStateLine(ctx: AppCtx, feature: Feature): string {
  if (feature.status === 'shipped') return 'Merged'
  const atWork =
    ctx.db
      .select({ n: count() })
      .from(workers)
      .where(and(eq(workers.featureId, feature.id), inArray(workers.status, ['working', 'queued'])))
      .get()?.n ?? 0
  if (atWork > 0) return `Working · ${atWork} worker${atWork === 1 ? '' : 's'} at work`
  if (feature.waitingReason) return `Waiting for you · ${feature.waitingReason}`
  return 'Talking with you'
}
