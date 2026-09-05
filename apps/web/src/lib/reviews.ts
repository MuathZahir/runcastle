import { noteScreenshotUploadUrl, reviewArtifactsUrl } from '@runcastle/core'
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
  lap: number
  passKind: 'review' | 'verification'
  reviewedCommit: string | null
  completedAt: number | null
  landedSince: number
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
      const res = await fetch(reviewArtifactsUrl(featureId))
      if (!res.ok) throw new Error(`review artifacts: ${res.status}`)
      return (await res.json()) as ReviewArtifacts[]
    },
  })
}

/**
 * Attach an annotated frame to the note it was drawn for. Raw PNG bytes as the
 * body — the shape the route expects, and the one thing the tRPC surface beside
 * it cannot carry.
 *
 * The URL comes from core, which is also where the route that serves it and the
 * service that stamps `screenshotUrl` onto the note get theirs — so the
 * thumbnail in the notes list is literally a GET of what was posted here.
 */
/**
 * A picture the human pasted or attached, as the PNG bytes the note-screenshot
 * route accepts (decision 7a).
 *
 * The route checks the PNG signature — everything downstream of it, from the
 * `.png` on disk to the `.runcastle-attachments/<id>.png` a promoted ticket
 * hands its burner, assumes that one format — so a screenshot pasted as JPEG or
 * WebP is re-encoded here rather than rejected at the door. A PNG passes through
 * untouched: re-encoding one would cost a decode for no change.
 */
export async function toPngBlob(image: Blob): Promise<Blob> {
  if (image.type === 'image/png') return image

  const bitmap = await createImageBitmap(image)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('this browser offered no 2d canvas to convert the image with')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('the browser produced no PNG from that image'))
    }, 'image/png')
  })
}

export async function uploadScreenshot(noteId: string, png: Blob): Promise<void> {
  const res = await fetch(noteScreenshotUploadUrl(noteId), {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: png,
  })
  if (!res.ok) throw new Error(`screenshot upload: ${res.status}`)
}
