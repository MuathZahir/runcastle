/**
 * The HTTP paths runcastle's non-tRPC surface answers on, spelled once.
 *
 * These routes carry media — a walkthrough the player scrubs, a screenshot an
 * `<img>` fetches — so they live outside tRPC and have no generated client to
 * keep the two ends in step. Three parties have to agree on the same string:
 * the Hono route that serves it, the service that stamps the URL onto a wire
 * type, and the browser code that fetches or uploads to it. Hand-spelling it in
 * each was the lap-1 arrangement, held together by a round-trip test that
 * reported drift as a 404.
 *
 * So: the route PATTERN is the single spelling, and the URL builders fill it.
 * This module is pure string building with no IO, which is why it belongs in
 * the isomorphic barrel rather than beside the filesystem paths in `paths.ts` —
 * the browser imports from here.
 */

/** Where the reviews routes are mounted (server `index.ts`). */
export const REVIEWS_BASE = '/api/reviews'

/** GET listing of every review pass belonging to one feature. */
export const REVIEW_ARTIFACTS_ROUTE = '/:featureId'

/** GET route for one review pass's walkthrough recording. */
export const REVIEW_WALKTHROUGH_ROUTE = '/ticket/:ticketId/walkthrough.webm'

export function reviewArtifactsUrl(featureId: string): string {
  return `${REVIEWS_BASE}${REVIEW_ARTIFACTS_ROUTE.replace(':featureId', encodeURIComponent(featureId))}`
}

export function reviewWalkthroughUrl(ticketId: string): string {
  return `${REVIEWS_BASE}${REVIEW_WALKTHROUGH_ROUTE.replace(':ticketId', encodeURIComponent(ticketId))}`
}

/**
 * POST target for one note's annotated frame, relative to {@link REVIEWS_BASE}
 * — raw PNG bytes as the body.
 */
export const NOTE_SCREENSHOT_UPLOAD_ROUTE = '/note/:noteId/screenshot'

/**
 * GET route for that same frame. The `.png` suffix is what makes the URL look
 * like the image it is to a browser (and to anything that saves it); the upload
 * is an action rather than a resource, so it goes without.
 */
export const NOTE_SCREENSHOT_ROUTE = `${NOTE_SCREENSHOT_UPLOAD_ROUTE}.png`

/**
 * A `:noteId` pattern with a real id in it, absolute from the site root.
 * Encoded because this is a URL, not a path: ids are nanoids today (URL-safe by
 * construction), so this is insurance rather than a live escape.
 */
function fillNoteId(route: string, noteId: string): string {
  return `${REVIEWS_BASE}${route.replace(':noteId', encodeURIComponent(noteId))}`
}

/**
 * Where the browser fetches a note's annotated frame from — the value the
 * server stamps onto `TestNote.screenshotUrl`, and the `src` of the thumbnail
 * in the notes list.
 */
export function noteScreenshotUrl(noteId: string): string {
  return fillNoteId(NOTE_SCREENSHOT_ROUTE, noteId)
}

/** Where the annotation player POSTs the PNG it just baked. */
export function noteScreenshotUploadUrl(noteId: string): string {
  return fillNoteId(NOTE_SCREENSHOT_UPLOAD_ROUTE, noteId)
}
