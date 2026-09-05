import { describe, expect, it } from 'vitest'
import {
  NOTE_SCREENSHOT_ROUTE,
  NOTE_SCREENSHOT_UPLOAD_ROUTE,
  REVIEW_ARTIFACTS_ROUTE,
  REVIEW_WALKTHROUGH_ROUTE,
  noteScreenshotUploadUrl,
  noteScreenshotUrl,
  reviewArtifactsUrl,
  reviewWalkthroughUrl,
} from '../src/routes'

/**
 * The screenshot URL is a three-party contract — the Hono route that serves it,
 * the service that stamps it onto a note, and the browser that uploads to it —
 * with no generated client holding the three in step. These are the literals
 * all three must agree on.
 */
describe('note screenshot URLs', () => {
  const noteId = 'note_abc123'

  it('builds the URLs the browser fetches and posts to', () => {
    expect(noteScreenshotUrl(noteId)).toBe('/api/reviews/note/note_abc123/screenshot.png')
    expect(noteScreenshotUploadUrl(noteId)).toBe('/api/reviews/note/note_abc123/screenshot')
  })

  it('mounts the route patterns the URLs are filled from', () => {
    expect(NOTE_SCREENSHOT_UPLOAD_ROUTE).toBe('/note/:noteId/screenshot')
    expect(NOTE_SCREENSHOT_ROUTE).toBe('/note/:noteId/screenshot.png')
  })

  it('escapes an id that is not URL-safe, rather than emitting it raw', () => {
    expect(noteScreenshotUrl('a/b')).toBe('/api/reviews/note/a%2Fb/screenshot.png')
  })
})

describe('review artifact URLs', () => {
  it('builds listing and walkthrough URLs from their route patterns', () => {
    expect(REVIEW_ARTIFACTS_ROUTE).toBe('/:featureId')
    expect(REVIEW_WALKTHROUGH_ROUTE).toBe('/ticket/:ticketId/walkthrough.webm')
    expect(reviewArtifactsUrl('feature/a')).toBe('/api/reviews/feature%2Fa')
    expect(reviewWalkthroughUrl('ticket/a')).toBe('/api/reviews/ticket/ticket%2Fa/walkthrough.webm')
  })
})
