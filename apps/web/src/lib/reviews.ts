import { useQuery, type UseQueryResult } from '@tanstack/react-query'

/**
 * The review agent's artifacts, over plain HTTP (improve-workflow seam 6).
 *
 * The only non-tRPC query in the app, and deliberately so: the walkthrough is
 * media, streamed with range requests from `GET /api/reviews/ticket/:id/…`, so
 * its listing was built as a plain route beside it rather than dragged onto the
 * tRPC surface (decisions #8). Same origin — Vite proxies `/api` to the server
 * — so this needs no base URL, exactly like the tRPC link beside it.
 */

/** Mirrors `ReviewTicketArtifacts` in packages/server/src/routes/reviews.ts. */
export interface ReviewArtifacts {
  ticketId: string
  seq: number
  hasVideo: boolean
  /** Where to stream the recording, or null when there is none to stream. */
  videoUrl: string | null
}

/**
 * The listing's query-key prefix. Named here and imported by `lib/live.ts`, so
 * the stream's invalidation and this query can never drift apart into a card
 * that only refreshes on reload.
 */
export const REVIEW_ARTIFACTS_KEY = 'review-artifacts'

/**
 * What this feature's reviews left behind. No `refetchInterval`: the SSE feed
 * invalidates this key like every other live surface, and a video listing that
 * changes once per burn has nothing to poll for.
 */
export function useReviewArtifacts(featureId: string): UseQueryResult<ReviewArtifacts[], Error> {
  return useQuery({
    queryKey: [REVIEW_ARTIFACTS_KEY, featureId],
    queryFn: async (): Promise<ReviewArtifacts[]> => {
      const res = await fetch(`/api/reviews/${encodeURIComponent(featureId)}`)
      if (!res.ok) throw new Error(`review artifacts: ${res.status}`)
      return (await res.json()) as ReviewArtifacts[]
    },
  })
}
