import type { Feature, Project, Ticket, TicketInput } from '@runcastle/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError, InvalidInputError } from '../src/errors'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import { toolEmitTickets, toolResolveFinding, toolsForAudience } from '../src/mcp/server'
import {
  dismiss,
  listByFeature as listFindings,
  markFixProgress,
} from '../src/services/review-findings'
import { listByFeature as listTickets, storeTickets, updateTicket } from '../src/services/tickets'
import { makeTestCtx } from './helpers/db'
import { reportWithFixTicket } from './helpers/findings'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * The agent's side of a review's defects: each stays open until it is fixed
 * through a linked ticket, or the agent closes it as addressed or dismisses it
 * (tickets-and-review-are-tools-not-phases decision 11). Nothing is carried.
 */
describe('the agent resolves a review’s open defects', () => {
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
    feature = seedFeature(ctx, project.id, { slug: 'dark-mode' })
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

  /** A defect a review left open: reported, its fix ticket tried and failed. */
  function openDefect(title = 'Deletes are never retried'): string {
    const { finding, fixTicket } = reportWithFixTicket(ctx, {
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
    updateTicket(ctx, fixTicket.id, { status: 'failed' })
    markFixProgress(ctx, finding.id, 'failed', 'the burner could not land it')
    return finding.id
  }

  function findingById(id: string) {
    return listFindings(ctx, feature.id).find((finding) => finding.id === id)
  }

  describe('resolve_finding', () => {
    it('is offered to the kinds that shape the feature’s work, and to nobody else', () => {
      for (const kind of ['chat', 'drive-fix'] as const) {
        expect(toolsForAudience(kind), kind).toContain('resolve_finding')
      }
      expect(toolsForAudience('project')).not.toContain('resolve_finding')
      expect(toolsForAudience('run')).not.toContain('resolve_finding')
    })

    it('offers addressed and dismissed, and nothing else', () => {
      const findingId = openDefect()
      expect(() =>
        toolResolveFinding(ctx, session, {
          findingId,
          disposition: 'carry' as 'addressed',
          note: 'later',
        }),
      ).toThrow()
      expect(findingById(findingId)?.status).toBe('failed')
    })

    it('closes a defect work already answered, keeping the attestation', () => {
      const findingId = openDefect()
      toolResolveFinding(ctx, session, {
        findingId,
        disposition: 'addressed',
        note: 'ticket 7 rewrote the endpoint and the retry lands',
      })
      // Addressed IS fixed — the provenance is what separates a session's word
      // from a burner-verified landing.
      expect(findingById(findingId)).toMatchObject({
        status: 'fixed',
        resolvedBy: 'session',
        resolutionNote: 'ticket 7 rewrote the endpoint and the retry lands',
      })
    })

    it('dismisses a defect with the reason on the row', () => {
      const findingId = openDefect()
      const result = toolResolveFinding(ctx, session, {
        findingId,
        disposition: 'dismissed',
        note: 'retries are out of scope for this feature',
      })
      expect(result).toMatchObject({ ok: true, finding: { status: 'dismissed' } })
      expect(findingById(findingId)).toMatchObject({
        status: 'dismissed',
        resolvedBy: 'session',
        resolutionNote: 'retries are out of scope for this feature',
      })
    })

    it('refuses a closure with no note, and another feature’s finding', () => {
      const findingId = openDefect()

      // At the schema, not in the service: a closure with no evidence never
      // reaches the db, so the tool list itself carries the requirement.
      expect(() =>
        toolResolveFinding(ctx, session, { findingId, disposition: 'addressed', note: '   ' }),
      ).toThrow(/requires a note saying what addressed it/)
      expect(() =>
        toolResolveFinding(ctx, session, { findingId, disposition: 'dismissed' }),
      ).toThrow(/requires a note saying why/)

      const other = seedFeature(ctx, project.id, { slug: 'other' })
      const stranger = createSessionRow(ctx, {
        featureId: other.id,
        kind: 'chat',
        worktreePath: repoPath,
      })
      expect(() =>
        toolResolveFinding(ctx, stranger, { findingId, disposition: 'dismissed', note: 'n' }),
      ).toThrow(InvalidInputError)
      expect(findingById(findingId)?.status).toBe('failed')
    })

    it('refuses a defect that is no longer open', () => {
      const findingId = openDefect()
      dismiss(ctx, findingId)
      expect(() =>
        toolResolveFinding(ctx, session, { findingId, disposition: 'addressed', note: 'n' }),
      ).toThrow(InvalidInputError)
    })
  })

  describe('emit_tickets with originFindingId', () => {
    it('stamps the fix ticket on the finding and flips it to fixing', () => {
      const findingId = openDefect()

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
