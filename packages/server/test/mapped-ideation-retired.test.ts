import { describe, expect, it } from 'vitest'
import { listSessionsByFeature } from '../src/services/repo'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Mapped ideation was retired (ADR-0012). Until the contract change deletes
 * them, the two map doors stay callable-shaped but refuse, and open nothing.
 */
describe('retired mapped-ideation procedures', () => {
  it('feature.workWaypoint and feature.converge refuse with PRECONDITION_FAILED and launch nothing', async () => {
    const ctx = await makeTestCtx()
    const feature = seedFeature(ctx, seedProject(ctx).id)
    const caller = createCallerFactory(appRouter)(ctx)

    const retired = { code: 'PRECONDITION_FAILED', message: 'mapped ideation was retired (ADR-0012)' }
    await expect(
      caller.feature.workWaypoint({ featureId: feature.id, waypointId: 'wp_any' }),
    ).rejects.toMatchObject(retired)
    await expect(caller.feature.converge({ featureId: feature.id })).rejects.toMatchObject(retired)
    expect(listSessionsByFeature(ctx, feature.id)).toEqual([])
  })
})
