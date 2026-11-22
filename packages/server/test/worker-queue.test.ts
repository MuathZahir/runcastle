import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Project } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { agentSlots, resetAgentSlotsForTests } from '../src/services/agent-slots'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedHostReview, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * `worker.queue` and a listed worker's `queuePlace`
 * (one-number-for-how-many-build-at-once decisions 3, 8 and 9): the machine's
 * line-up under its one limit, across every project, first come first served.
 */

let ctx: AppCtx
let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
let repo: string
let otherRepo: string
let project: Project
let other: Project
let restoreDataDir: () => void

beforeEach(async () => {
  restoreDataDir = withTempDataDir()
  resetAgentSlotsForTests()
  ctx = await makeTestCtx()
  ;(ctx.config as { burnConcurrency: number }).burnConcurrency = 1
  caller = createCallerFactory(appRouter)(ctx)
  repo = tmpRepo()
  otherRepo = tmpRepo()
  project = seedProject(ctx, repo)
  other = seedProject(ctx, otherRepo)
})

afterEach(() => {
  resetAgentSlotsForTests()
  restoreDataDir()
  rmTemp(repo)
  rmTemp(otherRepo)
})

describe('worker.queue', () => {
  it('is empty with nothing working or waiting, and names the limit', async () => {
    expect(await caller.worker.queue()).toEqual({ limit: 1, working: [], waiting: [] })
  })

  it('lists who works, then who waits in the order asked, across projects, each with its feature and project', async () => {
    const coupons = seedFeature(ctx, project.id, { slug: 'coupons', title: 'Coupons' })
    const search = seedFeature(ctx, other.id, { slug: 'search', title: 'Search' })
    const a = seedHostReview(ctx, coupons, repo, 'working')
    const b = seedHostReview(ctx, search, otherRepo, 'queued')
    const c = seedHostReview(ctx, coupons, repo, 'queued')

    const slots = agentSlots(ctx.config.burnConcurrency)
    slots.tryTake('claude-code', a.id)
    void slots.take('claude-code', b.id)
    void slots.take('claude-code', c.id)

    const q = await caller.worker.queue()
    expect(q.limit).toBe(1)
    expect(q.working).toEqual([
      expect.objectContaining({ workerId: a.id, label: 'Review', kind: 'review', featureId: coupons.id, featureTitle: 'Coupons', projectId: project.id, projectName: project.name, heldBy: null }),
    ])
    expect(q.waiting.map((e) => [e.workerId, e.featureTitle, e.projectName])).toEqual([
      [b.id, 'Search', other.name],
      [c.id, 'Coupons', project.name],
    ])
  })

  it('keeps a held waiter in its place with why, and leaves it out of the places in line', async () => {
    const coupons = seedFeature(ctx, project.id, { slug: 'coupons' })
    const a = seedHostReview(ctx, coupons, repo, 'working')
    const held = seedHostReview(ctx, coupons, repo, 'queued')
    const next = seedHostReview(ctx, coupons, repo, 'queued')

    const slots = agentSlots(ctx.config.burnConcurrency)
    slots.tryTake('codex', a.id)
    void slots.take('claude-code', held.id)
    void slots.take('codex', next.id)
    slots.hold('claude-code', 'usage limit')

    const q = await caller.worker.queue()
    expect(q.waiting.map((e) => [e.workerId, e.heldBy])).toEqual([
      [held.id, 'usage limit'],
      [next.id, null],
    ])

    const listed = await caller.worker.listLive({ projectId: project.id })
    const place = (id: string): number | null | undefined => listed.find((w) => w.id === id)?.queuePlace
    expect(place(a.id)).toBeNull()
    expect(place(held.id)).toBeNull()
    expect(place(next.id)).toBe(1)
  })
})
