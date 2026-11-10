import { HELD_NEED_GRACE_MS } from '@runcastle/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listAfter } from '../src/services/events'
import { markHumanMessage, setWaiting } from '../src/services/features'
import { setHandback } from '../src/services/lead-status'
import { emit } from '../src/services/events'
import { FEATURE_NEEDS_YOU, NEED_SETTLE_MS, startNeedWatch, type NeedWatch } from '../src/services/need-watch'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * you-always-know-what-s-waiting ticket 1: `feature.needs_you` is emitted once
 * when a feature enters a need, once more when a held need passes its hour,
 * and never on a re-read, an unchanged need, or at boot.
 */

let ctx: AppCtx
let projectId: string
let watch: NeedWatch | undefined
let clock = Date.now()

const settle = () => new Promise((r) => setTimeout(r, NEED_SETTLE_MS * 3))
const pings = (featureId: string) => listAfter(ctx, featureId).filter((e) => e.type === FEATURE_NEEDS_YOU)

beforeEach(async () => {
  ctx = await makeTestCtx()
  projectId = seedProject(ctx).id
  clock = Date.now()
})

afterEach(() => {
  watch?.stop()
  watch = undefined
})

describe('the needs watcher', () => {
  it('emits once when a feature enters a need, and not again while it stands', async () => {
    const f = seedFeature(ctx, projectId)
    watch = startNeedWatch(ctx, { now: () => clock })
    setWaiting(ctx, f.id, 'which model?')
    await settle()
    expect(pings(f.id).map((e) => e.data)).toEqual([
      { kind: 'answer', words: 'Needs your answer · which model?', held: false, why: 'which model?' },
    ])

    // The same need read again, after more events and a sweep, is no news.
    setWaiting(ctx, f.id, 'which model, really?')
    watch.sweep()
    await settle()
    expect(pings(f.id)).toHaveLength(1)

    // A different need is.
    setWaiting(ctx, f.id, 'start round 1?', 'plan')
    await settle()
    expect(pings(f.id).map((e) => (e.data as { kind: string }).kind)).toEqual(['answer', 'plan'])
  })

  it('emits again when the feature needs something after needing nothing', async () => {
    const f = seedFeature(ctx, projectId)
    watch = startNeedWatch(ctx, { now: () => clock })
    setWaiting(ctx, f.id, 'go?', 'plan')
    await settle()
    markHumanMessage(ctx, f.id)
    await settle()
    setWaiting(ctx, f.id, 'go?', 'plan')
    await settle()
    expect(pings(f.id)).toHaveLength(2)
  })

  it('emits nothing at boot for a need that already stood', async () => {
    const f = seedFeature(ctx, projectId)
    setWaiting(ctx, f.id, 'go?', 'plan')
    watch = startNeedWatch(ctx, { now: () => clock })
    watch.sweep()
    await settle()
    expect(pings(f.id)).toHaveLength(0)
  })

  it('emits a held handback on entering it, and once more when its hour passes', async () => {
    const f = seedFeature(ctx, projectId, { heldBy: 'sess_orchestrator' })
    watch = startNeedWatch(ctx, { now: () => clock })
    setHandback(ctx, f.id, 'Ready to merge.', clock)
    emit(ctx, f.id, { type: 'lead.handed_back', message: 'handed back' })
    await settle()
    expect(pings(f.id).map((e) => e.data)).toEqual([
      { kind: 'handback', words: 'With the orchestrator · Ready to merge', held: true, why: 'Ready to merge' },
    ])

    watch.sweep()
    expect(pings(f.id)).toHaveLength(1)

    clock += HELD_NEED_GRACE_MS + 60_000
    watch.sweep()
    watch.sweep()
    expect(pings(f.id).map((e) => e.data)).toEqual([
      { kind: 'handback', words: 'With the orchestrator · Ready to merge', held: true, why: 'Ready to merge' },
      { kind: 'handback', words: 'Handed back · Ready to merge', held: false, why: 'Ready to merge' },
    ])
  })

  it('pings a plan on a held feature with no handback at once (the-status-tells-the-truth decision 1)', async () => {
    const f = seedFeature(ctx, projectId, { heldBy: 'sess_orchestrator' })
    watch = startNeedWatch(ctx, { now: () => clock })
    setWaiting(ctx, f.id, 'go?', 'plan')
    await settle()
    expect(pings(f.id).map((e) => e.data)).toEqual([{ kind: 'plan', words: 'Plan to approve', held: false, why: null }])
  })
})
