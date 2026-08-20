import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import {
  NOTE_SCREENSHOT_ROUTE,
  NOTE_SCREENSHOT_UPLOAD_ROUTE,
  type TestNote,
  type Ticket,
} from '@runcastle/core'
import { annotationPath, reviewWalkthroughPath } from '@runcastle/core/paths'
import { Hono } from 'hono'
import type { AppCtx } from '../db/types'
import { NotFoundError } from '../errors'
import { getRuntimeCtx } from '../launcher/runtime'
import { attachScreenshot, getNote } from '../services/test-notes'
import { getTicket, listByFeature } from '../services/tickets'

/**
 * Review artifacts over plain HTTP (improve-workflow seam 6): the walkthrough
 * video a browser review recorded, the per-feature listing that says which
 * reviews produced one, and the annotated frames the human drew on it.
 *
 * Plain HTTP rather than tRPC because this is media — a `<video>` element asks
 * for byte ranges as the human scrubs, an `<img>` wants a URL, and tRPC's JSON
 * wire has no answer for either. The read routes emit nothing; the one mutation
 * here (a screenshot upload) delegates to the test-notes service, which emits.
 *
 * There is no database record of a recording, or of a screenshot: the file on
 * disk IS the record. That keeps a review that crashed mid-recording, or one
 * that never recorded at all, from having to be reconciled — the listing simply
 * reports what is on disk right now.
 */
const reviews = new Hono()

/** Where a review ticket's recording streams from — the mount point in `index.ts`. */
function walkthroughUrl(ticketId: string): string {
  return `/api/reviews/ticket/${ticketId}/walkthrough.webm`
}

/** One review ticket's artifacts, as the listing reports them. */
export interface ReviewTicketArtifacts {
  ticketId: string
  seq: number
  hasVideo: boolean
  /** Where to stream the recording, or `null` when there is none to stream. */
  videoUrl: string | null
}

/** Size of a regular file, or `undefined` if it is missing / not a file. */
function fileSize(path: string): number | undefined {
  try {
    const stat = statSync(path)
    return stat.isFile() ? stat.size : undefined
  } catch {
    return undefined
  }
}

/**
 * What a service lookup returned, or `undefined` when the id matched no row.
 *
 * Every route here turns a URL segment into a row before it touches the
 * filesystem, and to a browser asking for media there is only one kind of
 * absence: a 404. So the services' `NotFoundError` — the right answer to a tRPC
 * caller — is folded into `undefined` at this boundary. Any other error is
 * still a fault and propagates.
 */
function lookupOrUndefined<T>(lookup: () => T): T | undefined {
  try {
    return lookup()
  } catch (e) {
    if (e instanceof NotFoundError) return undefined
    throw e
  }
}

/**
 * The review ticket this id names, or `undefined` — an id no row matches, or one
 * belonging to an implementation ticket.
 *
 * This is the ONLY thing standing between a URL segment and the filesystem: the
 * path is then computed from the row's own id via {@link reviewWalkthroughPath},
 * so nothing a caller sent is ever joined into a path.
 */
function findReviewTicket(ctx: AppCtx, ticketId: string): Ticket | undefined {
  const ticket = lookupOrUndefined(() => getTicket(ctx, ticketId))
  return ticket?.kind === 'review' ? ticket : undefined
}

/** GET /api/reviews/:featureId — what this feature's reviews left behind. */
reviews.get('/:featureId', async (c) => {
  const ctx = await getRuntimeCtx()
  const artifacts: ReviewTicketArtifacts[] = listByFeature(ctx, c.req.param('featureId'))
    .filter((t) => t.kind === 'review')
    .map((t) => {
      const hasVideo = fileSize(reviewWalkthroughPath(t.id)) !== undefined
      return {
        ticketId: t.id,
        seq: t.seq,
        hasVideo,
        videoUrl: hasVideo ? walkthroughUrl(t.id) : null,
      }
    })
  // A feature with no review tickets — or no feature at all — has no artifacts.
  // That is a normal state (decision 8), not an error.
  return c.json(artifacts)
})

interface ByteRange {
  start: number
  end: number
}

/**
 * The single byte range a `Range` header asks for, `'unsatisfiable'` when it
 * asks past the end of the file, or `undefined` when the whole file should be
 * served.
 *
 * `undefined` is deliberately the answer to anything this route does not handle
 * — another unit, a multi-range request, a header it cannot parse — because
 * RFC 9110 lets a server ignore a Range it does not understand and reply 200.
 * Serving the whole video is always correct; only scrubbing gets slower.
 */
function parseRange(
  header: string | undefined,
  size: number,
): ByteRange | 'unsatisfiable' | undefined {
  const spec = header?.trim().match(/^bytes=(\d*)-(\d*)$/)
  if (!spec) return undefined
  const [, rawStart, rawEnd] = spec
  // Nothing to hand back out of an empty file, whatever was asked for.
  if (size === 0) return 'unsatisfiable'

  if (rawStart === '') {
    // Suffix form (`bytes=-500`): the LAST n bytes. `bytes=-0` asks for nothing.
    const suffix = Number(rawEnd)
    if (rawEnd === '' || suffix === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(rawStart)
  if (start >= size) return 'unsatisfiable'
  // An open end, or one past the last byte, means "to the end of the file".
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (end < start) return 'unsatisfiable'
  return { start, end }
}

/** The slice `[start, end]` of a file, as a web stream Hono can hand back. */
function fileStream(path: string, start: number, end: number): ReadableStream {
  return Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream
}

/**
 * GET /api/reviews/ticket/:ticketId/walkthrough.webm — the recording itself.
 *
 * Range requests are answered because the player needs them: without
 * `Accept-Ranges` + 206 the human cannot scrub, which is most of what watching a
 * walkthrough is. 404 covers every kind of absence — unknown ticket, an
 * implementation ticket, a review that recorded nothing — since to the player
 * they are the same fact: there is no video here.
 */
reviews.get('/ticket/:ticketId/walkthrough.webm', async (c) => {
  const ctx = await getRuntimeCtx()
  const ticket = findReviewTicket(ctx, c.req.param('ticketId'))
  if (!ticket) return c.notFound()

  const path = reviewWalkthroughPath(ticket.id)
  const size = fileSize(path)
  if (size === undefined) return c.notFound()

  const range = parseRange(c.req.header('range'), size)
  if (range === 'unsatisfiable') {
    return c.body(null, 416, {
      'accept-ranges': 'bytes',
      'content-range': `bytes */${size}`,
    })
  }

  const { start, end } = range ?? { start: 0, end: size - 1 }
  const headers: Record<string, string> = {
    'content-type': 'video/webm',
    'accept-ranges': 'bytes',
    'content-length': String(end - start + 1),
  }
  if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`
  // A recording that was cut off before a single byte reached disk: there is
  // nothing to stream, and `createReadStream` would be asked for [0, -1]. (Any
  // Range against it came back unsatisfiable above, so this is the plain reply.)
  if (size === 0) return c.body(null, 200, headers)
  return c.body(fileStream(path, start, end), range ? 206 : 200, headers)
})

/**
 * The note this id names, or `undefined` when no row matches. The note-keyed
 * counterpart of {@link findReviewTicket}, and it exists for the same reason:
 * the screenshot path is computed from the row's own id via
 * {@link annotationPath}, so a URL segment never reaches the filesystem.
 */
function findNote(ctx: AppCtx, noteId: string): TestNote | undefined {
  return lookupOrUndefined(() => getNote(ctx, noteId))
}

/** The 8-byte PNG signature every PNG file starts with (RFC 2083 §3.1). */
const PNG_MAGIC = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function isPng(bytes: Uint8Array): boolean {
  return bytes.length > PNG_MAGIC.length && PNG_MAGIC.every((byte, i) => bytes[i] === byte)
}

/**
 * POST /api/reviews/note/:noteId/screenshot — the annotated frame, as PNG bytes
 * in the request body.
 *
 * The body is raw bytes rather than multipart: the player has exactly one blob
 * from `canvas.toBlob`, and a form envelope around a single file buys nothing.
 * The signature check is what keeps the GET below honest — it answers
 * `image/png` unconditionally, so it must never have been handed something else.
 */
reviews.post(NOTE_SCREENSHOT_UPLOAD_ROUTE, async (c) => {
  const ctx = await getRuntimeCtx()
  const note = findNote(ctx, c.req.param('noteId'))
  if (!note) return c.notFound()

  const png = new Uint8Array(await c.req.arrayBuffer())
  if (!isPng(png)) return c.json({ error: 'body is not a PNG' }, 400)

  return c.json(attachScreenshot(ctx, note.id, png))
})

/**
 * GET /api/reviews/note/:noteId/screenshot.png — the annotated frame itself.
 *
 * No range handling: an `<img>` fetches a screenshot whole. 404 covers every
 * kind of absence — unknown note, a note nobody annotated — because to the
 * browser they are the same fact: there is no image here.
 */
reviews.get(NOTE_SCREENSHOT_ROUTE, async (c) => {
  const ctx = await getRuntimeCtx()
  const note = findNote(ctx, c.req.param('noteId'))
  if (!note) return c.notFound()

  const path = annotationPath(note.id)
  const size = fileSize(path)
  if (size === undefined) return c.notFound()

  const headers = { 'content-type': 'image/png', 'content-length': String(size) }
  if (size === 0) return c.body(null, 200, headers)
  return c.body(fileStream(path, 0, size - 1), 200, headers)
})

export default reviews
