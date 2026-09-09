import type { WorkflowDef } from '@runcastle/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { createSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { toolCompletePhase } from '../src/mcp/server'
import { listAfter } from '../src/services/events'
import { burn } from '../src/services/features'
import { getFeatureRow } from '../src/services/repo'
import { storeTickets, updateTicket } from '../src/services/tickets'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { workflowRegistry } from '../src/workflows/registry'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * Burn waits for the tickets session to close out. The Burn click used to arm
 * the instant a stored batch satisfied G3 — while the session was still
 * emitting placeholder contexts and enriching them through `update_ticket` — so
 * a human who clicked in that window burned agents on placeholders and made the
 * session's remaining writes fail. `ticketsReadyLap` is the session's own "I am
 * done with this lap's tickets", set by `complete_phase({phase:"tickets"})` and
 * required by the first burn out of the `tickets` phase.
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

/** The `kind: "review"` ticket G3 requires of every lap it lets into a burn. */
function reviewInput() {
  return { ...ticketInput('Review the integrated change'), kind: 'review' as const }
}

describe('tickets readiness (ticketsReadyLap)', () => {
  let ctx: AppCtx
  let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
  let repoPath: string
  let original: WorkflowDef | undefined

  beforeEach(async () => {
    ctx = await makeTestCtx()
    caller = createCallerFactory(appRouter)(ctx)
    repoPath = tmpRepo()
    original = workflowRegistry.get('ticket-burner')
    workflowRegistry.set('ticket-burner', stubBurner)
  })

  afterEach(() => {
    if (original) workflowRegistry.set('ticket-burner', original)
    else workflowRegistry.delete('ticket-burner')
  })

  /** A feature at `tickets` with a burnable lap, and a live session working it. */
  function seedLap(overrides: { lap?: number; ticketsReadyLap?: number | null } = {}) {
    const feature = seedFeature(ctx, seedProject(ctx, repoPath).id, {
      phase: 'tickets',
      ...overrides,
    })
    storeTickets(ctx, feature.id, [ticketInput('one'), reviewInput()])
    const session = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'ideation',
      worktreePath: repoPath,
    })
    markSessionLive(ctx, session.id)
    return { feature, session }
  }

  describe('complete_phase(tickets) records the lap as ready', () => {
    it('flips ticketsReadyLap to the feature lap alongside the awaiting-burn note', () => {
      const { feature, session } = seedLap()
      expect(getFeatureRow(ctx, feature.id).ticketsReadyLap).toBeNull()

      expect(toolCompletePhase(ctx, session, { phase: 'tickets' })).toMatchObject({
        ok: true,
        nextPhase: 'implementation',
        waitingOn: 'human burn',
      })

      expect(getFeatureRow(ctx, feature.id).ticketsReadyLap).toBe(1)
      // Still parked — readiness arms the Burn click, it does not cross G3.
      expect(getFeatureRow(ctx, feature.id).phase).toBe('tickets')
      expect(listAfter(ctx, feature.id, 0).map((e) => e.type)).toContain('tickets.awaiting_burn')
    })

    it('records the CURRENT lap, so an earlier lap’s readiness does not carry', () => {
      const { feature, session } = seedLap({ lap: 2, ticketsReadyLap: 1 })
      toolCompletePhase(ctx, session, { phase: 'tickets' })
      expect(getFeatureRow(ctx, feature.id).ticketsReadyLap).toBe(2)
    })

    it('leaves the lap unready when G3 refuses the batch', () => {
      const feature = seedFeature(ctx, seedProject(ctx, repoPath).id, { phase: 'tickets' })
      storeTickets(ctx, feature.id, [ticketInput('no review ticket here')])
      const session = createSessionRow(ctx, {
        featureId: feature.id,
        kind: 'ideation',
        worktreePath: repoPath,
      })

      expect(toolCompletePhase(ctx, session, { phase: 'tickets' })).toMatchObject({ ok: false })
      expect(getFeatureRow(ctx, feature.id).ticketsReadyLap).toBeNull()
    })
  })

  describe('the first burn out of the tickets phase', () => {
    it('refuses while the session that is writing the tickets has not finished', async () => {
      const { feature } = seedLap()

      await expect(caller.feature.burn({ featureId: feature.id })).rejects.toThrow(
        /still finishing the tickets/,
      )
      await expect(burn(ctx, feature.id)).rejects.toThrow(GateError)
      // Refused, so nothing moved: no phase flip, no run.
      expect(getFeatureRow(ctx, feature.id).phase).toBe('tickets')
      expect(listAfter(ctx, feature.id, 0).map((e) => e.type)).not.toContain('burn.started')
    })

    it('arms once the session completes the tickets phase', async () => {
      const { feature, session } = seedLap()
      toolCompletePhase(ctx, session, { phase: 'tickets' })

      const { runId } = await caller.feature.burn({ featureId: feature.id })
      expect(runId).toMatch(/^run/)
      expect(getFeatureRow(ctx, feature.id).phase).toBe('implementation')
    })

    it('ignores a readiness stamped on an earlier lap', async () => {
      const { feature } = seedLap({ lap: 2, ticketsReadyLap: 1 })
      await expect(caller.feature.burn({ featureId: feature.id })).rejects.toThrow(
        /still finishing the tickets/,
      )
    })

    it('burns anyway when no session is alive to race — a dead session is not a dead end', async () => {
      const { feature, session } = seedLap()
      markSessionEnded(ctx, session.id)

      const { runId } = await caller.feature.burn({ featureId: feature.id })
      expect(runId).toMatch(/^run/)
      expect(getFeatureRow(ctx, feature.id).ticketsReadyLap).toBeNull()
    })

    it('still refuses a lap with no review ticket, readiness or not', async () => {
      const feature = seedFeature(ctx, seedProject(ctx, repoPath).id, {
        phase: 'tickets',
        ticketsReadyLap: 1,
      })
      storeTickets(ctx, feature.id, [ticketInput('build it')])

      await expect(caller.feature.burn({ featureId: feature.id })).rejects.toThrow(
        /no review ticket on this lap/,
      )
    })
  })

  describe('the re-entry paths never consult readiness', () => {
    it('restarts a burn parked at implementation with a session still live', async () => {
      const feature = seedFeature(ctx, seedProject(ctx, repoPath).id, { phase: 'implementation' })
      storeTickets(ctx, feature.id, [ticketInput('one'), reviewInput()])
      const session = createSessionRow(ctx, {
        featureId: feature.id,
        kind: 'revisit',
        worktreePath: repoPath,
      })
      markSessionLive(ctx, session.id)

      const { runId } = await caller.feature.burn({ featureId: feature.id })
      expect(runId).toMatch(/^run/)
      expect(listAfter(ctx, feature.id, 0).map((e) => e.type)).toContain('burn.restarted')
    })

    it('iterates from review on fresh fix tickets with a session still live', async () => {
      const feature = seedFeature(ctx, seedProject(ctx, repoPath).id, { phase: 'review' })
      const [done] = storeTickets(ctx, feature.id, [ticketInput('shipped'), ticketInput('fix-bug')])
      updateTicket(ctx, done.id, { status: 'done', commits: ['abc'] })
      const session = createSessionRow(ctx, {
        featureId: feature.id,
        kind: 'revisit',
        worktreePath: repoPath,
      })
      markSessionLive(ctx, session.id)

      const { runId } = await caller.feature.burn({ featureId: feature.id })
      expect(runId).toMatch(/^run/)
      expect(getFeatureRow(ctx, feature.id).phase).toBe('implementation')
    })
  })

  describe('a late complete_phase(tickets)', () => {
    it('is idempotent success once the burn has already crossed G3', async () => {
      const { feature, session } = seedLap()
      toolCompletePhase(ctx, session, { phase: 'tickets' })
      await caller.feature.burn({ featureId: feature.id })
      expect(getFeatureRow(ctx, feature.id).phase).toBe('implementation')

      const out = toolCompletePhase(ctx, session, { phase: 'tickets' })
      expect(out.ok).toBe(true)
      if (out.ok) {
        expect(out.nextPhase).toBe('implementation')
        expect(out.note).toMatch(/already crossed/)
        expect(out.note).toMatch(/burn has started/)
      }
      // …and it is a report, not a transition: the feature does not move.
      expect(getFeatureRow(ctx, feature.id).phase).toBe('implementation')
    })

    it('does not answer with the G4 check the session was never asking about', async () => {
      const { feature, session } = seedLap()
      toolCompletePhase(ctx, session, { phase: 'tickets' })
      await caller.feature.burn({ featureId: feature.id })

      const out = toolCompletePhase(ctx, session, { phase: 'tickets' })
      expect(JSON.stringify(out)).not.toMatch(/not yet terminal/)
    })
  })
})
