import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newId } from '@runcastle/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { events, features, runs, tickets } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import {
  DELETED_CAPTURE_PREFIX,
  expireReviewCaptures,
  removeFeatureReviewCaptures,
  REVIEW_CAPTURE_TTL_MS,
} from '../src/services/review-capture-expiry'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedHostReview, seedProject } from './helpers/fixtures'

/**
 * Review captures go 30 days after their feature closes (decision 10). Folders
 * live in a temp data folder; their age is set with `utimes`, and the feature's
 * close time is its `feature.shipped` / `feature.archived` event.
 */

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 17)

let ctx: AppCtx
let dir: string
let projectId: string

beforeEach(async () => {
  ctx = await makeTestCtx()
  projectId = seedProject(ctx).id
  dir = mkdtempSync(join(tmpdir(), 'runcastle-captures-'))
  return () => rmTemp(dir)
})

/** A capture folder holding one 1000-byte picture, last touched `ageDays` ago. */
function capture(id: string, ageDays = 0): string {
  const path = join(dir, 'reviews', id)
  mkdirSync(join(path, 'saw'), { recursive: true })
  const file = join(path, 'saw', 'shot-1.png')
  writeFileSync(file, Buffer.alloc(1000))
  const when = new Date(NOW - ageDays * DAY)
  for (const p of [file, join(path, 'saw'), path]) utimesSync(p, when, when)
  return path
}

function reviewWorker(featureId: string): string {
  const feature = seedFeature(ctx, projectId, { id: featureId, slug: featureId })
  return seedHostReview(ctx, feature, '/tmp/wt', 'handed-back').id
}

function closeEvent(featureId: string, type: 'feature.shipped' | 'feature.archived', daysAgo: number) {
  ctx.db.insert(events).values({ projectId, featureId, ts: NOW - daysAgo * DAY, type, message: type }).run()
}

function ticketFor(featureId: string): string {
  const id = newId('tkt')
  ctx.db
    .insert(tickets)
    .values({
      id,
      featureId,
      seq: 1,
      title: 't',
      goal: 'g',
      context: 'c',
      acceptanceCriteria: [],
      seams: [],
      blockedBy: [],
      status: 'done',
      commits: [],
    })
    .run()
  return id
}

const expire = () => expireReviewCaptures({ db: ctx.db, now: NOW, dataDir: dir })

describe('expireReviewCaptures', () => {
  it('keeps the captures of an open feature, however old', () => {
    const id = reviewWorker('feat_open')
    const path = capture(id, 90)

    expect(expire()).toMatchObject({ removed: [], kept: 1 })
    expect(existsSync(path)).toBe(true)
  })

  it('removes a shipped feature’s captures 30 days after it shipped, not before', () => {
    const recent = reviewWorker('feat_recent')
    const old = reviewWorker('feat_old')
    ctx.db.update(features).set({ status: 'shipped' }).run()
    closeEvent('feat_recent', 'feature.shipped', 10)
    closeEvent('feat_old', 'feature.shipped', 31)
    capture(recent, 40)
    const oldPath = capture(old, 40)

    const result = expire()

    expect(result.removed).toEqual([
      { id: old, projectId, featureId: 'feat_old', reason: 'feature-closed', bytes: 1000 },
    ])
    expect(result.freedBytes).toBe(1000)
    expect(result.kept).toBe(1)
    expect(existsSync(oldPath)).toBe(false)
  })

  it('removes an archived feature’s captures through its retired review tickets too', () => {
    seedFeature(ctx, projectId, { id: 'feat_arch', slug: 'arch', status: 'archived' })
    closeEvent('feat_arch', 'feature.archived', 45)
    const ticket = ticketFor('feat_arch')
    capture(ticket, 1)

    expect(expire().removed.map((r) => [r.id, r.reason])).toEqual([[ticket, 'feature-closed']])
  })

  it('falls back to the folder’s age when no close event is left', () => {
    seedFeature(ctx, projectId, { id: 'feat_a', slug: 'a', status: 'archived' })
    const runFresh = newId('run')
    const runOld = newId('run')
    for (const id of [runFresh, runOld]) {
      ctx.db.insert(runs).values({ id, featureId: 'feat_a', workflow: 'w', status: 'succeeded', startedAt: 0 }).run()
    }
    capture(runFresh, 5)
    capture(runOld, 31)

    expect(expire().removed.map((r) => r.id)).toEqual([runOld])
  })

  it('removes at once the captures whose rows name a feature that is gone', () => {
    const ticket = ticketFor('feat_deleted')
    capture(ticket, 0)

    expect(expire().removed).toMatchObject([{ id: ticket, reason: 'feature-deleted', projectId: null }])
  })

  it('removes at once a folder a feature delete marked because it would not go', () => {
    capture(`${DELETED_CAPTURE_PREFIX}tkt_locked`, 0)

    expect(expire().removed).toMatchObject([{ id: `${DELETED_CAPTURE_PREFIX}tkt_locked`, reason: 'feature-deleted' }])
  })

  it('removes a folder nothing maps once it is 30 days old', () => {
    capture('tkt_unknown_old', 31)
    const young = capture('tkt_unknown_new', 29)

    const result = expire()

    expect(result.removed.map((r) => [r.id, r.reason])).toEqual([['tkt_unknown_old', 'unmapped']])
    expect(existsSync(young)).toBe(true)
  })

  it('judges an unmapped folder by its newest file, not the folder itself', () => {
    const path = capture('tkt_busy', 60)
    const fresh = new Date(NOW - DAY)
    utimesSync(join(path, 'saw', 'shot-1.png'), fresh, fresh)

    expect(expire().removed).toEqual([])
  })

  it('does nothing when there is no reviews folder', () => {
    expect(expire()).toEqual({ removed: [], freedBytes: 0, kept: 0, failed: [] })
  })

  it('measures the 30 days exactly', () => {
    expect(REVIEW_CAPTURE_TTL_MS).toBe(30 * DAY)
  })
})

describe('removeFeatureReviewCaptures', () => {
  it('removes every capture folder of the feature and nothing else', () => {
    const worker = reviewWorker('feat_del')
    const ticket = ticketFor('feat_del')
    const other = reviewWorker('feat_keep')
    for (const id of [worker, ticket, other]) capture(id)

    removeFeatureReviewCaptures(ctx.db, 'feat_del', dir)

    expect(existsSync(join(dir, 'reviews', worker))).toBe(false)
    expect(existsSync(join(dir, 'reviews', ticket))).toBe(false)
    expect(existsSync(join(dir, 'reviews', other))).toBe(true)
  })
})
