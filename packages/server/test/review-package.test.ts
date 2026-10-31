import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { foldThread, type Feature, type Project, type Ticket } from '@runcastle/core'
import { reviewSawDir, reviewShotPath, reviewWalkthroughPath } from '@runcastle/core/paths'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow } from '../src/launcher/sessions'
import reviews from '../src/routes/reviews'
import { reviewPackage, reviewShots } from '../src/services/review-package'
import { appendSaw, readSaw, startSaw } from '../src/services/review-saw'
import { storeTickets, updateTicket } from '../src/services/tickets'
import { readThreadEvents } from '../src/threads/log'
import { postReviewPackage, showReviewPackage } from '../src/threads/review-package'
import { captureReviewShot, sessionListed } from '../src/workflows/review-capture'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])

describe('review package', () => {
  let ctx: AppCtx
  let project: Project
  let feature: Feature
  let pass: Ticket
  const app = new Hono().route('/api/reviews', reviews)
  const saved = process.env.RUNCASTLE_DATA_DIR

  const review = (title: string) =>
    storeTickets(ctx, feature.id, [{ title, goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: [], blockedBy: [], kind: 'review' }])[0]!

  const keep = (ticketId: string, image: string, caption: string) => {
    mkdirSync(reviewSawDir(ticketId), { recursive: true })
    writeFileSync(reviewShotPath(ticketId, image), PNG)
    appendSaw(ticketId, { kind: 'shot', at: 1, caption, image })
  }

  beforeEach(async () => {
    process.env.RUNCASTLE_DATA_DIR = mkdtempSync(join(tmpdir(), 'rc-review-package-'))
    ctx = await makeTestCtx()
    setRuntimeCtx(ctx)
    project = seedProject(ctx, tmpRepo())
    feature = seedFeature(ctx, project.id)
    pass = review('Review it')
  })

  afterEach(() => {
    clearRuntimeCtx()
    if (saved === undefined) delete process.env.RUNCASTLE_DATA_DIR
    else process.env.RUNCASTLE_DATA_DIR = saved
  })

  describe('the log', () => {
    it('keeps entries in order, and drops a line a crash cut off', () => {
      startSaw(pass.id)
      appendSaw(pass.id, { kind: 'shot', at: 1, caption: 'One', image: 'shot-1.png' })
      writeFileSync(join(reviewSawDir(pass.id), 'saw.jsonl'), '{"kind":"shot"', { flag: 'a' })
      expect(readSaw(pass.id).map((e) => e.kind === 'shot' && e.caption)).toEqual(['One'])
    })

    it('reads as empty for a pass from before there were logs', () => {
      expect(readSaw(pass.id)).toEqual([])
    })
  })

  describe('reviewPackage', () => {
    it('leads with the first line of the digest, and says why there are no pictures', async () => {
      updateTicket(ctx, pass.id, { status: 'done', digest: 'Lap 1: it works · Gates mode\n\nThe long account.', reviewMode: 'gates' })
      const stored = { ...pass, digest: 'Lap 1: it works · Gates mode\n\nThe long account.', reviewMode: 'gates' as const, status: 'done' as const }
      const pack = await reviewPackage(ctx, stored, feature, project.repoPath)
      expect(pack.verdict).toBe('Lap 1: it works · Gates mode')
      expect(pack.account).toBe('The long account.')
      expect(pack.empty).toContain('read the code')
      expect(pack.hasWalkthrough).toBe(false)
    })

    it('holds the pictures, and no empty line, once there are some', async () => {
      startSaw(pass.id)
      keep(pass.id, 'shot-1.png', 'The dialog')
      const pack = await reviewPackage(ctx, pass, feature, project.repoPath)
      expect(pack.empty).toBeNull()
      expect(pack.groups[0]?.shots[0]?.caption).toBe('The dialog')
    })

    it('knows a walkthrough by its file', async () => {
      mkdirSync(reviewSawDir(pass.id), { recursive: true })
      writeFileSync(reviewWalkthroughPath(pass.id), 'video')
      expect((await reviewPackage(ctx, pass, feature, project.repoPath)).hasWalkthrough).toBe(true)
    })
  })

  describe('the routes', () => {
    it('serves the package and a picture the pass kept', async () => {
      startSaw(pass.id)
      keep(pass.id, 'shot-1.png', 'The dialog')
      const pack = await app.request(`/api/reviews/ticket/${pass.id}/package.json`)
      expect(pack.status).toBe(200)
      expect((await pack.json()).groups[0].shots[0].src).toBe(`/api/reviews/ticket/${pass.id}/saw/shot-1.png`)
      const image = await app.request(`/api/reviews/ticket/${pass.id}/saw/shot-1.png`)
      expect(image.status).toBe(200)
      expect(image.headers.get('content-type')).toBe('image/png')
      expect(image.headers.get('x-content-type-options')).toBe('nosniff')
    })

    it('refuses a name the store would not write, and a ticket that is no review', async () => {
      const name = encodeURIComponent('../DIGEST.md')
      expect((await app.request(`/api/reviews/ticket/${pass.id}/saw/${name}`)).status).toBe(400)
      expect((await app.request(`/api/reviews/ticket/${pass.id}/saw/shot-9.png`)).status).toBe(404)
      const [work] = storeTickets(ctx, feature.id, [{ title: 'Build', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: [], blockedBy: [] }])
      expect((await app.request(`/api/reviews/ticket/${work!.id}/package.json`)).status).toBe(404)
    })
  })

  describe('in a thread', () => {
    const chat = () => createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: project.repoPath } as never)

    it('posts a finished pass in the feature’s chat by itself', () => {
      const session = chat()
      startSaw(pass.id)
      postReviewPackage(ctx, feature.id, pass.id)
      expect(foldThread(readThreadEvents(session.id)).items).toEqual([expect.objectContaining({ kind: 'review_package', ticketId: pass.id })])
    })

    it('posts nothing for a pass that never started', () => {
      const session = chat()
      postReviewPackage(ctx, feature.id, pass.id)
      expect(foldThread(readThreadEvents(session.id)).items).toEqual([])
    })

    it('shows the newest pass with pictures, not a newer one without', async () => {
      const session = chat()
      updateTicket(ctx, pass.id, { status: 'done' })
      startSaw(pass.id)
      keep(pass.id, 'shot-1.png', 'The dialog')
      const later = review('Verify it')
      updateTicket(ctx, later.id, { status: 'done' })
      expect(await showReviewPackage(ctx, session, feature)).toMatchObject({ shown: true, seq: pass.seq, screenshots: 1 })
      expect(foldThread(readThreadEvents(session.id)).items.at(-1)).toMatchObject({ ticketId: pass.id })
    })

    it('refuses a feature with no finished review', async () => {
      await expect(showReviewPackage(ctx, chat(), feature)).rejects.toBeInstanceOf(GateError)
    })
  })

  it('lists the pictures reviews kept, newest pass first, by a path show_file can read', () => {
    startSaw(pass.id)
    keep(pass.id, 'shot-1.png', 'First')
    const later = review('Verify it')
    startSaw(later.id)
    keep(later.id, 'shot-1.png', 'Second')
    review('Gates pass')
    const shots = reviewShots(ctx, feature.id)
    expect(shots.map((s) => s.shots[0]?.caption)).toEqual(['Second', 'First'])
    expect(shots[0]?.shots[0]?.path).toBe(reviewShotPath(later.id, 'shot-1.png'))
  })
})

describe('captureReviewShot', () => {
  const ran: string[][] = []
  const deps = (listing: string | null, taken = true) => ({
    findBrowser: () => 'agent-browser',
    listSessions: async () => listing,
    run: async (_bin: string, args: readonly string[]) => {
      ran.push([...args])
      return taken
    },
    fileExists: () => taken,
  })

  beforeEach(() => {
    ran.length = 0
  })

  it('reads session list output, the current session marked', () => {
    expect(sessionListed('Active sessions:\n→ default\n  review-t1\n', 'review-t1')).toBe(true)
    expect(sessionListed('Active sessions:\n→ review-t1\n', 'review-t1')).toBe(true)
    expect(sessionListed('Active sessions:\n  review-t10\n', 'review-t1')).toBe(false)
  })

  it('shoots the pass’s own session', async () => {
    expect(await captureReviewShot('t1', 'p.png', deps('  review-t1\n'))).toEqual({ ok: true })
    expect(ran).toEqual([['--session', 'review-t1', 'screenshot', 'p.png']])
  })

  it('never starts a browser the agent has not opened', async () => {
    expect(await captureReviewShot('t1', 'p.png', deps('No active sessions'))).toMatchObject({ ok: false })
    expect(ran).toEqual([])
  })

  it('says so when the shot fails', async () => {
    expect(await captureReviewShot('t1', 'p.png', deps('  review-t1\n', false))).toMatchObject({ ok: false, reason: expect.stringContaining('failed') })
  })
})
