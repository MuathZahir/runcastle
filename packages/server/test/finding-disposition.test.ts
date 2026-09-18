import type { Feature, Project, Ticket, TicketInput } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { features } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { GateError, InvalidInputError } from '../src/errors'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import { toolEmitTickets, toolResolveFinding, toolsForAudience } from '../src/mcp/server'
import {
  dismiss,
  listByFeature as listFindings,
  markFixProgress,
  reportFinding,
} from '../src/services/review-findings'
import { listByFeature as listTickets, storeTickets, updateTicket } from '../src/services/tickets'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * The session's side of the lap boundary: a lap that inherits an earlier lap's
 * open defects must LINK, CARRY or CLOSE each one before its tickets phase will
 * complete.
 *
 * The bug behind all of it: lap 1's review reported defects, lap 2's work fixed
 * them, and the finding rows never heard — so lap 2's review still showed them
 * open and the human clicked Iterate over defects that no longer existed.
 */
describe('the lap session dispositions earlier laps’ defects', () => {
  let ctx: AppCtx
  let repoPath: string
  let project: Project
  let feature: Feature
  let reviewTicket: Ticket
  let session: ReturnType<typeof createSessionRow>

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = tmpRepo()
    project = seedProject(ctx, repoPath)
    feature = seedFeature(ctx, project.id, { slug: 'dark-mode', phase: 'planning' })
    reviewTicket = storeTickets(ctx, feature.id, [
      { ...ticketInput('Review'), kind: 'review' },
    ])[0]
    session = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: repoPath })
    markSessionLive(ctx, session.id)
    setRuntimeCtx(ctx)
  })

  afterEach(() => {
    clearRuntimeCtx()
    rmTemp(repoPath)
  })

  function ticketInput(title: string): TicketInput {
    return { title, goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: [], blockedBy: [] }
  }

  /**
   * A defect lap 1's review left open: reported, its in-run fix ticket tried and
   * failed. That failed fix is the state the whole feature is about — the burner
   * gave up, so the defect is the NEXT lap's to answer for.
   */
  function openDefect(title = 'Deletes are never retried'): string {
    const { finding, fixTicket } = reportFinding(ctx, {
      featureId: feature.id,
      reviewTicket,
      input: {
        kind: 'defect',
        severity: 'high',
        title,
        location: 'packages/server/src/dlq.ts:88',
        citation: 'spec.md §the operator can retry',
        detail: 'The retry lands at the seam but the endpoint never calls it.',
        reproStep: 'Click Retry on a dead-lettered job and watch nothing change.',
      },
    })
    updateTicket(ctx, fixTicket!.id, { status: 'failed' })
    markFixProgress(ctx, finding.id, 'failed', 'the burner could not land it')
    return finding.id
  }

  /** Move the feature on a lap, the way `feature.rethink` does. */
  function rethink(lap: number): void {
    ctx.db.update(features).set({ lap }).where(eq(features.id, feature.id)).run()
    feature = { ...feature, lap }
  }

  function findingById(id: string) {
    return listFindings(ctx, feature.id).find((finding) => finding.id === id)
  }

  describe('resolve_finding', () => {
    it('is offered to the kinds that shape a lap’s work, and to nobody else', () => {
      // The same roster as `emit_tickets`: any session that can card the work
      // answering a defect can also say what that work did to it.
      for (const kind of ['ideation', 'revisit', 'converge', 'waypoint', 'drive-fix'] as const) {
        expect(toolsForAudience(kind), kind).toContain('resolve_finding')
      }
      expect(toolsForAudience('qa')).not.toContain('resolve_finding')
      expect(toolsForAudience('project')).not.toContain('resolve_finding')
      expect(toolsForAudience('run')).not.toContain('resolve_finding')
    })

    it('carries a defect out of the open pile and stamps the lap doing the carrying', () => {
      const findingId = openDefect()
      rethink(2)

      const result = toolResolveFinding(ctx, session, { findingId, disposition: 'carry' })
      expect(result).toMatchObject({ ok: true, finding: { status: 'carried', carriedLap: 2 } })
      expect(findingById(findingId)).toMatchObject({ status: 'carried', resolvedBy: null })
    })

    it('closes a defect this lap’s work already answered, keeping the attestation', () => {
      const findingId = openDefect()
      rethink(2)

      toolResolveFinding(ctx, session, {
        findingId,
        disposition: 'addressed',
        note: 'lap 2’s ticket 7 rewrote the endpoint and the retry lands',
      })
      // Addressed IS fixed — the provenance is what separates a session's word
      // from a burner-verified landing.
      expect(findingById(findingId)).toMatchObject({
        status: 'fixed',
        resolvedBy: 'session',
        resolutionNote: 'lap 2’s ticket 7 rewrote the endpoint and the retry lands',
      })
    })

    it('refuses a closure with no attestation, and another feature’s finding', () => {
      const findingId = openDefect()
      rethink(2)

      // At the schema, not in the service: a closure with no evidence never
      // reaches the db, so the tool list itself carries the requirement.
      expect(() =>
        toolResolveFinding(ctx, session, { findingId, disposition: 'addressed', note: '   ' }),
      ).toThrow(/requires a note saying what addressed it/)

      const other = seedFeature(ctx, project.id, { slug: 'other' })
      const stranger = createSessionRow(ctx, {
        featureId: other.id,
        kind: 'chat',
        worktreePath: repoPath,
      })
      expect(() =>
        toolResolveFinding(ctx, stranger, { findingId, disposition: 'carry' }),
      ).toThrow(InvalidInputError)
      expect(findingById(findingId)?.status).toBe('failed')
    })

    it('refuses a qa session, whose contract is read-only', () => {
      const findingId = openDefect()
      const qa = createSessionRow(ctx, {
        featureId: feature.id,
        kind: 'chat',
        worktreePath: repoPath,
      })
      expect(() => toolResolveFinding(ctx, qa, { findingId, disposition: 'carry' })).toThrow(GateError)
    })

    it('still takes a carried defect — parked is not frozen', () => {
      const findingId = openDefect()
      rethink(2)
      toolResolveFinding(ctx, session, { findingId, disposition: 'carry' })

      rethink(3)
      toolResolveFinding(ctx, session, {
        findingId,
        disposition: 'addressed',
        note: 'lap 3 removed the endpoint entirely',
      })
      // Leaving `carried` drops the lap stamp: a fixed finding must not go on
      // claiming it was parked.
      expect(findingById(findingId)).toMatchObject({ status: 'fixed', carriedLap: null })
    })
  })

  describe('emit_tickets with originFindingId', () => {
    it('stamps the fix ticket on the finding and flips it to fixing', () => {
      const findingId = openDefect()
      rethink(2)

      // The link path gets no tool of its own — it rides `emit_tickets`.
      const { tickets } = toolEmitTickets(ctx, session, {
        tickets: [
          { ...ticketInput('Call the retry endpoint'), originFindingId: findingId },
          { ...ticketInput('Review'), kind: 'review' },
        ],
      })
      const fix = listTickets(ctx, feature.id).find((t) => t.seq === tickets[0].seq)

      expect(findingById(findingId)).toMatchObject({ status: 'fixing', fixTicketId: fix?.id })
    })

    it('fails the whole batch on an id that is not this feature’s open defect, naming it', () => {
      const findingId = openDefect()
      rethink(2)
      dismiss(ctx, findingId)
      const before = listTickets(ctx, feature.id).length

      expect(() =>
        toolEmitTickets(ctx, session, {
          tickets: [
            ticketInput('Unrelated work'),
            { ...ticketInput('Call the retry endpoint'), originFindingId: findingId },
          ],
        }),
      ).toThrow(new RegExp(findingId))
      // Nothing stored: one bad id is a bad batch, the way an unknown model is.
      expect(listTickets(ctx, feature.id)).toHaveLength(before)
    })

    it('refuses two tickets that link to the same defect', () => {
      const findingId = openDefect()
      rethink(2)

      expect(() =>
        toolEmitTickets(ctx, session, {
          tickets: [
            { ...ticketInput('Fix the endpoint'), originFindingId: findingId },
            { ...ticketInput('Fix it again'), originFindingId: findingId },
          ],
        }),
      ).toThrow(InvalidInputError)
      expect(findingById(findingId)?.status).toBe('failed')
    })

    it('closes the finding when the linked ticket lands, through the shipped burner path', () => {
      const findingId = openDefect()
      rethink(2)
      const { tickets } = toolEmitTickets(ctx, session, {
        tickets: [{ ...ticketInput('Call the retry endpoint'), originFindingId: findingId }],
      })
      const fix = listTickets(ctx, feature.id).find((t) => t.seq === tickets[0].seq)!

      // What the burner does when a fix ticket lands (`markFixProgress`), which
      // this feature does not touch: the link is the whole of the new work.
      updateTicket(ctx, fix.id, { status: 'done' })
      markFixProgress(ctx, fix.originFindingId!, 'fixed')

      expect(findingById(findingId)).toMatchObject({ status: 'fixed', resolvedBy: 'fix-ticket' })
    })
  })

})
