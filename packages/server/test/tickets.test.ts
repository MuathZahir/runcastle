import type { TicketInput } from '@runcastle/core'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { InvalidInputError } from '../src/errors'
import { listByFeature, storeTickets, updateTicket } from '../src/services/tickets'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

function ticket(title: string, blockedBy: number[] = []): TicketInput {
  return { title, goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy }
}

describe('tickets service', () => {
  let ctx: AppCtx
  let featureId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const project = seedProject(ctx)
    featureId = seedFeature(ctx, project.id).id
  })

  it('assigns sequential seq numbers per feature, continuing across batches', () => {
    const first = storeTickets(ctx, featureId, [ticket('a'), ticket('b'), ticket('c')])
    expect(first.map((t) => t.seq)).toEqual([1, 2, 3])

    const second = storeTickets(ctx, featureId, [ticket('d'), ticket('e')])
    expect(second.map((t) => t.seq)).toEqual([4, 5])

    expect(listByFeature(ctx, featureId).map((t) => t.seq)).toEqual([1, 2, 3, 4, 5])
  })

  it('resolves batch-local blockedBy positions to assigned global seq', () => {
    // fresh feature: positions == global seq
    const fresh = storeTickets(ctx, featureId, [ticket('a'), ticket('b', [1]), ticket('c', [1, 2])])
    expect(fresh[1].blockedBy).toEqual([1])
    expect(fresh[2].blockedBy).toEqual([1, 2])

    // with two existing tickets on another feature, positions offset onto
    // global seq
    const other = seedFeature(ctx, seedProject(ctx).id, { slug: 'other' }).id
    storeTickets(ctx, other, [ticket('x'), ticket('y')]) // seq 1,2
    const batch = storeTickets(ctx, other, [ticket('z'), ticket('w', [1])]) // seq 3,4
    expect(batch.map((t) => t.seq)).toEqual([3, 4])
    expect(batch[1].blockedBy).toEqual([3]) // position 1 -> global seq 3
  })

  it('throws on an out-of-range blockedBy position', () => {
    expect(() => storeTickets(ctx, featureId, [ticket('a'), ticket('b', [5])])).toThrow(
      InvalidInputError,
    )
  })

  it('throws on a self-referencing blockedBy position', () => {
    expect(() => storeTickets(ctx, featureId, [ticket('a', [1])])).toThrow(InvalidInputError)
  })

  it('updateTicket patches status/commits/error and emits', () => {
    const [t] = storeTickets(ctx, featureId, [ticket('a')])
    const updated = updateTicket(ctx, t.id, { status: 'done', commits: ['abc123'] })
    expect(updated.status).toBe('done')
    expect(updated.commits).toEqual(['abc123'])
  })
})
