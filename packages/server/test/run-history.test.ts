import type { Feature, Project } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { features, runs } from '../src/db/schema'
import { emit } from '../src/services/events'
import { storeTickets, updateTicket } from '../src/services/tickets'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Run history and the burn-time expectation (decisions #15b, #16b) — both reads
 * over what a burn already wrote, so what has to be right here is the join.
 *
 * `run.listByFeature` and `run.get` reconstruct a past run's lanes from its own
 * events plus the ticket ledger, with no new persistence; `ticket.durationStats`
 * is the project's median ticket duration off the `ticket.timing` events the
 * burner emits on every exit path.
 */

type Caller = ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>

const ticketInput = (title: string, over: { kind?: 'implementation' | 'review' } = {}) => ({
  title,
  goal: 'do it',
  context: '',
  acceptanceCriteria: [],
  seams: [],
  blockedBy: [],
  ...over,
})

/** A run row as `startRun` writes one — the workflow itself stays out of this. */
function seedRun(
  ctx: AppCtx,
  featureId: string,
  over: { status?: 'running' | 'succeeded' | 'failed' | 'cancelled'; startedAt?: number } = {},
): string {
  const id = newId('run')
  ctx.db
    .insert(runs)
    .values({
      id,
      featureId,
      workflow: 'ticket-burner',
      status: over.status ?? 'succeeded',
      startedAt: over.startedAt ?? Date.now(),
      endedAt: (over.startedAt ?? Date.now()) + 60_000,
      summary: null,
    })
    .run()
  return id
}

describe('run history', () => {
  let ctx: AppCtx
  let caller: Caller
  let project: Project
  let feature: Feature

  beforeEach(async () => {
    ctx = await makeTestCtx()
    caller = createCallerFactory(appRouter)(ctx)
    project = seedProject(ctx)
    feature = seedFeature(ctx, project.id, { phase: 'implementation' })
  })

  it('lists a feature runs newest first, with the lap and the tickets each burned', async () => {
    const [first, second] = storeTickets(ctx, feature.id, [
      ticketInput('the first'),
      ticketInput('the second'),
    ])

    const lapOne = seedRun(ctx, feature.id, { startedAt: 1_000 })
    emit(ctx, feature.id, { type: 'ticket.burning', message: 'burning', runId: lapOne, ticketId: first.id })

    ctx.db.update(features).set({ lap: 2 }).where(eq(features.id, feature.id)).run()
    const lapTwo = seedRun(ctx, feature.id, { startedAt: 2_000 })
    emit(ctx, feature.id, { type: 'ticket.burning', message: 'burning', runId: lapTwo, ticketId: second.id })

    const list = await caller.run.listByFeature({ featureId: feature.id })
    expect(list.map((r) => r.id)).toEqual([lapTwo, lapOne])
    expect(list[0].lap).toBe(2)
    expect(list[0].ticketIds).toEqual([second.id])
    expect(list[1].lap).toBe(1)
    expect(list[1].ticketIds).toEqual([first.id])
  })

  /**
   * The whole point of the record: a run that finished carries the lanes IT had,
   * not the feature's ledger as it stands now — which by then has grown the next
   * lap's tickets.
   */
  it('returns a past run with only the tickets it burned, in ledger order', async () => {
    const [first, second, later] = storeTickets(ctx, feature.id, [
      ticketInput('the first'),
      ticketInput('the second'),
      ticketInput('minted afterwards'),
    ])
    const runId = seedRun(ctx, feature.id)
    // Emitted out of ledger order — the record still reads by `seq`.
    emit(ctx, feature.id, { type: 'ticket.burning', message: 'b', runId, ticketId: second.id })
    emit(ctx, feature.id, { type: 'burn.text', message: 'output', runId, ticketId: second.id })
    emit(ctx, feature.id, { type: 'ticket.burning', message: 'b', runId, ticketId: first.id })

    const record = await caller.run.get({ runId })
    expect(record.status).toBe('succeeded')
    expect(record.tickets.map((t) => t.id)).toEqual([first.id, second.id])
    expect(record.tickets.map((t) => t.id)).not.toContain(later.id)
  })

  it('reports a run with no ticket events as an empty record rather than failing', async () => {
    const runId = seedRun(ctx, feature.id, { status: 'failed' })
    emit(ctx, feature.id, { type: 'run.started', message: 'run started', runId })
    expect((await caller.run.get({ runId })).tickets).toEqual([])
    const list = await caller.run.listByFeature({ featureId: feature.id })
    expect(list[0].ticketIds).toEqual([])
  })
})

describe('ticket.durationStats', () => {
  let ctx: AppCtx
  let caller: Caller
  let project: Project
  let feature: Feature

  beforeEach(async () => {
    ctx = await makeTestCtx()
    caller = createCallerFactory(appRouter)(ctx)
    project = seedProject(ctx)
    feature = seedFeature(ctx, project.id, { phase: 'implementation' })
  })

  const timing = (ticketId: string, wallMs: number) =>
    emit(ctx, feature.id, { type: 'ticket.timing', message: 'timing', ticketId, data: { wallMs } })

  it('reports no sample before anything has burned', async () => {
    expect(await caller.ticket.durationStats({ projectId: project.id })).toEqual({
      medianMs: 0,
      sampleSize: 0,
    })
  })

  it('medians the done implementation tickets, ignoring failed lanes and review passes', async () => {
    const [a, b, c, failed, review] = storeTickets(ctx, feature.id, [
      ticketInput('a'),
      ticketInput('b'),
      ticketInput('c'),
      ticketInput('gave up'),
      ticketInput('review the lap', { kind: 'review' }),
    ])
    for (const t of [a, b, c, review]) updateTicket(ctx, t.id, { status: 'done' })
    updateTicket(ctx, failed.id, { status: 'failed', error: 'agent made no commits' })

    timing(a.id, 60_000)
    timing(b.id, 120_000)
    timing(c.id, 300_000)
    timing(failed.id, 5_000)
    timing(review.id, 900_000)

    expect(await caller.ticket.durationStats({ projectId: project.id })).toEqual({
      medianMs: 120_000,
      sampleSize: 3,
    })
  })

  /** A re-burned ticket has several timings; only its last execution counts. */
  it('takes the last timing of a ticket burned more than once, and averages an even sample', async () => {
    const [a, b] = storeTickets(ctx, feature.id, [ticketInput('a'), ticketInput('b')])
    for (const t of [a, b]) updateTicket(ctx, t.id, { status: 'done' })
    timing(a.id, 600_000)
    timing(a.id, 100_000)
    timing(b.id, 200_000)

    expect(await caller.ticket.durationStats({ projectId: project.id })).toEqual({
      medianMs: 150_000,
      sampleSize: 2,
    })
  })

  it('does not count another project tickets', async () => {
    const other = seedProject(ctx)
    const otherFeature = seedFeature(ctx, other.id, { slug: 'other' })
    const [mine] = storeTickets(ctx, feature.id, [ticketInput('mine')])
    const [theirs] = storeTickets(ctx, otherFeature.id, [ticketInput('theirs')])
    updateTicket(ctx, mine.id, { status: 'done' })
    updateTicket(ctx, theirs.id, { status: 'done' })
    timing(mine.id, 90_000)
    emit(ctx, otherFeature.id, {
      type: 'ticket.timing',
      message: 'timing',
      ticketId: theirs.id,
      data: { wallMs: 900_000 },
    })

    expect(await caller.ticket.durationStats({ projectId: project.id })).toEqual({
      medianMs: 90_000,
      sampleSize: 1,
    })
  })
})
