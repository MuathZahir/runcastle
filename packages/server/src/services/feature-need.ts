import { type Feature, type Need, newestNeed } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { featureSessions } from '../launcher/sessions'
import { leadState, openAskNeed, type LeadState } from '../threads/read'
import { agentHost } from '../threads/types'
import { hasActiveRun } from './repo'
import { waitsByFeature } from './waits'

/**
 * What a feature needs from the human (needs-you-is-the-agent-s-call decision
 * 12): the newest of its lead's wait, its workers' waits, and an open
 * question box in any of its threads. `feature.list` and
 * `feature.get` carry it; the needs watcher (`need-watch.ts`) pings per chat.
 */

/** The threads whose asks count toward a feature's need. */
const ASK_KINDS = ['chat', 'side', 'worker'] as const

/**
 * The feature's one need, or null. Only a started feature can need anything.
 * `waits` is the feature's standing session waits when the caller already read
 * them (a list reads every feature's at once); read here when absent.
 */
/**
 * Whether something works on the feature (needs-you decision 15): its lead is
 * mid-turn or its background work runs, a round runs, or a worker of it has a
 * turn running. A worker that is only `working` by status, with no turn, does
 * not count: it reads idle.
 */
export function featureWorking(ctx: AppCtx, featureId: string, lead: LeadState = leadState(ctx, featureId)): boolean {
  if (lead.working || hasActiveRun(ctx, featureId)) return true
  const host = agentHost(ctx)
  return featureSessions(ctx, featureId, ['worker']).some((row) => host.isRunning(row.id) && !row.awaitingInput)
}

export function needOf(ctx: AppCtx, feature: Feature, waits?: readonly Need[]): Need | null {
  if (feature.status !== 'active') return null
  const own = waits ?? waitsByFeature(ctx, [feature.id]).get(feature.id) ?? []
  const asks = featureSessions(ctx, feature.id, [...ASK_KINDS]).map((row) => openAskNeed(ctx, row.id))
  return newestNeed([...own, ...asks])
}
