import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { annotationPath, reviewDir, reviewWalkthroughPath } from '@runcastle/core/paths'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import reviewsApp from '../src/routes/reviews'
import { addNote, deleteNote, listByFeature as listNotes } from '../src/services/test-notes'
import { storeTickets } from '../src/services/tickets'
import { updateTicket } from '../src/services/tickets'
import { tickets } from '../src/db/schema'
import { eq } from 'drizzle-orm'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Review artifact routes (improve-workflow seam 6). The seam is HTTP, so every
 * assertion goes through a request: what the listing says about what is on
 * disk, and whether the video route answers a scrubbing player.
 *
 * The data dir is redirected at a temp tree so `reviewDir` — and therefore the
 * routes' only path input — lands somewhere disposable.
 */

function mount(): Hono {
  const app = new Hono()
  app.route('/api/reviews', reviewsApp)
  return app
}

const VIDEO = 'webm-bytes-0123456789' // 21 bytes, distinguishable per slice

describe('review artifacts over HTTP', () => {
  let ctx: AppCtx
  let featureId: string
  let dataDir: string
  let originalDataDir: string | undefined

  /** Store a review + an implementation ticket; return the review's id. */
  function seedTickets(): { reviewId: string; secondReviewId: string; implId: string } {
    const stored = storeTickets(ctx, featureId, [
      { title: 'build it', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy: [] },
      {
        title: 'review it',
        goal: 'g',
        context: 'c',
        acceptanceCriteria: ['a'],
        seams: ['s'],
        blockedBy: [1],
        kind: 'review',
      },
      {
        title: 'review the API too',
        goal: 'g',
        context: 'c',
        acceptanceCriteria: ['a'],
        seams: ['s'],
        blockedBy: [1],
        kind: 'review',
      },
    ])
    return { implId: stored[0].id, reviewId: stored[1].id, secondReviewId: stored[2].id }
  }

  function recordWalkthrough(ticketId: string, body = VIDEO): void {
    mkdirSync(reviewDir(ticketId), { recursive: true })
    writeFileSync(reviewWalkthroughPath(ticketId), body)
  }

  beforeEach(async () => {
    originalDataDir = process.env.RUNCASTLE_DATA_DIR
    dataDir = mkdtempSync(join(tmpdir(), 'rc-review-artifacts-'))
    process.env.RUNCASTLE_DATA_DIR = dataDir

    ctx = await makeTestCtx()
    featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review' }).id
    setRuntimeCtx(ctx)
  })

  afterEach(() => {
    clearRuntimeCtx()
    if (originalDataDir === undefined) delete process.env.RUNCASTLE_DATA_DIR
    else process.env.RUNCASTLE_DATA_DIR = originalDataDir
    rmSync(dataDir, { recursive: true, force: true })
  })

  describe('the per-feature listing', () => {
    it('reports the review tickets, and which of them left a recording', async () => {
      const { reviewId, secondReviewId } = seedTickets()
      recordWalkthrough(reviewId)

      const res = await mount().request(`/api/reviews/${featureId}`)
      expect(res.status).toBe(200)

      // Implementation tickets are not review artifacts and are not listed.
      expect(await res.json()).toEqual([
        {
          ticketId: reviewId,
          seq: 2,
          lap: 1,
          passKind: 'review',
          reviewedCommit: null,
          completedAt: null,
          landedSince: 0,
          hasVideo: true,
          videoUrl: `/api/reviews/ticket/${reviewId}/walkthrough.webm`,
        },
        // Nothing was recorded for this one — a normal state, not an error.
        {
          ticketId: secondReviewId, seq: 3, lap: 1, passKind: 'review',
          reviewedCommit: null, completedAt: null, landedSince: 0,
          hasVideo: false, videoUrl: null,
        },
      ])
    })

    it('orders completed passes by completion time and counts later landed work', async () => {
      const { reviewId, secondReviewId, implId } = seedTickets()
      updateTicket(ctx, secondReviewId, { status: 'done', reviewedCommit: 'newer-seq-first' })
      updateTicket(ctx, reviewId, { status: 'done', reviewedCommit: 'older-seq-last' })
      updateTicket(ctx, implId, { status: 'done', commits: ['landed'] })
      ctx.db.update(tickets).set({ completedAt: 100 }).where(eq(tickets.id, secondReviewId)).run()
      ctx.db.update(tickets).set({ completedAt: 200 }).where(eq(tickets.id, reviewId)).run()
      ctx.db.update(tickets).set({ completedAt: 300 }).where(eq(tickets.id, implId)).run()

      const artifacts = await (await mount().request(`/api/reviews/${featureId}`)).json()
      expect(artifacts.map((artifact: { ticketId: string }) => artifact.ticketId)).toEqual([
        secondReviewId,
        reviewId,
      ])
      expect(artifacts.map((artifact: { landedSince: number }) => artifact.landedSince)).toEqual([1, 1])
    })

    it('reads presence off the disk, not off the ticket row', async () => {
      const { reviewId } = seedTickets()
      const before = await (await mount().request(`/api/reviews/${featureId}`)).json()
      expect(before[0].hasVideo).toBe(false)

      recordWalkthrough(reviewId)

      const after = await (await mount().request(`/api/reviews/${featureId}`)).json()
      expect(after[0]).toMatchObject({ hasVideo: true })
    })

    it('is empty for a feature whose burn had no review ticket', async () => {
      storeTickets(ctx, featureId, [
        { title: 'build it', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy: [] },
      ])

      const res = await mount().request(`/api/reviews/${featureId}`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    })

    it('is empty — not an error — for a feature that does not exist', async () => {
      const res = await mount().request('/api/reviews/feat_nope')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    })
  })

  describe('streaming the walkthrough', () => {
    const url = (ticketId: string): string => `/api/reviews/ticket/${ticketId}/walkthrough.webm`

    it('serves the whole recording as seekable WebM', async () => {
      const { reviewId } = seedTickets()
      recordWalkthrough(reviewId)

      const res = await mount().request(url(reviewId))

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('video/webm')
      expect(res.headers.get('accept-ranges')).toBe('bytes')
      expect(res.headers.get('content-length')).toBe(String(VIDEO.length))
      expect(await res.text()).toBe(VIDEO)
    })

    it('answers a scrubbing player with just the bytes it asked for', async () => {
      const { reviewId } = seedTickets()
      recordWalkthrough(reviewId)

      const res = await mount().request(url(reviewId), { headers: { range: 'bytes=4-8' } })

      expect(res.status).toBe(206)
      expect(res.headers.get('content-range')).toBe(`bytes 4-8/${VIDEO.length}`)
      expect(res.headers.get('content-length')).toBe('5')
      expect(await res.text()).toBe(VIDEO.slice(4, 9))
    })

    it('reads an open-ended range to the end, and a suffix range from the end', async () => {
      const { reviewId } = seedTickets()
      recordWalkthrough(reviewId)
      const app = mount()

      const open = await app.request(url(reviewId), { headers: { range: 'bytes=15-' } })
      expect(open.status).toBe(206)
      expect(open.headers.get('content-range')).toBe(`bytes 15-20/${VIDEO.length}`)
      expect(await open.text()).toBe(VIDEO.slice(15))

      const suffix = await app.request(url(reviewId), { headers: { range: 'bytes=-6' } })
      expect(suffix.status).toBe(206)
      expect(suffix.headers.get('content-range')).toBe(`bytes 15-20/${VIDEO.length}`)
      expect(await suffix.text()).toBe(VIDEO.slice(-6))
    })

    it('clamps an end past the last byte instead of over-reading', async () => {
      const { reviewId } = seedTickets()
      recordWalkthrough(reviewId)

      const res = await mount().request(url(reviewId), { headers: { range: 'bytes=18-999' } })

      expect(res.status).toBe(206)
      expect(res.headers.get('content-range')).toBe(`bytes 18-20/${VIDEO.length}`)
      expect(await res.text()).toBe(VIDEO.slice(18))
    })

    it('refuses a range that starts past the end of the recording', async () => {
      const { reviewId } = seedTickets()
      recordWalkthrough(reviewId)

      const res = await mount().request(url(reviewId), { headers: { range: 'bytes=99-120' } })

      expect(res.status).toBe(416)
      expect(res.headers.get('content-range')).toBe(`bytes */${VIDEO.length}`)
    })

    it('falls back to the whole file for a range it cannot honour', async () => {
      const { reviewId } = seedTickets()
      recordWalkthrough(reviewId)
      const app = mount()

      // Multi-range and non-byte units are legal to ignore — 200 with the lot.
      for (const range of ['bytes=0-4, 10-14', 'items=0-4', 'nonsense']) {
        const res = await app.request(url(reviewId), { headers: { range } })
        expect(res.status, range).toBe(200)
        expect(await res.text()).toBe(VIDEO)
      }
    })

    it('serves an empty recording as empty rather than erroring', async () => {
      // A recorder cut off before a byte reached disk. The listing still says
      // there is a video, so this route has to answer something coherent.
      const { reviewId } = seedTickets()
      recordWalkthrough(reviewId, '')
      const app = mount()

      const whole = await app.request(url(reviewId))
      expect(whole.status).toBe(200)
      expect(whole.headers.get('content-length')).toBe('0')
      expect(await whole.text()).toBe('')

      const ranged = await app.request(url(reviewId), { headers: { range: 'bytes=0-9' } })
      expect(ranged.status).toBe(416)
    })

    it('404s when the review recorded nothing', async () => {
      const { reviewId } = seedTickets()

      expect((await mount().request(url(reviewId))).status).toBe(404)
    })

    it('404s for an implementation ticket, which never records', async () => {
      const { implId } = seedTickets()
      // Even with a file sitting at the path its id would compute.
      recordWalkthrough(implId)

      expect((await mount().request(url(implId))).status).toBe(404)
    })

    it('404s for a ticket id no row matches, without going near the disk', async () => {
      seedTickets()
      // A path-shaped id resolves to no ticket, so no path is ever computed from
      // it: the id is only ever used to look up a row.
      for (const id of ['tkt_nope', '..%2F..%2Fetc', '%2Eetc']) {
        expect((await mount().request(url(id))).status, id).toBe(404)
      }
    })
  })

  /**
   * The annotated frame a note carries. Everything here goes through HTTP,
   * because HTTP is the whole seam: the browser uploads what the annotation
   * canvas composited and later fetches it back into an `<img>`.
   */
  describe('a note screenshot', () => {
    // A minimal well-formed-enough PNG: the 8-byte signature plus a byte of
    // payload, which is all the route checks and all the disk needs.
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x42])

    const upload = (noteId: string): string => `/api/reviews/note/${noteId}/screenshot`
    const url = (noteId: string): string => `/api/reviews/note/${noteId}/screenshot.png`

    function post(noteId: string, body: Uint8Array): Promise<Response> {
      return mount().request(upload(noteId), { method: 'POST', body })
    }

    it('round-trips: upload the frame, fetch it back as a PNG', async () => {
      const note = addNote(ctx, featureId, 'the panel is misaligned', 'human', 12.5)

      const posted = await post(note.id, PNG)
      expect(posted.status).toBe(200)
      // The upload hands back the note the UI should now show — thumbnail and all.
      expect(await posted.json()).toMatchObject({ id: note.id, videoTimestamp: 12.5 })

      const got = await mount().request(url(note.id))
      expect(got.status).toBe(200)
      expect(got.headers.get('content-type')).toBe('image/png')
      expect(got.headers.get('content-length')).toBe(String(PNG.length))
      expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG)
    })

    it('serves it at exactly the URL the notes list stamps', async () => {
      const note = addNote(ctx, featureId, 'circled the header')
      await post(note.id, PNG)

      // The stamped URL is a promise to the browser; follow it rather than
      // rebuilding it, so a drift between service and route shows up as a 404.
      const stamped = listNotes(ctx, featureId)[0].screenshotUrl
      expect(stamped).toBeDefined()
      expect((await mount().request(stamped as string)).status).toBe(200)
    })

    it('404s for a note nobody annotated', async () => {
      const note = addNote(ctx, featureId, 'just typed this one')

      expect((await mount().request(url(note.id))).status).toBe(404)
    })

    it('404s once the note — and with it the frame — is deleted', async () => {
      const note = addNote(ctx, featureId, 'the panel is misaligned')
      await post(note.id, PNG)
      expect((await mount().request(url(note.id))).status).toBe(200)

      deleteNote(ctx, note.id)

      expect(existsSync(annotationPath(note.id))).toBe(false)
      expect((await mount().request(url(note.id))).status).toBe(404)
    })

    it('refuses an upload for a note id no row matches, without going near the disk', async () => {
      for (const id of ['note_nope', '..%2F..%2Fetc', '%2Eetc']) {
        expect((await post(id, PNG)).status, id).toBe(404)
      }
      // Nothing was written anywhere under the annotations dir.
      expect(existsSync(join(dataDir, 'annotations'))).toBe(false)
    })

    it('refuses a body that is not a PNG, which the GET would mislabel', async () => {
      const note = addNote(ctx, featureId, 'circled the header')

      const html = new TextEncoder().encode('<script>alert(1)</script>')
      expect((await post(note.id, html)).status).toBe(400)
      expect((await post(note.id, new Uint8Array())).status).toBe(400)

      expect(existsSync(annotationPath(note.id))).toBe(false)
      expect((await mount().request(url(note.id))).status).toBe(404)
    })

    it('replaces the frame when the same note is annotated again', async () => {
      const note = addNote(ctx, featureId, 'circled the header')
      await post(note.id, PNG)

      const redrawn = new Uint8Array([...PNG.slice(0, 8), 0x43, 0x44])
      expect((await post(note.id, redrawn)).status).toBe(200)

      const got = await mount().request(url(note.id))
      expect(new Uint8Array(await got.arrayBuffer())).toEqual(redrawn)
    })
  })
})
