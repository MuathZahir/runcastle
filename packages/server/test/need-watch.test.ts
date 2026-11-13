import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { createSessionRow } from '../src/launcher/sessions'
import { listAfter, listByProject } from '../src/services/events'
import { FEATURE_NEEDS_YOU, NEED_SETTLE_MS, startNeedWatch, type NeedWatch } from '../src/services/need-watch'
import { clearWait, setWait } from '../src/services/waits'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Needs you is the agent's call, decision 14: `feature.needs_you` is emitted
 * once each time a chat enters a need — a lead, a worker, an orchestrator
 * chat — carrying its line, its thread and its feature if any; never on a
 * re-read, an unchanged need, or at boot.
 */

let ctx: AppCtx
let projectId: string
let watch: NeedWatch | undefined

const settle = () => new Promise((r) => setTimeout(r, NEED_SETTLE_MS * 3))
const pings = (featureId: string) => listAfter(ctx, featureId).filter((e) => e.type === FEATURE_NEEDS_YOU)

beforeEach(async () => {
  ctx = await makeTestCtx()
  projectId = seedProject(ctx).id
})

afterEach(() => {
  watch?.stop()
  watch = undefined
})

describe('the needs watcher', () => {
  it('emits once when a lead’s chat enters a need, with its line, thread and feature', async () => {
    const f = seedFeature(ctx, projectId)
    const lead = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: '/wt' }).id
    watch = startNeedWatch(ctx)
    setWait(ctx, lead, 'Which model?')
    await settle()
    expect(pings(f.id).map((e) => e.data)).toEqual([{ why: 'Which model?', threadId: lead, by: 'agent', featureId: f.id }])
    // Nothing new, nothing more.
    await settle()
    expect(pings(f.id)).toHaveLength(1)
  })

  it('emits for every new wait, even a replacement in the same words, and once per worker', async () => {
    const f = seedFeature(ctx, projectId)
    const lead = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: '/wt' }).id
    const worker = createSessionRow(ctx, { featureId: f.id, kind: 'worker', worktreePath: '/wt' }).id
    watch = startNeedWatch(ctx)
    setWait(ctx, lead, 'Go?')
    await settle()
    await new Promise((r) => setTimeout(r, 2))
    setWait(ctx, lead, 'Go?')
    setWait(ctx, worker, 'Is the key in the vault?')
    await settle()
    expect(pings(f.id).map((e) => (e.data as { threadId: string }).threadId)).toEqual([lead, lead, worker])
  })

  it('emits again when a chat needs something after needing nothing', async () => {
    const f = seedFeature(ctx, projectId)
    const lead = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: '/wt' }).id
    watch = startNeedWatch(ctx)
    setWait(ctx, lead, 'Go?')
    await settle()
    clearWait(ctx, lead, 'human')
    await settle()
    setWait(ctx, lead, 'Go?')
    await settle()
    expect(pings(f.id)).toHaveLength(2)
  })

  it('emits nothing at boot for a need that already stood', async () => {
    const f = seedFeature(ctx, projectId)
    const lead = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: '/wt' }).id
    setWait(ctx, lead, 'Go?')
    watch = startNeedWatch(ctx)
    await settle()
    expect(pings(f.id)).toHaveLength(0)
  })

  it('emits an orchestrator chat’s own need on its project, with no feature', async () => {
    const epic = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: '/wt' }).id
    watch = startNeedWatch(ctx)
    setWait(ctx, epic, 'Start the batch?')
    await settle()
    expect(listByProject(ctx, projectId).filter((e) => e.type === FEATURE_NEEDS_YOU).map((e) => e.data)).toEqual([
      { why: 'Start the batch?', threadId: epic, by: 'agent', featureId: null },
    ])
  })
})
