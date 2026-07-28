import type { WorkflowDef } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runs, tickets } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { createSessionRow, markSessionEnded } from '../src/launcher/sessions'
import { listAfter } from '../src/services/events'
import { burn, rethink } from '../src/services/features'
import { checkGate } from '../src/services/gates'
import { getFeatureRow } from '../src/services/repo'
import { listByFeature, storeTickets, updateTicket } from '../src/services/tickets'
import { workflowRegistry } from '../src/workflows/registry'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Rethink — the review → ideation loop that starts lap N+1 (ADR-0010 §1,
 * SPEC §15.2), plus the lap scoping it makes necessary on G3 and the Fix burn.
 *
 * Driven through the SERVICE, not the tRPC proc: `feature.rethink` launches a
 * terminal, and `launchSession` is B1 behaviour that needs a real worktree, so
 * the proc is not a unit-testable seam (the same reason `burn-from-review` and
 * `converge` test where they do).
 */

const stubBurner: WorkflowDef = {
  id: 'ticket-burner',
  async run() {
    return { status: 'succeeded', summary: 'stub' }
  },
}

function ticketInput(title: string) {
  return { title, goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy: [] }
}

/**
 * Backdate a ticket to an earlier lap. `storeTickets` stamps the feature's
 * CURRENT lap, so a feature seeded straight onto lap 2 has no other way to
 * carry the leftovers of a lap it never actually ran.
 */
function setTicketLap(ctx: AppCtx, ticketId: string, lap: number): void {
  ctx.db.update(tickets).set({ lap }).where(eq(tickets.id, ticketId)).run()
}

describe('rethink service — the lap N+1 transition', () => {
  let ctx: AppCtx

  beforeEach(async () => {
    ctx = await makeTestCtx()
  })

  it('from review: increments the lap, returns to ideation, emits lap.started', () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review' }).id

    const after = rethink(ctx, featureId)

    expect(after.lap).toBe(2)
    expect(after.phase).toBe('ideation')
    const row = getFeatureRow(ctx, featureId)
    expect(row.lap).toBe(2)
    expect(row.phase).toBe('ideation')

    const started = listAfter(ctx, featureId, 0).find((e) => e.type === 'lap.started')
    expect(started?.message).toBe('rethink — lap 2')
    expect(started?.data).toMatchObject({ from: 'review', to: 'ideation' })
  })

  it('laps accumulate — a second rethink from review lands on lap 3', () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review', lap: 2 }).id
    expect(rethink(ctx, featureId).lap).toBe(3)
  })

  it('refuses from any other phase, naming it, and changes nothing', () => {
    for (const phase of ['ideation', 'spec', 'tickets', 'implementation', 'shipped'] as const) {
      const featureId = seedFeature(ctx, seedProject(ctx).id, { slug: `f-${phase}`, phase }).id
      expect(() => rethink(ctx, featureId)).toThrow(GateError)
      expect(() => rethink(ctx, featureId)).toThrow(
        new RegExp(`review phase to rethink \\(currently ${phase}\\)`),
      )
      const row = getFeatureRow(ctx, featureId)
      expect(row.lap).toBe(1)
      expect(row.phase).toBe(phase)
    }
  })

  it('refuses while a run is active — and does NOT increment the lap', () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review' }).id
    ctx.db
      .insert(runs)
      .values({
        id: newId('run'),
        featureId,
        workflow: 'ticket-burner',
        status: 'running',
        startedAt: Date.now(),
        endedAt: null,
        summary: null,
      })
      .run()

    expect(() => rethink(ctx, featureId)).toThrow(/run is burning/)
    expect(getFeatureRow(ctx, featureId).lap).toBe(1)
    expect(getFeatureRow(ctx, featureId).phase).toBe('review')
  })

  it('refuses while a non-ended session exists — and does NOT increment the lap', () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review' }).id
    const session = createSessionRow(ctx, { featureId, kind: 'revisit', worktreePath: '/tmp/wt' })

    expect(() => rethink(ctx, featureId)).toThrow(/only one terminal per feature/)
    // The mutation must not have happened: the launch that follows a rethink
    // would be refused by the same guard, stranding a lap with no session.
    expect(getFeatureRow(ctx, featureId).lap).toBe(1)
    expect(getFeatureRow(ctx, featureId).phase).toBe('review')

    markSessionEnded(ctx, session.id)
    expect(rethink(ctx, featureId).lap).toBe(2)
  })
})

describe('G3 (tickets-approved) scopes to the current lap', () => {
  let ctx: AppCtx

  beforeEach(async () => {
    ctx = await makeTestCtx()
  })

  it('a lap-1 done ticket does not satisfy G3 on lap 2 — a lap-2 ticket does', () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review' }).id
    const [shipped] = storeTickets(ctx, featureId, [ticketInput('lap-1 work')])
    updateTicket(ctx, shipped.id, { status: 'done', commits: ['abc'] })

    rethink(ctx, featureId)
    const onLap2 = getFeatureRow(ctx, featureId)
    expect(checkGate(ctx, 'tickets-approved', onLap2)).toEqual({
      satisfied: false,
      reason: 'no tickets to burn',
    })

    storeTickets(ctx, featureId, [ticketInput('lap-2 work')])
    expect(checkGate(ctx, 'tickets-approved', getFeatureRow(ctx, featureId)).satisfied).toBe(true)
  })

  it('still counts lap-1 tickets while the feature is on lap 1 (unchanged)', () => {
    const feature = seedFeature(ctx, seedProject(ctx).id, { phase: 'tickets' })
    expect(checkGate(ctx, 'tickets-approved', feature).satisfied).toBe(false)
    storeTickets(ctx, feature.id, [ticketInput('one')])
    expect(checkGate(ctx, 'tickets-approved', feature).satisfied).toBe(true)
  })

  it('G4 stays cumulative — an earlier lap`s terminal tickets still count', () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review' }).id
    const [shipped] = storeTickets(ctx, featureId, [ticketInput('lap-1 work')])
    updateTicket(ctx, shipped.id, { status: 'done', commits: ['abc'] })
    rethink(ctx, featureId)

    expect(checkGate(ctx, 'all-tickets-terminal', getFeatureRow(ctx, featureId)).satisfied).toBe(
      true,
    )
  })
})

describe('burn lap-scoping — Fix burns this lap, restart rescues any lap', () => {
  let ctx: AppCtx
  let original: WorkflowDef | undefined

  beforeEach(async () => {
    ctx = await makeTestCtx()
    original = workflowRegistry.get('ticket-burner')
    workflowRegistry.set('ticket-burner', stubBurner)
  })

  afterEach(() => {
    if (original) workflowRegistry.set('ticket-burner', original)
    else workflowRegistry.delete('ticket-burner')
  })

  it('a review-phase burn is refused when the only pending ticket belongs to an earlier lap', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review', lap: 2 }).id
    // A stale lap-1 ticket that never burned — it must not open the Fix path on lap 2.
    const [leftover] = storeTickets(ctx, featureId, [ticketInput('lap-1 leftover')])
    setTicketLap(ctx, leftover.id, 1)

    await expect(burn(ctx, featureId)).rejects.toThrow(/no pending tickets to burn/)
    expect(getFeatureRow(ctx, featureId).phase).toBe('review')
  })

  it('a review-phase burn runs once the current lap has a pending ticket', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review', lap: 2 }).id
    storeTickets(ctx, featureId, [ticketInput('lap-2 fix')])

    const { runId } = await burn(ctx, featureId)
    expect(runId).toMatch(/^run/)
    expect(getFeatureRow(ctx, featureId).phase).toBe('implementation')
  })

  it('restarting a dead burn still resets a failed ticket from an earlier lap', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation', lap: 2 }).id
    const [stale, current] = storeTickets(ctx, featureId, [
      ticketInput('lap-1 failure'),
      ticketInput('lap-2 work'),
    ])
    updateTicket(ctx, stale.id, { status: 'failed', error: 'boom' })
    setTicketLap(ctx, stale.id, 1)

    await burn(ctx, featureId)

    const byId = new Map(listByFeature(ctx, featureId).map((t) => [t.id, t]))
    expect(byId.get(stale.id)?.status).toBe('pending')
    expect(byId.get(current.id)?.status).toBe('pending')
  })
})
