import type { Feature, Project, Ticket, TicketInput } from '@runcastle/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError, InvalidInputError } from '../src/errors'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import { toolResolveFinding, toolsForAudience } from '../src/mcp/server'
import {
  dismiss,
  listByFeature as listFindings,
} from '../src/services/review-findings'
import { listByFeature as listTickets } from '../src/services/tickets'
import { storeTickets, updateTicket } from './helpers/tickets'
import { makeTestCtx } from './helpers/db'
import { markFailed, markFixed, reportWithFixTicket } from './helpers/findings'
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
    markFailed(ctx, finding.id, 'the burner could not land it')
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
      expect(toolsForAudience('review')).not.toContain('resolve_finding')
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
      expect(result).toEqual({ ok: true, findingId, status: 'dismissed' })
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

    it('answers a finding that already closed with its status, changing nothing', () => {
      const fixedId = openDefect('Fixed when its ticket landed')
      markFixed(ctx, fixedId)
      expect(
        toolResolveFinding(ctx, session, { findingId: fixedId, disposition: 'addressed', note: 'n' }),
      ).toEqual({ ok: true, findingId: fixedId, status: 'fixed', alreadyClosed: true })
      expect(findingById(fixedId)?.resolutionNote).not.toBe('n')

      const dismissedId = openDefect('Dismissed by the human')
      dismiss(ctx, dismissedId)
      expect(
        toolResolveFinding(ctx, session, { findingId: dismissedId, disposition: 'addressed', note: 'n' }),
      ).toEqual({ ok: true, findingId: dismissedId, status: 'dismissed', alreadyClosed: true })
      expect(findingById(dismissedId)?.status).toBe('dismissed')
    })

    it('still refuses another feature’s closed finding', () => {
      const findingId = openDefect()
      dismiss(ctx, findingId)
      const other = seedFeature(ctx, project.id, { slug: 'other' })
      const stranger = createSessionRow(ctx, { featureId: other.id, kind: 'chat', worktreePath: repoPath })
      expect(() =>
        toolResolveFinding(ctx, stranger, { findingId, disposition: 'dismissed', note: 'n' }),
      ).toThrow(InvalidInputError)
    })
  })

})
