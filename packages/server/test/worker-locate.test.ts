import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Feature, Project } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedDriveWorker, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * The read behind a `worker:<id>` link in a chat (chats-link-to-what-they-name):
 * a worker id to its feature's id and slug, or null.
 */

let ctx: AppCtx
let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
let repo: string
let project: Project
let feature: Feature
let restoreDataDir: () => void

beforeEach(async () => {
  restoreDataDir = withTempDataDir()
  ctx = await makeTestCtx()
  caller = createCallerFactory(appRouter)(ctx)
  repo = tmpRepo()
  project = seedProject(ctx, repo)
  feature = seedFeature(ctx, project.id, { slug: 'faster-reviews' })
})

afterEach(() => {
  restoreDataDir()
  rmTemp(repo)
})

describe('worker.locate', () => {
  it("gives a feature's worker its feature's id and slug", async () => {
    const w = seedDriveWorker(ctx, { feature }, 'fix-drive', repo)
    expect(await caller.worker.locate({ projectId: project.id, workerId: w.id })).toEqual({ featureId: feature.id, slug: 'faster-reviews' })
  })

  it('still finds a dropped worker', async () => {
    const w = seedDriveWorker(ctx, { feature }, 'fix-drive', repo, { status: 'dropped' })
    expect(await caller.worker.locate({ projectId: project.id, workerId: w.id })).toEqual({ featureId: feature.id, slug: 'faster-reviews' })
  })

  it('is null for an id the app has no record of', async () => {
    expect(await caller.worker.locate({ projectId: project.id, workerId: 'sess_nope' })).toBeNull()
  })

  it("is null for a project's own worker, owned by no feature", async () => {
    const w = seedDriveWorker(ctx, { project }, 'scenario', repo)
    expect(await caller.worker.locate({ projectId: project.id, workerId: w.id })).toBeNull()
  })

  it("is null for another project's worker, so its link never opens inside this project", async () => {
    const otherRepo = tmpRepo()
    try {
      const other = seedProject(ctx, otherRepo)
      const otherFeature = seedFeature(ctx, other.id, { slug: 'elsewhere' })
      const w = seedDriveWorker(ctx, { feature: otherFeature }, 'fix-drive', otherRepo)
      expect(await caller.worker.locate({ projectId: project.id, workerId: w.id })).toBeNull()
      expect(await caller.worker.locate({ projectId: other.id, workerId: w.id })).toEqual({ featureId: otherFeature.id, slug: 'elsewhere' })
    } finally {
      rmTemp(otherRepo)
    }
  })
})
