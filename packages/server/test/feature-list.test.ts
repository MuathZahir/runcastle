import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { emit } from '../src/services/events'
import { list } from '../src/services/features'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * improve-features-section ticket 2 — the sidebar row's relative activity stamp
 * ("10m") reads `lastActivityAt` off `feature.list`. The list carried only
 * `createdAt`, which answers "when was this made", not "is anything happening".
 */
describe('feature.list lastActivityAt', () => {
  let ctx: AppCtx
  let projectId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    projectId = seedProject(ctx).id
  })

  it('is the feature’s latest event timestamp', () => {
    const feature = seedFeature(ctx, projectId, { createdAt: 1_000 })
    emit(ctx, feature.id, { type: 'a', message: 'older' })
    const latest = emit(ctx, feature.id, { type: 'b', message: 'newer' })

    const [item] = list(ctx, projectId)
    expect(item.lastActivityAt).toBe(latest.ts)
    expect(item.lastActivityAt).toBeGreaterThan(1_000)
  })

  it('falls back to createdAt for a feature with no events', () => {
    seedFeature(ctx, projectId, { createdAt: 1_700_000_000_000 })

    const [item] = list(ctx, projectId)
    expect(item.lastActivityAt).toBe(1_700_000_000_000)
  })

  it('scopes activity to its own feature', () => {
    const quiet = seedFeature(ctx, projectId, { slug: 'quiet', createdAt: 5_000 })
    const busy = seedFeature(ctx, projectId, { slug: 'busy', createdAt: 5_000 })
    const busyEvent = emit(ctx, busy.id, { type: 'a', message: 'work' })

    const items = list(ctx, projectId)
    const byId = new Map(items.map((f) => [f.id, f.lastActivityAt]))
    expect(byId.get(busy.id)).toBe(busyEvent.ts)
    expect(byId.get(quiet.id)).toBe(5_000)
  })

  it('ignores events belonging to another project', () => {
    const otherProjectId = seedProject(ctx).id
    const mine = seedFeature(ctx, projectId, { slug: 'mine', createdAt: 5_000 })
    const theirs = seedFeature(ctx, otherProjectId, { slug: 'theirs', createdAt: 5_000 })
    emit(ctx, theirs.id, { type: 'a', message: 'not mine' })

    const [item] = list(ctx, projectId)
    expect(item.id).toBe(mine.id)
    expect(item.lastActivityAt).toBe(5_000)
  })
})
