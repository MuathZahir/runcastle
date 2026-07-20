import type { WorkflowDef } from '@runcastle/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { listAfter } from '../src/services/events'
import { burn } from '../src/services/features'
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
    storeTickets(ctx, featureId, [ticketInput('one')])

    await burn(ctx, featureId)

    const types = listAfter(ctx, featureId, 0).map((e) => e.type)
    expect(types).toContain('burn.started')
    expect(types).not.toContain('burn.restarted')
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
