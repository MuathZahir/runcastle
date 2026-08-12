import type { WaypointInput } from '@runcastle/core'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError, InvalidInputError, NotFoundError } from '../src/errors'
import { listAfter } from '../src/services/events'
import { getFeatureFull } from '../src/services/features'
import {
  claim,
  frontier,
  getWaypoint,
  listByFeature,
  promoteLastSession,
  release,
  resolve,
  storeWaypoints,
} from '../src/services/waypoints'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

function wp(
  title: string,
  blockedBy: (number | string)[] = [],
  overrides: Partial<WaypointInput> = {},
): WaypointInput {
  return { title, type: 'grilling', question: `q: ${title}`, blockedBy, ...overrides }
}

describe('waypoints service', () => {
  let ctx: AppCtx
  let featureId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const project = seedProject(ctx)
    featureId = seedFeature(ctx, project.id, { mapped: true }).id
  })

  describe('storeWaypoints — seq + blocking edges', () => {
    it('assigns sequential seqs per feature, continuing across batches', () => {
      const first = storeWaypoints(ctx, featureId, [wp('a'), wp('b'), wp('c')])
      expect(first.map((w) => w.seq)).toEqual([1, 2, 3])
      const second = storeWaypoints(ctx, featureId, [wp('d')])
      expect(second.map((w) => w.seq)).toEqual([4])
    })

    it('resolves in-batch numeric blockedBy positions to global seq', () => {
      const batch = storeWaypoints(ctx, featureId, [wp('a'), wp('b', [1]), wp('c', [1, 2])])
      expect(batch[1].blockedBy).toEqual([1])
      expect(batch[2].blockedBy).toEqual([1, 2])
    })

    it('resolves string ids of already-stored waypoints to their seq', () => {
      const [a] = storeWaypoints(ctx, featureId, [wp('a')]) // seq 1
      const [b] = storeWaypoints(ctx, featureId, [wp('b', [a.id])]) // seq 2 blocked by seq 1
      expect(b.seq).toBe(2)
      expect(b.blockedBy).toEqual([1])
    })

    it('rejects an unknown waypoint id loudly', () => {
      expect(() => storeWaypoints(ctx, featureId, [wp('a', ['wpt_missing'])])).toThrow(
        InvalidInputError,
      )
    })

    it('rejects an out-of-range position loudly', () => {
      expect(() => storeWaypoints(ctx, featureId, [wp('a'), wp('b', [5])])).toThrow(
        InvalidInputError,
      )
    })

    it('rejects an in-batch dependency cycle loudly', () => {
      // node 1 blocks on 2, node 2 blocks on 1
      expect(() => storeWaypoints(ctx, featureId, [wp('a', [2]), wp('b', [1])])).toThrow(
        InvalidInputError,
      )
    })

    it('round-trips originWaypointId lineage', () => {
      const [a] = storeWaypoints(ctx, featureId, [wp('a')])
      const [child] = storeWaypoints(ctx, featureId, [
        wp('child', [], { originWaypointId: a.id }),
      ])
      expect(child.originWaypointId).toBe(a.id)
      expect(listByFeature(ctx, featureId).find((w) => w.id === child.id)?.originWaypointId).toBe(
        a.id,
      )
    })

    it('emits a single waypoints.stored event per batch', () => {
      storeWaypoints(ctx, featureId, [wp('a'), wp('b')])
      const stored = listAfter(ctx, featureId, 0).filter((e) => e.type === 'waypoints.stored')
      expect(stored).toHaveLength(1)
    })
  })

  describe('frontier — derived, cascading', () => {
    it('includes only open, unclaimed, all-blockers-terminal waypoints', () => {
      const [a, b] = storeWaypoints(ctx, featureId, [wp('a'), wp('b', [1])])
      // a is open with no blockers → frontier; b is blocked by a → not frontier
      expect(frontier(ctx, featureId).map((w) => w.id)).toEqual([a.id])
      // resolving a frees b
      resolve(ctx, a.id, 'resolved', 'done a')
      expect(frontier(ctx, featureId).map((w) => w.id)).toEqual([b.id])
    })

    it('treats a dropped blocker as terminal (frees dependents)', () => {
      const [a, b] = storeWaypoints(ctx, featureId, [wp('a'), wp('b', [1])])
      resolve(ctx, a.id, 'dropped', 'not needed')
      expect(frontier(ctx, featureId).map((w) => w.id)).toEqual([b.id])
    })

    it('holds a waypoint back until ALL blockers are terminal', () => {
      const [a, b, c] = storeWaypoints(ctx, featureId, [wp('a'), wp('b'), wp('c', [1, 2])])
      resolve(ctx, a.id, 'resolved', 'a')
      expect(frontier(ctx, featureId).map((w) => w.id)).not.toContain(c.id)
      resolve(ctx, b.id, 'resolved', 'b')
      expect(frontier(ctx, featureId).map((w) => w.id)).toContain(c.id)
    })

    it('excludes a claimed waypoint from the frontier', () => {
      const [a] = storeWaypoints(ctx, featureId, [wp('a')])
      claim(ctx, a.id, 'sess_1')
      expect(frontier(ctx, featureId)).toHaveLength(0)
    })
  })

  describe('claim — transactional', () => {
    it('claims an open frontier waypoint, recording claimedBy (lastSessionId waits for live)', () => {
      const [a] = storeWaypoints(ctx, featureId, [wp('a')])
      const claimed = claim(ctx, a.id, 'sess_1')
      expect(claimed.status).toBe('claimed')
      expect(claimed.claimedBy).toBe('sess_1')
      // a claim is only an attempt — lastSessionId is promoted when the session
      // actually goes live, so a dead-on-arrival resume never clobbers it
      expect(claimed.lastSessionId).toBeUndefined()
    })

    it('promotes lastSessionId only once the claiming session goes live', () => {
      const [a] = storeWaypoints(ctx, featureId, [wp('a')])
      claim(ctx, a.id, 'sess_1')
      promoteLastSession(ctx, 'sess_1')
      expect(getWaypoint(ctx, a.id).lastSessionId).toBe('sess_1')
      // a claimant holding nothing is a no-op
      promoteLastSession(ctx, 'sess_nobody')
      expect(getWaypoint(ctx, a.id).lastSessionId).toBe('sess_1')
    })

    it('fails a double-claim', () => {
      const [a] = storeWaypoints(ctx, featureId, [wp('a')])
      claim(ctx, a.id, 'sess_1')
      expect(() => claim(ctx, a.id, 'sess_2')).toThrow(GateError)
    })

    it('refuses to claim a blocked (non-frontier) waypoint', () => {
      const [, b] = storeWaypoints(ctx, featureId, [wp('a'), wp('b', [1])])
      expect(() => claim(ctx, b.id, 'sess_1')).toThrow(GateError)
    })
  })

  describe('release — back to open, keeps last session', () => {
    it('returns the waypoint to open while keeping lastSessionId', () => {
      const [a] = storeWaypoints(ctx, featureId, [wp('a')])
      claim(ctx, a.id, 'sess_1')
      promoteLastSession(ctx, 'sess_1') // the session went live before dying
      const released = release(ctx, a.id)
      expect(released.status).toBe('open')
      expect(released.claimedBy).toBeUndefined()
      expect(released.lastSessionId).toBe('sess_1')
      // back on the frontier, re-claimable
      expect(frontier(ctx, featureId).map((w) => w.id)).toContain(a.id)
      expect(() => claim(ctx, a.id, 'sess_2')).not.toThrow()
    })
  })

  describe('resolve — flip, summary, cascade events', () => {
    it('stores the summary and emits waypoint.resolved', () => {
      const [a] = storeWaypoints(ctx, featureId, [wp('a')])
      const done = resolve(ctx, a.id, 'resolved', 'the answer')
      expect(done.status).toBe('resolved')
      expect(done.summary).toBe('the answer')
      const ev = listAfter(ctx, featureId, 0).find((e) => e.type === 'waypoint.resolved')
      expect(ev?.message).toContain('resolved')
    })

    it('emits one waypoint.unblocked per newly-freed dependent', () => {
      // a blocks b and c; both freed when a resolves
      const [a] = storeWaypoints(ctx, featureId, [wp('a'), wp('b', [1]), wp('c', [1])])
      resolve(ctx, a.id, 'resolved', 'a done')
      const unblocked = listAfter(ctx, featureId, 0).filter((e) => e.type === 'waypoint.unblocked')
      expect(unblocked).toHaveLength(2)
    })

    it('does not emit unblocked for a dependent still blocked by another waypoint', () => {
      const [a] = storeWaypoints(ctx, featureId, [wp('a'), wp('b'), wp('c', [1, 2])])
      resolve(ctx, a.id, 'resolved', 'a done')
      // c still blocked by b → no unblocked event yet
      const unblocked = listAfter(ctx, featureId, 0).filter((e) => e.type === 'waypoint.unblocked')
      expect(unblocked).toHaveLength(0)
    })

    it('refuses to resolve a waypoint that is already terminal', () => {
      const [a] = storeWaypoints(ctx, featureId, [wp('a')])
      resolve(ctx, a.id, 'resolved', 'the answer')

      expect(() => resolve(ctx, a.id, 'resolved', 'a different answer')).toThrow(InvalidInputError)
      expect(() => resolve(ctx, a.id, 'dropped', 'actually out of scope')).toThrow(
        InvalidInputError,
      )
      // The settled summary and its cascade stand — nothing was rewritten or re-emitted.
      expect(getWaypoint(ctx, a.id).summary).toBe('the answer')
      expect(listAfter(ctx, featureId, 0).filter((e) => e.type === 'waypoint.resolved')).toHaveLength(
        1,
      )
    })

    it('refuses to resolve an unknown waypoint', () => {
      expect(() => resolve(ctx, 'wpt_missing', 'resolved', 'nothing')).toThrow(NotFoundError)
    })
  })

  describe('feature query integration', () => {
    it('returns waypoints + frontierIds for a mapped feature', () => {
      const [a, b] = storeWaypoints(ctx, featureId, [wp('a'), wp('b', [1])])
      const full = getFeatureFull(ctx, featureId)
      expect(full.waypoints.map((w) => w.id)).toEqual([a.id, b.id])
      expect(full.frontierIds).toEqual([a.id])
    })

    it('returns empty waypoints + frontier for an unmapped feature', () => {
      const plain = seedFeature(ctx, seedProject(ctx).id, { slug: 'plain', mapped: false })
      const full = getFeatureFull(ctx, plain.id)
      expect(full.waypoints).toEqual([])
      expect(full.frontierIds).toEqual([])
    })
  })

  it('listByFeature orders by seq', () => {
    storeWaypoints(ctx, featureId, [wp('a'), wp('b'), wp('c')])
    expect(listByFeature(ctx, featureId).map((w) => w.seq)).toEqual([1, 2, 3])
  })
})
