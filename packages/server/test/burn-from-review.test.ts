import type { WorkflowCtx, WorkflowDef } from '@runcastle/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listAfter } from '../src/services/events'
import { getFeatureRow } from '../src/services/repo'
import { listByFeature, storeTickets, updateTicket } from '../src/services/tickets'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { workflowRegistry } from '../src/workflows/registry'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Burn from review is driven through the tRPC `feature.burn` seam. Fresh
 * pending tickets let the human re-burn from review: Burn crosses to Building
 * and the runner returns the feature to Review when it finishes.
 *
 * A stubbed ticket-burner keeps sandcastle out of the loop: `stubBurner` runs
 * without touching tickets (they stay pending, so the feature parks at
 * implementation), while `completingBurner` marks every pending ticket done so
 * the G4 auto-advance fires.
 */

const stubBurner: WorkflowDef = {
  id: 'ticket-burner',
  async run() {
    return { status: 'succeeded', summary: 'stub' }
  },
}

const completingBurner: WorkflowDef = {
  id: 'ticket-burner',
  async run(wctx: WorkflowCtx) {
    for (const t of wctx.tickets) {
      if (t.status === 'pending') wctx.updateTicket(t.id, { status: 'done', commits: ['abc'] })
    }
    return { status: 'succeeded', summary: 'all done' }
  },
}

function ticketInput(title: string) {
  return { title, goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy: [] }
}

function reviewInput() {
  return { ...ticketInput('Review the integrated change'), kind: 'review' as const }
}

/** Poll a predicate to let a backgrounded run finalize (startRun returns before `done`). */
async function waitFor(fn: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('waitFor timed out')
}

describe('feature.burn from review', () => {
  let ctx: AppCtx
  let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
  let original: WorkflowDef | undefined

  beforeEach(async () => {
    ctx = await makeTestCtx()
    caller = createCallerFactory(appRouter)(ctx)
    original = workflowRegistry.get('ticket-burner')
    workflowRegistry.set('ticket-burner', stubBurner)
  })

  afterEach(() => {
    if (original) workflowRegistry.set('ticket-burner', original)
    else workflowRegistry.delete('ticket-burner')
  })

  it('with a pending ticket + no run: starts a run from review', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review' }).id
    // A prior ticket is done (the first burn), plus a fresh fix ticket from Iterate.
    const [done, fresh] = storeTickets(ctx, featureId, [ticketInput('shipped'), ticketInput('fix-bug')])
    updateTicket(ctx, done.id, { status: 'done', commits: ['abc'] })

    const { runId } = await caller.feature.burn({ featureId })
    expect(runId).toMatch(/^run/)
    // The stub finishes immediately, so the runner returns the feature to review.
    expect(getFeatureRow(ctx, featureId).phase).toBe('review')
    expect(listByFeature(ctx, featureId).find((t) => t.id === fresh.id)?.status).toBe('pending')

    const ev = listAfter(ctx, featureId, 0).find(
      (e) => e.type === 'burn.started' && (e.data as { from?: string }).from === 'review',
    )
    expect(ev?.message).toBe('burning tickets — lap 1')
    expect(ev?.data).toMatchObject({ from: 'review', to: 'building' })
  })

  it('with zero pending tickets: refused with a clear error', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review' }).id
    const [done, cancelled] = storeTickets(ctx, featureId, [ticketInput('a'), ticketInput('b')])
    updateTicket(ctx, done.id, { status: 'done', commits: ['abc'] })
    updateTicket(ctx, cancelled.id, { status: 'cancelled' })

    await expect(caller.feature.burn({ featureId })).rejects.toThrow(/no pending tickets to burn/)
    // Refusal leaves the phase untouched.
    expect(getFeatureRow(ctx, featureId).phase).toBe('review')
  })

  it('after the run finishes with all tickets terminal, auto-advances back to review', async () => {
    workflowRegistry.set('ticket-burner', completingBurner)
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review' }).id
    const [done] = storeTickets(ctx, featureId, [ticketInput('shipped'), ticketInput('fix-bug')])
    updateTicket(ctx, done.id, { status: 'done', commits: ['abc'] })

    await caller.feature.burn({ featureId })
    // The run marks the fresh ticket done → G4 passes → back to review.
    await waitFor(() => getFeatureRow(ctx, featureId).phase === 'review')

    expect(listByFeature(ctx, featureId).every((t) => t.status === 'done')).toBe(true)
    const advanced = listAfter(ctx, featureId, 0).find((e) => e.type === 'phase.advanced')
    expect(advanced?.data).toMatchObject({ from: 'building', to: 'review' })
  })
})

describe('feature.burn — four-state lifecycle', () => {
  let ctx: AppCtx
  let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
  let original: WorkflowDef | undefined

  beforeEach(async () => {
    ctx = await makeTestCtx()
    caller = createCallerFactory(appRouter)(ctx)
    original = workflowRegistry.get('ticket-burner')
    workflowRegistry.set('ticket-burner', stubBurner)
  })

  afterEach(() => {
    if (original) workflowRegistry.set('ticket-burner', original)
    else workflowRegistry.delete('ticket-burner')
  })

  it('a fresh burn crosses planning into building', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'planning' }).id
    storeTickets(ctx, featureId, [ticketInput('one'), reviewInput()])

    await caller.feature.burn({ featureId })

    expect(getFeatureRow(ctx, featureId).phase).toBe('review')
    const types = listAfter(ctx, featureId, 0).map((e) => e.type)
    expect(types).toContain('burn.started')
  })

  it('burn from planning starts the build', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'planning' }).id
    storeTickets(ctx, featureId, [ticketInput('one')])

    await expect(caller.feature.burn({ featureId })).resolves.toEqual({ runId: expect.any(String) })
  })

  it('refuses a second burn while the first run is live', async () => {
    let finish!: () => void
    workflowRegistry.set('ticket-burner', {
      id: 'ticket-burner',
      async run() {
        await new Promise<void>((resolve) => { finish = resolve })
        return { status: 'succeeded', summary: 'done' }
      },
    })
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'planning' }).id
    storeTickets(ctx, featureId, [ticketInput('one')])

    await caller.feature.burn({ featureId })
    await expect(caller.feature.burn({ featureId })).rejects.toThrow(/already burning/)
    finish()
  })
})
