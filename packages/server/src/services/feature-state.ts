import type { Feature } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { listRounds } from './runs'

/**
 * The status words a feature's chats are told each turn, at session start and in
 * the kickoff (tickets-and-review-are-tools-not-phases decision 7): the same
 * fact-based words the feature page's status line uses, read off what is
 * happening rather than off a stored phase.
 */
export function featureStateLine(ctx: AppCtx, feature: Feature): string {
  if (feature.status === 'shipped') return 'Merged'
  const running = listRounds(ctx, feature.id).find((round) => round.status === 'running')
  if (running) return `Working · Round ${running.round}`
  if (feature.waitingReason) return `Waiting for you · ${feature.waitingReason}`
  return 'Talking with you'
}
