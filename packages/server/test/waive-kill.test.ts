import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listAfter } from '../src/services/events'
import { getTicket, storeTickets, updateTicket } from '../src/services/tickets'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { createKillRegistry, type KillRegistryDeps } from '../src/workflows/kill-registry'
import { registerTicketAbort, releaseTicketAbort } from '../src/workflows/ticket-burner'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Waiving a ticket kills its agent first (decisions.md #5).
 *
 * The bug this closes: a ticket can READ terminal while its process carries on
 * — the burner writes the failed state off the abort, and until this feature
 * nothing killed anything. Waiving such a ticket was a pure DB flip, so the row
 * said "set aside" over an agent that kept committing. Waive now routes through
 * the same kill-and-wait as Stop, and the order is the whole point: dead first,
 * flipped second.
 *
 * Driven at the `ticket.cancel` seam, because the ordering only exists there —
 * `cancelTicket` itself stays the pure service it was, which is what keeps the
 * workflows layer out of `services/`.
 */

/** Lane keys registered with the real registry, cleared between cases. */
const REGISTRY_KEY = Symbol.for('runcastle.kill.registry')
type GlobalWithRegistry = typeof globalThis & { [REGISTRY_KEY]?: unknown }

function ticketInput(title: string) {
  return { title, goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy: [] }
}

describe('waive kills a live agent before it flips the row', () => {
  let ctx: AppCtx
  let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
  let featureId: string
  let ticketId: string
  const realRegistry = (globalThis as GlobalWithRegistry)[REGISTRY_KEY]

  beforeEach(async () => {
    ctx = await makeTestCtx()
    caller = createCallerFactory(appRouter)(ctx)
    featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id
    const [ticket] = storeTickets(ctx, featureId, [ticketInput('half-burnt')])
    ticketId = ticket.id
    // The state the bug lives in: the row already reads terminal.
    updateTicket(ctx, ticketId, { status: 'failed', error: 'stopped by user' })
  })

  afterEach(() => {
    releaseTicketAbort(ticketId)
    ;(globalThis as GlobalWithRegistry)[REGISTRY_KEY] = realRegistry
  })

  it('aborts the agent while the ticket is still failed, then cancels it', async () => {
    const controller = registerTicketAbort(ticketId)
    // What the row said at the moment the kill began — the assertion is the
    // ORDER, and a status read afterwards could not tell the two apart.
    let statusAtAbort: string | undefined
    controller.signal.addEventListener('abort', () => {
      statusAtAbort = getTicket(ctx, ticketId).status
    })

    const result = await caller.ticket.cancel({ ticketId, reason: 'not worth finishing' })

    expect(statusAtAbort).toBe('failed')
    expect(result.stopped).toBe(true)
    expect(result.ticket.status).toBe('cancelled')
    expect(getTicket(ctx, ticketId).status).toBe('cancelled')
  })

  it('stays a pure flip when nothing is running behind the ticket', async () => {
    const result = await caller.ticket.cancel({ ticketId })

    expect(result.stopped).toBe(false)
    expect(result.confirmed).toBe(true)
    expect(getTicket(ctx, ticketId).status).toBe('cancelled')
  })

  it('says so on the timeline when the kill could not be confirmed', async () => {
    // A tree-kill that never succeeds is the unkillable process, without one:
    // the registry answers `confirmed: false` rather than holding the caller.
    const deps: KillRegistryDeps = {
      runDocker: async () => true,
      killTree: async () => {
        throw new Error('taskkill: access denied')
      },
    }
    const registry = createKillRegistry(deps)
    registry.registerHostPid(ticketId, 4242)
    ;(globalThis as GlobalWithRegistry)[REGISTRY_KEY] = registry
    registerTicketAbort(ticketId)

    const result = await caller.ticket.cancel({ ticketId })

    expect(result.confirmed).toBe(false)
    // The toast is gone in seconds; the timeline is what survives it.
    const timedOut = listAfter(ctx, featureId, 0).filter((e) => e.type === 'ticket.stop_timeout')
    expect(timedOut).toHaveLength(1)
    // Still waived — an unkillable process is not a reason to refuse the human's
    // decision, only a reason to say the process may still be there.
    expect(getTicket(ctx, ticketId).status).toBe('cancelled')
  })

  it('refuses a burning ticket without killing anything — Stop is that control', async () => {
    updateTicket(ctx, ticketId, { status: 'burning' })
    const controller = registerTicketAbort(ticketId)

    await expect(caller.ticket.cancel({ ticketId })).rejects.toThrow(/burning/)

    expect(controller.signal.aborted).toBe(false)
    expect(getTicket(ctx, ticketId).status).toBe('burning')
  })
})
