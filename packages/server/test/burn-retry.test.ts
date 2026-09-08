import type { WorkflowDef } from '@runcastle/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { listAfter } from '../src/services/events'
import { burn } from '../src/services/features'
import { overrideGate } from '../src/services/gates'
import { listByFeature, storeTickets, updateTicket } from '../src/services/tickets'
import { workflowRegistry } from '../src/workflows/registry'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * `feature.burn` retry semantics: re-burning a feature parked at
 * `implementation` (previous run failed/cancelled/crashed) resets every
 * `failed` ticket back to `pending` — the retry path the burner's "resolve
 * manually, then re-burn" messages promise. Cancelled tickets stay cancelled,
 * done tickets stay done. Driven through a stub ticket-burner workflow so no
 * sandcastle runs.
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

/** The `kind: "review"` ticket every batch closes with — what G3 requires. */
function reviewInput() {
  return { ...ticketInput('Review the integrated change'), kind: 'review' as const }
}

describe('feature.burn — retry resets failed tickets', () => {
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

  it('restart resets failed → pending (error cleared), leaves done/cancelled alone', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id
    const [a, b, c] = storeTickets(ctx, featureId, [
      ticketInput('failed-one'),
      ticketInput('done-one'),
      ticketInput('cancelled-one'),
    ])
    updateTicket(ctx, a.id, { status: 'failed', error: 'agent made no commits' })
    updateTicket(ctx, b.id, { status: 'done', commits: ['abc'] })
    updateTicket(ctx, c.id, { status: 'cancelled' })

    const { runId } = await burn(ctx, featureId)
    expect(runId).toMatch(/^run/)

    const after = Object.fromEntries(listByFeature(ctx, featureId).map((t) => [t.title, t]))
    expect(after['failed-one'].status).toBe('pending')
    expect(after['failed-one'].error).toBeUndefined()
    expect(after['done-one'].status).toBe('done')
    expect(after['cancelled-one'].status).toBe('cancelled')

    const restarted = listAfter(ctx, featureId, 0).find((e) => e.type === 'burn.restarted')
    expect(restarted?.message).toContain('retrying 1 failed ticket')
    expect(restarted?.data).toEqual({ retried: [a.seq] })
  })

  it('a fresh burn from the tickets phase crosses G3 without touching statuses', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'tickets' }).id
    storeTickets(ctx, featureId, [ticketInput('one'), reviewInput()])

    await burn(ctx, featureId)

    const types = listAfter(ctx, featureId, 0).map((e) => e.type)
    expect(types).toContain('burn.started')
    expect(types).not.toContain('burn.restarted')
  })

  it('refuses a fresh burn of a lap that has no review ticket', async () => {
    // The incident this seatbelt exists for: the Burn click used to ask only
    // for ≥1 non-cancelled ticket, so a lap whose review ticket lost its `kind`
    // went into a sandbox that has no app, database or browser.
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'tickets' }).id
    storeTickets(ctx, featureId, [ticketInput('build it')])

    await expect(burn(ctx, featureId)).rejects.toThrow(GateError)
    await expect(burn(ctx, featureId)).rejects.toThrow(/no review ticket on this lap/)
    expect(listAfter(ctx, featureId, 0).map((e) => e.type)).not.toContain('burn.started')

    // Emitting it (in a later call, as split batches do) opens the gate.
    storeTickets(ctx, featureId, [reviewInput()])
    await burn(ctx, featureId)
    expect(listAfter(ctx, featureId, 0).map((e) => e.type)).toContain('burn.started')
  })

  it('a review-less lap burns once the human overrides G3 with a reason', async () => {
    // The seatbelt, not the cage: override parks the feature at
    // `implementation`, and the re-entry path there does not re-cross G3.
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'tickets' }).id
    storeTickets(ctx, featureId, [ticketInput('build it')])

    expect(overrideGate(ctx, featureId, 'G3', 'reviewing this one by hand').phase).toBe(
      'implementation',
    )
    const { runId } = await burn(ctx, featureId)
    expect(runId).toMatch(/^run/)

    expect(
      listAfter(ctx, featureId, 0).find((e) => e.type === 'gate.overridden')?.message,
    ).toContain('reviewing this one by hand')
  })

  it('refuses when every ticket is cancelled', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id
    const [only] = storeTickets(ctx, featureId, [ticketInput('only')])
    updateTicket(ctx, only.id, { status: 'cancelled' })

    await expect(burn(ctx, featureId)).rejects.toThrow(GateError)
    await expect(burn(ctx, featureId)).rejects.toThrow(/every ticket is cancelled/)
  })

  it('still refuses with no tickets at all', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'tickets' }).id
    await expect(burn(ctx, featureId)).rejects.toThrow(/no tickets to burn/)
  })
})
