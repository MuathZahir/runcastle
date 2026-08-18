import { trpc } from '../trpc'
import { mergeConflictKickoff, type MergeConflictState } from './feature-ui'
import { useToast } from './toast'

/**
 * Launching the agent that resolves a standing merge conflict — the one
 * implementation behind both surfaces that offer it (the next-step bar's primary
 * and the review body's conflict card), so the two can never brief the agent
 * differently or sequence the launch differently.
 *
 * The affordance never hides now (decisions #10). When the feature already has a
 * live terminal the button performs the compound instead: end that session, then
 * launch the resolve one. The order is enforced HERE rather than server-side —
 * the launcher's `assertSpawnable` refuses a second live session outright, so the
 * end has to have LANDED before the launch is attempted. `endSession` marks the
 * row ended synchronously, so awaiting the mutation is enough.
 *
 * A failed end aborts the compound: the toast has already said why, and a launch
 * fired into a session that is still live would only collect a second refusal.
 */
export function useResolveConflict(featureId: string, branch: string) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const onError = (e: { message: string }): void => toast.push(e.message)
  const refresh = (): void => {
    void utils.feature.get.invalidate({ id: featureId })
    void utils.feature.list.invalidate()
    // The conflict panel and the bar's banner are both derived from the event
    // feed, so the session that is about to work on them has to land there too.
    void utils.events.invalidate()
  }

  const end = trpc.feature.endSession.useMutation({ onError })
  const launch = trpc.feature.launchSession.useMutation({ onSuccess: refresh, onError })

  return {
    pending: end.isPending || launch.isPending,
    /** `liveSessionId` set means the compound: end that terminal, then launch. */
    resolve: async (conflict: MergeConflictState, liveSessionId?: string): Promise<void> => {
      if (liveSessionId) {
        try {
          await end.mutateAsync({ sessionId: liveSessionId })
        } catch {
          return
        }
        refresh()
      }
      launch.mutate({
        featureId,
        kind: 'revisit',
        kickoffLine: mergeConflictKickoff(conflict.base, branch, conflict.files),
        // The purpose is what lets the session actually do what the kickoff asks:
        // the edit guard exempts its writes while the merge below is in progress
        // in the talk worktree, and its end is when the server checks whether the
        // merge landed and clears the conflict.
        purpose: 'resolve-conflict',
        purposeData: { mergeFrom: conflict.base, mergeInto: branch },
      })
    },
  }
}
