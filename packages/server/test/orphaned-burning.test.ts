import type { WorkflowCtx, WorkflowDef } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { runs } from '../src/db/schema'
import { listAfter } from '../src/services/events'
import { checkGate } from '../src/services/gates'
import { getFeatureRow, getRunRow } from '../src/services/repo'
import { cancelTicket, getTicket, listByFeature, storeTickets, updateTicket } from '../src/services/tickets'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { reconcileStaleRuns } from '../src/workflows/reconcile-runs'
import { workflowRegistry } from '../src/workflows/registry'
import { startRun } from '../src/workflows/runner'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Orphaned `burning` tickets — the dead end this suite pins shut.
 *
 * A ticket lands in `burning` the moment its lane starts and leaves it when the
 * lane finishes. If the run dies in between (server restart, crash, an abort
 * that raced the lane's own handler) the row survives with no agent behind it,
 * and every exit is closed: the scheduler only queues `pending`, so a re-burn
 * returns instantly with `N-1/N tickets done`; `retry`/`cancel`/`edit` refuse a
 * non-`pending`/`failed` ticket; "Stop ticket" finds no live agent; and G4 never
 * passes because `burning` is not terminal.
 *
 * The three places that know no agent is live — the run finalizer, boot
 * reconciliation, and a burn restart — now fail those lanes (keeping their
 * commits for a retry), and `ticket.stop` sweeps as a last-resort rescue.
 */

function ticketInput(title: string) {
  return { title, goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy: [] }
}

/** Marks every pending ticket done — a burn that actually runs its lanes. */
const completingBurner: WorkflowDef = {
  id: 'ticket-burner',
  async run(wctx: WorkflowCtx) {
    let done = 0
    for (const t of wctx.tickets) {
      if (t.status === 'pending') {
        wctx.updateTicket(t.id, { status: 'done', commits: ['abc1234'] })
        done += 1
      }
    }
    return { status: 'succeeded', summary: `${done} done` }
  },
}

describe('orphaned burning tickets', () => {
  let ctx: AppCtx
  let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
  let original: WorkflowDef | undefined

  beforeEach(async () => {
    ctx = await makeTestCtx()
    caller = createCallerFactory(appRouter)(ctx)
    original = workflowRegistry.get('ticket-burner')
    workflowRegistry.set('ticket-burner', completingBurner)
  })

  afterEach(() => {
    if (original) workflowRegistry.set('ticket-burner', original)
    else workflowRegistry.delete('ticket-burner')
  })

  /** A feature parked at implementation with `done` + `burning` lanes and no live run. */
  function seedWedged(): { featureId: string; stuckId: string } {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id
    const [shipped, stuck] = storeTickets(ctx, featureId, [ticketInput('landed'), ticketInput('wedged')])
    updateTicket(ctx, shipped.id, { status: 'done', commits: ['abc1234'] })
    updateTicket(ctx, stuck.id, { status: 'burning' })
    return { featureId, stuckId: stuck.id }
  }

  it('a burning lane blocks G4, so the wedge is real', () => {
    const { featureId } = seedWedged()
    const gate = checkGate(ctx, 'all-tickets-terminal', getFeatureRow(ctx, featureId))
    expect(gate.satisfied).toBe(false)
  })

  it('feature.burn heals the stuck lane instead of failing instantly', async () => {
    const { featureId, stuckId } = seedWedged()

    await caller.feature.burn({ featureId })

    // Swept to failed, reset to pending, then burned by the run — not skipped.
    expect(getTicket(ctx, stuckId).status).toBe('done')
    expect(listByFeature(ctx, featureId).every((t) => t.status === 'done')).toBe(true)
    expect(checkGate(ctx, 'all-tickets-terminal', getFeatureRow(ctx, featureId)).satisfied).toBe(true)

    const failed = listAfter(ctx, featureId, 0).filter((e) => e.type === 'ticket.failed')
    expect(failed).toHaveLength(1)
    expect(failed[0].message).toContain('the previous run died while it was burning')
  })

  it('the run finalizer fails a lane the workflow left burning', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id
    const [t] = storeTickets(ctx, featureId, [ticketInput('abandoned')])

    const abandoning: WorkflowDef = {
      id: 'ticket-burner',
      async run(wctx: WorkflowCtx) {
        wctx.updateTicket(t.id, { status: 'burning' })
        return { status: 'failed', summary: 'gave up mid-lane' }
      },
    }
    workflowRegistry.set('ticket-burner', abandoning)

    const { done } = await startRun(ctx, featureId, 'ticket-burner')
    await done

    const swept = getTicket(ctx, t.id)
    expect(swept.status).toBe('failed')
    expect(swept.error).toContain('the run ended (failed) while it was burning')
  })

  it('ticket.stop sweeps an orphaned lane when no agent and no run are live', async () => {
    const { featureId, stuckId } = seedWedged()

    expect(await caller.ticket.stop({ ticketId: stuckId })).toEqual({ stopped: false, swept: true })

    const swept = getTicket(ctx, stuckId)
    expect(swept.status).toBe('failed')
    expect(swept.error).toContain('the run that was burning it is gone')
    // Back on the paths that refuse a `burning` ticket.
    expect(cancelTicket(ctx, stuckId, 'not needed').status).toBe('cancelled')
    expect(checkGate(ctx, 'all-tickets-terminal', getFeatureRow(ctx, featureId)).satisfied).toBe(true)
  })

  it('ticket.stop does not sweep while a run is live (the agent may just be starting)', async () => {
    const { featureId, stuckId } = seedWedged()
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

    expect(await caller.ticket.stop({ ticketId: stuckId })).toEqual({ stopped: false, swept: false })
    expect(getTicket(ctx, stuckId).status).toBe('burning')
  })

  it('boot reconciliation sweeps the lanes a killed burner left burning', async () => {
    const { featureId, stuckId } = seedWedged()
    const runId = newId('run')
    ctx.db
      .insert(runs)
      .values({
        id: runId,
        featureId,
        workflow: 'ticket-burner',
        status: 'running',
        startedAt: Date.now(),
        endedAt: null,
        summary: null,
      })
      .run()

    await reconcileStaleRuns(ctx)

    expect(getRunRow(ctx, runId).status).toBe('failed')
    const swept = getTicket(ctx, stuckId)
    expect(swept.status).toBe('failed')
    expect(swept.error).toContain('orphaned by server restart')

    const reconciled = listAfter(ctx, featureId, 0).find((e) => e.type === 'run.reconciled')
    expect((reconciled?.data as { sweptTicketSeqs: number[] }).sweptTicketSeqs).toEqual([2])
  })

  it('a stale non-burner run leaves ticket lanes alone (only the burner owns them)', async () => {
    const { featureId, stuckId } = seedWedged()
    ctx.db
      .insert(runs)
      .values({
        id: newId('run'),
        featureId,
        workflow: 'research',
        status: 'running',
        startedAt: Date.now(),
        endedAt: null,
        summary: null,
      })
      .run()

    await reconcileStaleRuns(ctx)

    expect(getTicket(ctx, stuckId).status).toBe('burning')
  })
})
