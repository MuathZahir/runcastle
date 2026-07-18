import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { emit, emitProject, listAfter, listByProject } from '../src/services/events'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

describe('events service', () => {
  let ctx: AppCtx
  let projectId: string
  let featureId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    projectId = seedProject(ctx).id
    featureId = seedFeature(ctx, projectId).id
  })

  it('lists events oldest-first and honours the afterId cursor', () => {
    const e1 = emit(ctx, featureId, { type: 'a', message: 'one' })
    const e2 = emit(ctx, featureId, { type: 'b', message: 'two' })
    const e3 = emit(ctx, featureId, { type: 'c', message: 'three' })

    expect(e1.id).toBeLessThan(e2.id)
    expect(e2.id).toBeLessThan(e3.id)

    const all = listAfter(ctx, featureId, 0)
    expect(all.map((e) => e.message)).toEqual(['one', 'two', 'three'])

    const afterFirst = listAfter(ctx, featureId, e1.id)
    expect(afterFirst.map((e) => e.id)).toEqual([e2.id, e3.id])

    const afterSecond = listAfter(ctx, featureId, e2.id)
    expect(afterSecond.map((e) => e.id)).toEqual([e3.id])

    expect(listAfter(ctx, featureId, e3.id)).toEqual([])
  })

  it('scopes events to their feature', () => {
    const otherFeatureId = seedFeature(ctx, seedProject(ctx).id, { slug: 'other' }).id
    emit(ctx, featureId, { type: 'a', message: 'mine' })
    emit(ctx, otherFeatureId, { type: 'a', message: 'theirs' })

    expect(listAfter(ctx, featureId, 0).map((e) => e.message)).toEqual(['mine'])
    expect(listAfter(ctx, otherFeatureId, 0).map((e) => e.message)).toEqual(['theirs'])
  })

  it('round-trips optional runId / ticketId / data', () => {
    const e = emit(ctx, featureId, {
      type: 'x',
      message: 'm',
      runId: 'run_1',
      ticketId: 'tkt_1',
      data: { n: 42 },
    })
    const [stored] = listAfter(ctx, featureId, e.id - 1)
    expect(stored.runId).toBe('run_1')
    expect(stored.ticketId).toBe('tkt_1')
    expect(stored.data).toEqual({ n: 42 })
  })

  it('stamps every feature event with its project id', () => {
    const e = emit(ctx, featureId, { type: 'a', message: 'one' })
    expect(e.projectId).toBe(projectId)
    expect(e.featureId).toBe(featureId)
  })

  it('emits project-level events with a project id and no feature id', () => {
    const e = emitProject(ctx, projectId, { type: 'project.opened', message: 'opened' })
    expect(e.projectId).toBe(projectId)
    expect(e.featureId).toBeUndefined()
  })

  it('lists a project stream of feature AND project-level events, cursor honoured', () => {
    const p = emitProject(ctx, projectId, { type: 'project.opened', message: 'opened' })
    const f = emit(ctx, featureId, { type: 'feature.created', message: 'created' })
    const r = emitProject(ctx, projectId, { type: 'project.renamed', message: 'renamed' })

    const all = listByProject(ctx, projectId, 0)
    expect(all.map((e) => e.message)).toEqual(['opened', 'created', 'renamed'])

    const afterFirst = listByProject(ctx, projectId, p.id)
    expect(afterFirst.map((e) => e.id)).toEqual([f.id, r.id])

    expect(listByProject(ctx, projectId, r.id)).toEqual([])
  })

  it('scopes the project stream to its project', () => {
    const otherProjectId = seedProject(ctx).id
    const otherFeatureId = seedFeature(ctx, otherProjectId, { slug: 'other' }).id

    emit(ctx, featureId, { type: 'a', message: 'mine-feature' })
    emitProject(ctx, projectId, { type: 'project.renamed', message: 'mine-project' })
    emit(ctx, otherFeatureId, { type: 'a', message: 'theirs-feature' })
    emitProject(ctx, otherProjectId, { type: 'project.renamed', message: 'theirs-project' })

    expect(listByProject(ctx, projectId, 0).map((e) => e.message)).toEqual([
      'mine-feature',
      'mine-project',
    ])
    expect(listByProject(ctx, otherProjectId, 0).map((e) => e.message)).toEqual([
      'theirs-feature',
      'theirs-project',
    ])
  })
})
