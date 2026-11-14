import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Project } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedDriveWorker, seedFeature, seedHostReview, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * `worker.listLive` (workers-nest-under-their-feature decision 2): every
 * feature's live workers in the project, each with its `featureId`, for the
 * rows the sidebar nests under each feature.
 */

let ctx: AppCtx
let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
let repo: string
let project: Project
let restoreDataDir: () => void

beforeEach(async () => {
  restoreDataDir = withTempDataDir()
  ctx = await makeTestCtx()
  caller = createCallerFactory(appRouter)(ctx)
  repo = tmpRepo()
  project = seedProject(ctx, repo)
})

afterEach(() => {
  restoreDataDir()
  rmTemp(repo)
})

describe('worker.listLive', () => {
  it('returns only the live workers of every feature, each with its featureId', async () => {
    const a = seedFeature(ctx, project.id, { slug: 'coupons' })
    const b = seedFeature(ctx, project.id, { slug: 'search' })
    const byStatus = new Map<string, string>()
    for (const status of ['working', 'queued', 'needs-you', 'failed', 'handed-back', 'landed', 'dropped'] as const) {
      byStatus.set(seedHostReview(ctx, a, repo, status).id, status)
    }
    const onB = seedHostReview(ctx, b, repo, 'working')

    const live = await caller.worker.listLive({ projectId: project.id })

    expect(live.map((w) => byStatus.get(w.id) ?? w.id).sort()).toEqual(['failed', 'needs-you', 'queued', 'working', onB.id].sort())
    for (const w of live) expect(w.featureId).toBe(w.id === onB.id ? b.id : a.id)
    // The same listing `worker.list` gives: its need, its turn and its preview.
    expect(live[0]).toHaveProperty('need')
    expect(live[0]).toHaveProperty('turnRunning')
    expect(live[0]).toHaveProperty('previewPath')
  })

  it("leaves out the project's own workers and another project's", async () => {
    seedDriveWorker(ctx, { project }, 'scenario', repo)
    const otherRepo = tmpRepo()
    try {
      const other = seedProject(ctx, otherRepo)
      seedHostReview(ctx, seedFeature(ctx, other.id, { slug: 'elsewhere' }), otherRepo, 'working')
      expect(await caller.worker.listLive({ projectId: project.id })).toEqual([])
    } finally {
      rmTemp(otherRepo)
    }
  })
})
