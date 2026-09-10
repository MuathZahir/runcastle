import { beforeEach, describe, expect, it } from 'vitest'
import { projects } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { listFindings, recordFinding } from '../src/services/findings'
import { adoptProjectImage, releaseProjectImage } from '../src/services/project-image'
import { requireProjectById } from '../src/services/repo'
import { makeTestCtx } from './helpers/db'

/**
 * Who owns the `sandboxImage` project column (feature
 * `project-owned-sandbox-image`, decisions 6 and 8): runcastle writes it on a
 * successful build and takes it back when the Dockerfile is deleted, and never
 * touches a tag the human typed.
 */

describe('adoptProjectImage', () => {
  let ctx: AppCtx

  beforeEach(async () => {
    ctx = await makeTestCtx()
    ctx.db.insert(projects).values({ id: 'proj_1', name: 'acme', repoPath: '/repo' }).run()
  })

  const stored = async () => {
    const project = requireProjectById(ctx, 'proj_1')
    const finding = (await listFindings(ctx, project)).find((f) => f.key === 'sandboxImage')
    return { image: project.sandboxImage, source: finding?.source }
  }

  it('writes the project column with machine provenance on a successful build', async () => {
    expect(adoptProjectImage(ctx, 'proj_1', 'sandcastle:runcastle-proj_1')).toBe(true)
    expect(await stored()).toEqual({ image: 'sandcastle:runcastle-proj_1', source: 'build' })
  })

  it('never overwrites a tag the human typed', async () => {
    recordFinding(ctx, 'proj_1', {
      key: 'sandboxImage',
      value: 'acme/custom:v1',
      source: 'human',
    })
    expect(adoptProjectImage(ctx, 'proj_1', 'sandcastle:runcastle-proj_1')).toBe(false)
    expect(await stored()).toEqual({ image: 'acme/custom:v1', source: 'human' })
  })

  // Decision 8 — runcastle wrote the value when it built the image, so it gives
  // it back when the Dockerfile that justified it is deleted. Clearing drops the
  // provenance row with it, which is what hands the field to the next build.
  it('releases a value it wrote itself, so resolution falls back', async () => {
    adoptProjectImage(ctx, 'proj_1', 'sandcastle:runcastle-proj_1')
    expect(releaseProjectImage(ctx, 'proj_1')).toBe(true)
    expect(await stored()).toEqual({ image: undefined, source: undefined })
  })

  it('never releases a tag the human typed', async () => {
    recordFinding(ctx, 'proj_1', {
      key: 'sandboxImage',
      value: 'acme/custom:v1',
      source: 'human',
    })
    expect(releaseProjectImage(ctx, 'proj_1')).toBe(false)
    expect(await stored()).toEqual({ image: 'acme/custom:v1', source: 'human' })
  })
})
