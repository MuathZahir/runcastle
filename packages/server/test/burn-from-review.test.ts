import type { WorkflowCtx, WorkflowDef } from '@runcastle/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listAfter } from '../src/services/events'
import { burn } from '../src/services/features'
import { getFeatureRow, setPhase } from '../src/services/repo'
import { listByFeature, storeTickets, updateTicket } from '../src/services/tickets'
import { workflowRegistry } from '../src/workflows/registry'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * The `burn` service, which the orchestrator's `burn_feature` still calls (the
 * human's door is Go now, and the lead dispatches rounds). Fresh pending
 * tickets let a burn start from review: it crosses to Building, and the feature
 * stays there when the run finishes — only the lead's ready declaration moves
 * it to review (`the-feature-lead-runs-rounds` decision 9).
 *
 * A stubbed ticket-burner keeps sandcastle out of the loop: `stubBurner` runs
 * without touching tickets (they stay pending).
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

/** Let the burn's run finish, then move the feature to review as a ready declaration would. */
async function reachReview(ctx: AppCtx, featureId: string): Promise<void> {
  await waitFor(() => listAfter(ctx, featureId, 0).some((e) => e.type === 'run.finished'))
  setPhase(ctx, featureId, 'review')
}

describe('feature.burn from review', () => {
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

  it('with a pending ticket + no run: starts a run from review', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review' }).id
    // A prior ticket is done (the first burn), plus a fresh fix ticket from Iterate.
    const [done, fresh] = storeTickets(ctx, featureId, [ticketInput('shipped'), ticketInput('fix-bug')])
    updateTicket(ctx, done.id, { status: 'done', commits: ['abc'] })

    const { runId } = await burn(ctx, featureId)
    expect(runId).toMatch(/^run/)
    expect(getFeatureRow(ctx, featureId).phase).toBe('building')
    expect(listByFeature(ctx, featureId).find((t) => t.id === fresh.id)?.status).toBe('pending')

    const ev = listAfter(ctx, featureId, 0).find(
      (e) => e.type === 'burn.started' && (e.data as { from?: string }).from === 'review',
    )
    // The review being answered closed lap 1, so this click opens lap 2.
    expect(ev?.message).toBe('burning tickets — lap 2')
    expect(ev?.data).toMatchObject({ from: 'review', to: 'building' })
  })

  it('with zero pending tickets: refused with a clear error', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review' }).id
    const [done, cancelled] = storeTickets(ctx, featureId, [ticketInput('a'), ticketInput('b')])
    updateTicket(ctx, done.id, { status: 'done', commits: ['abc'] })
    updateTicket(ctx, cancelled.id, { status: 'cancelled' })

    await expect(burn(ctx, featureId)).rejects.toThrow(/no pending tickets to burn/)
    // Refusal leaves the phase untouched.
    expect(getFeatureRow(ctx, featureId).phase).toBe('review')
  })

  it('after the run finishes with all tickets terminal, the feature stays in building', async () => {
    workflowRegistry.set('ticket-burner', completingBurner)
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review' }).id
    const [done] = storeTickets(ctx, featureId, [ticketInput('shipped'), ticketInput('fix-bug')])
    updateTicket(ctx, done.id, { status: 'done', commits: ['abc'] })

    await burn(ctx, featureId)
    await waitFor(() => listAfter(ctx, featureId, 0).some((e) => e.type === 'run.finished'))

    expect(listByFeature(ctx, featureId).every((t) => t.status === 'done')).toBe(true)
    expect(getFeatureRow(ctx, featureId).phase).toBe('building')
    expect(listAfter(ctx, featureId, 0).some((e) => e.type === 'phase.advanced')).toBe(false)
  })
})

describe('feature.burn — four-state lifecycle', () => {
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

  it('a fresh burn crosses planning into building', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'planning' }).id
    storeTickets(ctx, featureId, [ticketInput('one'), reviewInput()])

    await burn(ctx, featureId)

    expect(getFeatureRow(ctx, featureId).phase).toBe('building')
    const types = listAfter(ctx, featureId, 0).map((e) => e.type)
    expect(types).toContain('burn.started')
  })

  it('burn from planning starts the build', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'planning' }).id
    storeTickets(ctx, featureId, [ticketInput('one')])

    await expect(burn(ctx, featureId)).resolves.toEqual({ runId: expect.any(String) })
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

    await burn(ctx, featureId)
    await expect(burn(ctx, featureId)).rejects.toThrow(/already burning/)
    finish()
  })

  /**
   * The lap counter is derived, never managed (decision 4): a Burn from review
   * opens the lap that answers it, so nothing has to remember to bump it and
   * nothing can leave it stale.
   */
  it('opens the next lap on the Burn from review, so the second click is lap 2', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'planning' }).id
    storeTickets(ctx, featureId, [ticketInput('one')])

    await burn(ctx, featureId)
    expect(getFeatureRow(ctx, featureId).lap).toBe(1)

    // The stub leaves its ticket pending; the feature reaches review with work
    // still to do (a ready declaration, here set by hand), then burns again.
    await reachReview(ctx, featureId)
    await burn(ctx, featureId)

    expect(getFeatureRow(ctx, featureId).lap).toBe(2)
  })

  /**
   * The Iterate session writes its fix tickets while the feature is still at
   * review on lap N — `storeTickets` can only stamp the lap the feature is on —
   * and the Burn click that runs them is what opens lap N+1. The click carries
   * them across, so the lap the tickets report is the lap that burned them.
   */
  it('carries the fix tickets onto the lap the click opens', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'planning' }).id
    storeTickets(ctx, featureId, [ticketInput('one')])
    await burn(ctx, featureId)
    await reachReview(ctx, featureId)

    // Written during lap 1's review, and stamped lap 1 on the way in.
    const [fix] = storeTickets(ctx, featureId, [ticketInput('fix-bug')])
    expect(fix.lap).toBe(1)

    await burn(ctx, featureId)

    const feature = getFeatureRow(ctx, featureId)
    expect(feature.lap).toBe(2)
    expect(listByFeature(ctx, featureId).find((t) => t.id === fix.id)?.lap).toBe(feature.lap)
  })

  /**
   * Restarting a burn whose run died rescues the lap that was already running;
   * it does not start one. Deriving the lap from the run count invented one
   * here — a retry is a run of its own — leaving a feature that said lap 2 with
   * every ticket, session, event and finding of the work still saying lap 1.
   */
  it('a restart resumes the lap the dead run was burning', async () => {
    workflowRegistry.set('ticket-burner', {
      id: 'ticket-burner',
      async run() {
        return { status: 'failed', summary: 'the run died' }
      },
    })
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'planning' }).id
    const [only] = storeTickets(ctx, featureId, [ticketInput('one')])

    await burn(ctx, featureId)
    // A failed run never auto-advances, so the feature is parked at building
    // with one ticket-burner run behind it — the crashed-lap-1 state.
    await waitFor(() => listAfter(ctx, featureId, 0).some((e) => e.type === 'run.finished'))
    expect(getFeatureRow(ctx, featureId).phase).toBe('building')
    expect(getFeatureRow(ctx, featureId).lap).toBe(1)

    await burn(ctx, featureId)

    expect(getFeatureRow(ctx, featureId).lap).toBe(1)
    expect(listByFeature(ctx, featureId).find((t) => t.id === only.id)?.lap).toBe(1)
  })

  /**
   * Decision 7 — Merge during a live burn warns rather than refuses, so a run
   * can finish on a feature that has already shipped. Nothing moves backwards:
   * the run finalizes normally and leaves the shipped phase alone.
   */
  it('a run finishing on a feature that shipped while it was live moves nothing', async () => {
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

    await burn(ctx, featureId)
    expect(getFeatureRow(ctx, featureId).phase).toBe('building')

    // The human clicks Merge mid-burn; the run then finishes as it always does.
    setPhase(ctx, featureId, 'shipped', 'feature.shipped', 'merged to main')
    finish()
    await waitFor(() => listAfter(ctx, featureId, 0).some((e) => e.type === 'run.finished'))

    expect(getFeatureRow(ctx, featureId).phase).toBe('shipped')
    expect(listAfter(ctx, featureId, 0).some((e) => e.type === 'phase.advanced')).toBe(false)
  })
})
