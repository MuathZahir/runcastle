import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * The `mapped` flag round-trip. Mapped ideation is retired (ADR-0012) and
 * nothing scaffolds a map any more; the column itself goes with the contract
 * migration.
 */
describe('mapped feature flag', () => {
  let ctx: AppCtx
  let projectId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    projectId = seedProject(ctx, tmpRepo()).id
  })

  it('round-trips the mapped flag through the store', () => {
    const plain = seedFeature(ctx, projectId, { slug: 'plain' })
    const mapped = seedFeature(ctx, projectId, {
      slug: 'charted',
      mapped: true,
    })
    expect(plain.mapped).toBe(false)
    expect(mapped.mapped).toBe(true)
  })
})
