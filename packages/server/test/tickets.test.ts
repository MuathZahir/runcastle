import type { TicketInput } from '@runcastle/core'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { InvalidInputError } from '../src/errors'
import { listAfter } from '../src/services/events'
import { cancelTicket, editTicket, listByFeature, storeTickets, sweepOrphanedBurning, updateTicket } from '../src/services/tickets'
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

  it('stores a batch mixing kinds, defaulting to implementation, with blockedBy resolved', () => {
    const stored = storeTickets(ctx, featureId, [
      ticket('build the thing'),
      { ...ticket('build the other thing'), kind: 'implementation' },
      // The review ticket is ordered last purely as data: it is blocked by both
      // implementation tickets, exactly like any other dependent ticket.
      { ...ticket('verify the integrated result', [1, 2]), kind: 'review' },
    ])

    expect(stored.map((t) => t.kind)).toEqual(['implementation', 'implementation', 'review'])

    const read = listByFeature(ctx, featureId)
    expect(read.map((t) => [t.seq, t.kind])).toEqual([
      [1, 'implementation'],
      [2, 'implementation'],
      [3, 'review'],
    ])
    expect(read[2].blockedBy).toEqual([1, 2])
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
    expect(updated.completedAt).toEqual(expect.any(Number))
  })

  it('timestamps every terminal service path and clears the stamp on retry', () => {
    const [done, failed, cancelled, orphaned] = storeTickets(ctx, featureId, [
      ticket('done'), ticket('failed'), ticket('cancelled'), ticket('orphaned'),
    ])
    expect(done).toMatchObject({ passKind: 'review', reviewedCommit: null, completedAt: null })
    expect(updateTicket(ctx, done.id, { status: 'done' }).completedAt).toEqual(expect.any(Number))
    expect(updateTicket(ctx, failed.id, { status: 'failed' }).completedAt).toEqual(expect.any(Number))
    expect(cancelTicket(ctx, cancelled.id).completedAt).toEqual(expect.any(Number))
    updateTicket(ctx, orphaned.id, { status: 'burning' })
    expect(sweepOrphanedBurning(ctx, featureId, 'lost agent')[0].completedAt).toEqual(expect.any(Number))
    expect(updateTicket(ctx, failed.id, { status: 'pending' }).completedAt).toBeNull()
  })

  it('updateTicket stores a digest that round-trips through listByFeature', () => {
    const [t] = storeTickets(ctx, featureId, [ticket('a')])
    expect(t.digest).toBeUndefined()

    updateTicket(ctx, t.id, { status: 'done', digest: 'Did the thing.\n\nNo surprises.' })

    const [stored] = listByFeature(ctx, featureId)
    expect(stored.digest).toBe('Did the thing.\n\nNo surprises.')
  })

  it('updateTicket clears a stored error with error: null (burn-retry path)', () => {
    const [t] = storeTickets(ctx, featureId, [ticket('a')])
    updateTicket(ctx, t.id, { status: 'failed', error: 'agent made no commits' })
    const retried = updateTicket(ctx, t.id, { status: 'pending', error: null })
    expect(retried.status).toBe('pending')
    expect(retried.error).toBeUndefined()
  })

  it('editTicket rewrites content on pending and failed tickets only', () => {
    const [a, b] = storeTickets(ctx, featureId, [ticket('a'), ticket('b')])

    const edited = editTicket(ctx, a.id, { title: 'a2', acceptanceCriteria: ['new'] })
    expect(edited.title).toBe('a2')
    expect(edited.acceptanceCriteria).toEqual(['new'])
    expect(edited.goal).toBe('g') // untouched fields survive

    updateTicket(ctx, b.id, { status: 'failed', error: 'x' })
    expect(editTicket(ctx, b.id, { goal: 'g2' }).goal).toBe('g2')
  })

  it('editTicket refuses done/burning/cancelled tickets and empty patches', () => {
    const [t] = storeTickets(ctx, featureId, [ticket('a')])
    expect(() => editTicket(ctx, t.id, {})).toThrow(InvalidInputError)

    updateTicket(ctx, t.id, { status: 'burning' })
    expect(() => editTicket(ctx, t.id, { title: 'x' })).toThrow(InvalidInputError)
    updateTicket(ctx, t.id, { status: 'done' })
    expect(() => editTicket(ctx, t.id, { title: 'x' })).toThrow(InvalidInputError)
    updateTicket(ctx, t.id, { status: 'cancelled' })
    expect(() => editTicket(ctx, t.id, { title: 'x' })).toThrow(InvalidInputError)
  })

  it('stores a per-ticket model assignment, leaving unassigned tickets blank', () => {
    const stored = storeTickets(ctx, featureId, [
      { ...ticket('mechanical refactor'), model: 'gpt-5.6-sol' },
      ticket('taste work'),
    ])
    expect(stored.map((t) => t.model)).toEqual(['gpt-5.6-sol', undefined])
    expect(listByFeature(ctx, featureId).map((t) => t.model)).toEqual(['gpt-5.6-sol', undefined])
  })

  it('storeTickets rejects a model the roster does not offer, storing nothing', () => {
    expect(() =>
      storeTickets(ctx, featureId, [ticket('a'), { ...ticket('b'), model: 'gpt-9-imaginary' }]),
    ).toThrow(InvalidInputError)
    expect(listByFeature(ctx, featureId)).toEqual([])
  })

  it('storeTickets accepts an operator-added roster entry, not just a curated one', () => {
    ctx.config = { ...ctx.config, models: [{ id: 'my-proxy-model', runtime: 'codex' }] }
    const [stored] = storeTickets(ctx, featureId, [
      { ...ticket('a'), model: 'my-proxy-model' },
    ])
    expect(stored.model).toBe('my-proxy-model')
  })

  it('editTicket reassigns and clears the model, emitting the change', () => {
    const [t] = storeTickets(ctx, featureId, [{ ...ticket('a'), model: 'gpt-5.6-sol' }])

    expect(editTicket(ctx, t.id, { model: 'claude-opus-5' }).model).toBe('claude-opus-5')
    // Blank clears the assignment: the ticket falls back to the default chain.
    expect(editTicket(ctx, t.id, { model: '' }).model).toBeUndefined()

    const edits = listAfter(ctx, featureId).filter((e) => e.type === 'ticket.edited')
    expect(edits.map((e) => (e.data as { fields: string[] }).fields)).toEqual([
      ['model'],
      ['model'],
    ])
  })

  it('editTicket rejects an unknown model and refuses a burning ticket', () => {
    const [t] = storeTickets(ctx, featureId, [ticket('a')])
    expect(() => editTicket(ctx, t.id, { model: 'gpt-9-imaginary' })).toThrow(InvalidInputError)

    updateTicket(ctx, t.id, { status: 'burning' })
    expect(() => editTicket(ctx, t.id, { model: 'claude-opus-5' })).toThrow(InvalidInputError)
  })

  it('cancelTicket marks pending/failed tickets cancelled with the reason', () => {
    const [a, b] = storeTickets(ctx, featureId, [ticket('a'), ticket('b')])

    const cancelled = cancelTicket(ctx, a.id, 'superseded by revisit')
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.error).toBe('superseded by revisit')

    updateTicket(ctx, b.id, { status: 'failed', error: 'x' })
    expect(cancelTicket(ctx, b.id).status).toBe('cancelled')
  })

  it('cancelTicket refuses done/burning tickets', () => {
    const [a, b] = storeTickets(ctx, featureId, [ticket('a'), ticket('b')])
    updateTicket(ctx, a.id, { status: 'done' })
    expect(() => cancelTicket(ctx, a.id)).toThrow(InvalidInputError)
    updateTicket(ctx, b.id, { status: 'burning' })
    expect(() => cancelTicket(ctx, b.id)).toThrow(InvalidInputError)
  })
})
