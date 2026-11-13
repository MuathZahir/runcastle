import type { Feature } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { featureWorking, needOf } from './feature-need'

/**
 * The status words a feature's chats are told each turn, at session start and in
 * the kickoff (tickets-and-review-are-tools-not-phases decision 7): the same
 * words the feature page's status line uses (needs-you decision 15).
 */
export function featureStateLine(ctx: AppCtx, feature: Feature): string {
  if (feature.status === 'shipped') return 'Merged'
  const need = needOf(ctx, feature)
  if (need) return `Needs you · ${need.why}`
  return feature.status === 'active' && featureWorking(ctx, feature.id) ? 'Working' : 'Idle'
}
