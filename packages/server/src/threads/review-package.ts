import type { Feature, SessionRow } from '@runcastle/core'
import { reviewSawLogPath } from '@runcastle/core/paths'
import { existsSync } from 'node:fs'
import type { AppCtx } from '../db/types'
import { GateError } from '../errors'
import { newestThread } from '../launcher/sessions'
import { emit } from '../services/events'
import { projectForFeature } from '../services/repo'
import { finishedReviewPasses, reviewPackage, reviewShots } from '../services/review-package'
import { appendThreadEvent } from './log'
import { seedFromTranscript } from './read'

/**
 * A review pass's package in a thread. The event names the ticket and nothing
 * else: the card reads the pass through its route, so a thread never holds a
 * second copy of what the review left.
 */

/** Runcastle's own act when a pass ends, so a package never depends on an agent remembering. */
export function postReviewPackage(ctx: AppCtx, featureId: string, ticketId: string): void {
  // A pass refused before it started kept nothing and has nothing to show.
  if (!existsSync(reviewSawLogPath(ticketId))) return
  const chat = newestThread(ctx, { featureId }, 'chat')
  if (!chat) return
  seedFromTranscript(ctx, chat.id)
  appendThreadEvent(chat.id, { type: 'review_package', ticketId })
  emit(ctx, featureId, { type: 'review.package_posted', message: 'review package posted in the chat', ticketId })
}

/** Show a feature's package in this thread: the newest pass with pictures, else the newest pass. */
export async function showReviewPackage(
  ctx: AppCtx,
  session: SessionRow,
  feature: Feature,
): Promise<{ shown: true; seq: number | null; workerId?: string; screenshots: number; commitsSince: number | null }> {
  const passes = finishedReviewPasses(ctx, feature.id)
  const pictured = reviewShots(ctx, feature.id)[0]
  const pass =
    passes.find((p) => (p.seq === null ? p.id === pictured?.workerId : p.seq === pictured?.seq)) ?? passes[0]
  if (!pass) throw new GateError(`${feature.slug} has had no review, so it has no review package.`)
  seedFromTranscript(ctx, session.id)
  appendThreadEvent(session.id, { type: 'review_package', ticketId: pass.id })
  const pack = await reviewPackage(ctx, pass, feature, projectForFeature(ctx, feature).repoPath)
  return {
    shown: true,
    seq: pass.seq,
    ...(pass.seq === null ? { workerId: pass.id } : {}),
    screenshots: pictured?.shots.length ?? 0,
    commitsSince: pack.commitsSince,
  }
}
