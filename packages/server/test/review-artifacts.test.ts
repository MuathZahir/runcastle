import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reviewDir, reviewWalkthroughPath } from '@runcastle/core/paths'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import reviewsApp from '../src/routes/reviews'
import { storeTickets } from '../src/services/tickets'
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
          hasVideo: true,
          videoUrl: `/api/reviews/ticket/${reviewId}/walkthrough.webm`,
        },
        // Nothing was recorded for this one — a normal state, not an error.
        { ticketId: secondReviewId, seq: 3, hasVideo: false, videoUrl: null },
      ])
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
})
