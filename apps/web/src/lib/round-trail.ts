import type { EventRow, RoundSummary } from '@runcastle/core'
import { trpc } from '../trpc'
import type { FeatureFull } from './api'
import { codeLandings, roundTrail, type RoundTrail } from './feature-ui/rounds'

/**
 * The feature's rounds and the trail built from them (decision 16): one read of
 * `feature.rounds` and one of `feature.readyDeclarations`, with the lead's code
 * landings off the event feed the caller already holds. `refetchInterval` is
 * the caller's live poll, or false on a history view, where nothing moves
 * without a push.
 */
export function useRoundTrail(
  full: Pick<FeatureFull, 'feature' | 'tickets' | 'runs'>,
  events: readonly EventRow[],
  refetchInterval: number | false,
): { rounds: RoundSummary[]; trail: RoundTrail<FeatureFull['tickets'][number]> } {
  const featureId = full.feature.id
  const roundsQ = trpc.feature.rounds.useQuery({ featureId }, { refetchInterval })
  const declarationsQ = trpc.feature.readyDeclarations.useQuery({ featureId }, { refetchInterval })
  const rounds = (roundsQ.data ?? []) as RoundSummary[]
  return {
    rounds,
    trail: roundTrail(rounds, full.tickets, declarationsQ.data ?? [], codeLandings(events), full.runs),
  }
}
