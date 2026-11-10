import type { FeatureFinish } from '@runcastle/core'
import { trpc } from '../trpc'
import { useToast } from './toast'

/**
 * The owner control's and the row menu's one mutation (every-feature-has-one-owner
 * decisions 11, 21): `you` takes the feature, `show` / `merge` give it to its
 * chat. The server's `feature.owner_changed` event refreshes every reader over
 * the stream; the success refetch covers a stream that is down.
 */
export function useSetOwner(): (featureId: string, choice: FeatureFinish) => void {
  const utils = trpc.useUtils()
  const toast = useToast()
  const m = trpc.feature.setOwner.useMutation({
    onSuccess: (_res, vars) => {
      void utils.feature.get.invalidate({ id: vars.featureId })
      void utils.feature.list.invalidate()
    },
    onError: (e) => toast.push(e.message),
  })
  return (featureId, choice) => m.mutate({ featureId, choice })
}
