import type { FeatureFull } from './api'
import { useLivePoll } from './live'
import { trpc } from '../trpc'

/** A doc read: `content` stays undefined until the first read lands. */
export interface FeatureDoc {
  content: string | undefined
  loading: boolean
  failed: boolean
}

/**
 * One of a feature's docs, read by its relative path — the shared read behind
 * the artifact pane, the read-only banner's decision count and the stepper's
 * done-step tooltip. Every caller resolves the SAME `docs.read` query key, so
 * three readers of `decisions.md` cost one fetch.
 *
 * `live` keeps the poll on while the document is still being written; a frozen
 * record reads it once (decision 10).
 */
export function useFeatureDoc(
  featureId: string,
  relPath: string | undefined,
  { live = true }: { live?: boolean } = {},
): FeatureDoc {
  const poll = useLivePoll()
  const query = trpc.docs.read.useQuery(
    { featureId, relPath: relPath ?? '' },
    { enabled: !!relPath, ...(live ? { refetchInterval: poll } : {}) },
  )
  return {
    content: relPath ? query.data?.content : undefined,
    loading: !!relPath && query.isLoading,
    failed: !!relPath && !!query.error,
  }
}

/** The feature's copy of `name`, when it has been written. */
export function docPath(docs: FeatureFull['docs'], name: string): string | undefined {
  return docs.find((doc) => doc.relPath.split(/[\\/]/).pop() === name)?.relPath
}
