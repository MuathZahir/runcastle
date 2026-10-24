import type { Project, Ticket } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { InvalidInputError } from '../src/errors'
import { listAfter } from '../src/services/events'
import {
  buildFixTicket,
  closeAsAddressed,
  dismiss,
  dismissAsAgent,
  listByFeature,
  markFailed,
  markFixed,
  markFixing,
  openDefects,
  reportFinding,
  viewByFeature,
} from '../src/services/review-findings'
import { listByFeature as listTickets, storeTickets, sweepOrphanedBurning, updateTicket } from '../src/services/tickets'
import { reviewFindings } from '../src/db/schema'
import { makeTestCtx } from './helpers/db'
import { reportWithFixTicket } from './helpers/findings'
import { seedFeature, seedProject } from './helpers/fixtures'

describe('review findings service', () => {
  let ctx: AppCtx
  let project: Project
  let featureId: string
  let reviewTicket: Ticket

  beforeEach(async () => {
    ctx = await makeTestCtx()
    project = seedProject(ctx)
    const feature = seedFeature(ctx, project.id)
    featureId = feature.id
    reviewTicket = storeTickets(ctx, featureId, [
      {
        title: 'Review', goal: 'Review', context: '', acceptanceCriteria: [], seams: [],
        blockedBy: [], kind: 'review',
      },
    ])[0]
  })

  const defect = (title = 'Broken save') => ({
    kind: 'defect' as const,
    severity: 'high' as const,
    title,
    location: 'packages/server/src/save.ts:42',
    citation: 'spec.md §Save requires persistence',
    detail: 'The save action drops the edited value.',
    reproStep: 'Run bun test save.test.ts and observe the failing persistence assertion.',
  })

  it('builds the mechanical fix ticket exactly from a finding', () => {
    expect(buildFixTicket({ id: 'finding_1', ...defect() })).toEqual({
      title: 'Broken save',
      goal: 'Fix: Broken save',
      context:
        'Location: packages/server/src/save.ts:42\n\n' +
        'Citation: spec.md §Save requires persistence\n\n' +
        'Detail: The save action drops the edited value.\n\n' +
        'Repro step: Run bun test save.test.ts and observe the failing persistence assertion.',
      acceptanceCriteria: [
        'The repro step no longer reproduces / the cited criterion holds: Run bun test save.test.ts and observe the failing persistence assertion.',
      ],
      seams: [],
      blockedBy: [],
      kind: 'implementation',
      originFindingId: 'finding_1',
    })
  })

  it('stores a fix ticket through a batch that closes with no review ticket', () => {
    // The load-bearing placement constraint of the one-review-ticket seatbelt:
    // it lives at G3 and at the `emit_tickets` tool surface, NEVER in
    // `storeTickets`. The internal mints — this one, and the burner's mid-run
    // verification pass — store review-less batches by design.
    const [fix] = storeTickets(ctx, featureId, [buildFixTicket({ id: 'finding_1', ...defect() })])
    expect(fix.kind).toBe('implementation')
    expect(listTickets(ctx, featureId).map((t) => t.id)).toContain(fix.id)
  })

  it('reports a defect as an open finding for the lead, minting no fix ticket', () => {
    const result = reportFinding(ctx, { featureId, reviewTicket, input: defect() })
    expect(result).toMatchObject({ fixTicket: null, overCap: false })
    expect(result.finding).toMatchObject({ status: 'open', openReason: null, fixTicketId: null })
    expect(result.finding).not.toHaveProperty('lap')
    expect(listTickets(ctx, featureId)).toHaveLength(1)
    expect(listAfter(ctx, featureId).map((event) => event.type)).toContain('finding.reported')
  })

  it('keeps verification defects open without minting another fix wave', () => {
    const verification = storeTickets(ctx, featureId, [{
      title: 'Verify fixes', goal: 'Verify', context: '', acceptanceCriteria: [], seams: [],
      blockedBy: [], kind: 'review', passKind: 'verification',
    }])[0]
    const result = reportFinding(ctx, { featureId, reviewTicket: verification, input: defect() })
    expect(result).toMatchObject({ fixTicket: null, overCap: false })
    expect(result.finding).toMatchObject({ status: 'open', openReason: 'verification', fixTicketId: null })
    expect(listTickets(ctx, featureId)).toHaveLength(2)
  })

  it('mints no ticket however many defects arrive, and none for an observation', () => {
    for (let index = 1; index <= 9; index += 1) {
      const reported = reportFinding(ctx, { featureId, reviewTicket, input: defect(`Defect ${index}`) })
      expect(reported).toMatchObject({ fixTicket: null, overCap: false })
      expect(reported.finding).toMatchObject({ status: 'open', openReason: null })
    }

    const observation = reportFinding(ctx, {
      featureId, reviewTicket,
      input: { ...defect('Could not verify mobile'), kind: 'observation', reproStep: undefined },
    })
    expect(observation.fixTicket).toBeNull()
    expect(listTickets(ctx, featureId)).toHaveLength(1)
    expect(listByFeature(ctx, featureId)).toHaveLength(10)
  })

  /**
   * A review ticket that is retried reports its defects again. A second row
   * for the same defect would hand the lead two findings for one problem — so
   * the report refreshes the one its dead attempt recorded.
   */
  describe('a defect this review already reported', () => {
    it('refreshes the earlier finding instead of storing a second one', () => {
      const first = reportFinding(ctx, { featureId, reviewTicket, input: defect() })
      markFailed(ctx, first.finding.id, 'the attempt died')

      const again = reportFinding(ctx, {
        featureId,
        reviewTicket,
        input: { ...defect(), detail: 'The save action drops the edited value on reload too.' },
      })

      expect(again.fixTicket).toBeNull()
      expect(again.finding).toMatchObject({
        id: first.finding.id, status: 'open', failureReason: null, openReason: null,
        detail: 'The save action drops the edited value on reload too.',
      })
      expect(listTickets(ctx, featureId)).toHaveLength(1)
      expect(listByFeature(ctx, featureId)).toHaveLength(1)
      expect(listAfter(ctx, featureId).map((event) => event.type)).toContain('finding.reported')
    })

    it('stores a fresh finding for a defect reported somewhere else', () => {
      reportFinding(ctx, { featureId, reviewTicket, input: defect() })

      reportFinding(ctx, {
        featureId,
        reviewTicket,
        input: { ...defect(), location: 'packages/server/src/load.ts:9' },
      })

      expect(listByFeature(ctx, featureId)).toHaveLength(2)
    })

    it('stores a fresh finding when the earlier one was dismissed', () => {
      // A human's decision this report has no business overturning.
      const first = reportFinding(ctx, { featureId, reviewTicket, input: defect() })
      dismiss(ctx, first.finding.id)

      reportFinding(ctx, { featureId, reviewTicket, input: defect() })

      expect(listByFeature(ctx, featureId).map((f) => f.status).sort()).toEqual(['dismissed', 'open'])
    })
  })

  it('emits finding.updated for each status mutation', () => {
    const { finding } = reportFinding(ctx, { featureId, reviewTicket, input: defect() })
    expect(markFixing(ctx, finding.id).status).toBe('fixing')
    expect(markFixed(ctx, finding.id).status).toBe('fixed')
    expect(markFailed(ctx, finding.id, 'tests failed')).toMatchObject({
      status: 'failed', openReason: 'fix-failed', failureReason: 'tests failed',
    })
    expect(dismiss(ctx, finding.id).status).toBe('dismissed')
    expect(listAfter(ctx, featureId).filter((event) => event.type === 'finding.updated')).toHaveLength(4)
  })

  it.each(['failed', 'cancelled'] as const)('returns a fixing defect to open when its fix ticket is %s', (status) => {
    const { finding, fixTicket } = reportWithFixTicket(ctx, { featureId, reviewTicket, input: defect() })
    markFixing(ctx, finding.id)
    updateTicket(ctx, fixTicket.id, { status })
    expect(viewByFeature(ctx, featureId).openDefects.map((row) => row.id)).toContain(finding.id)
  })

  it('marks the finding failed when an orphaned burning fix ticket is swept', () => {
    const { finding, fixTicket } = reportWithFixTicket(ctx, { featureId, reviewTicket, input: defect() })
    markFixing(ctx, finding.id)
    updateTicket(ctx, fixTicket.id, { status: 'burning' })
    sweepOrphanedBurning(ctx, featureId, 'agent vanished')
    expect(listByFeature(ctx, featureId)[0]).toMatchObject({
      status: 'failed', openReason: 'fix-failed', failureReason: 'agent vanished',
    })
  })

  it('orders equal-time findings by id for a stable ledger', () => {
    reportFinding(ctx, { featureId, reviewTicket, input: defect('Zulu') })
    reportFinding(ctx, { featureId, reviewTicket, input: defect('Alpha') })
    ctx.db.update(reviewFindings).set({ createdAt: 100 }).run()
    const first = listByFeature(ctx, featureId).map((finding) => finding.id)
    expect(first).toEqual([...first].sort())
    expect(listByFeature(ctx, featureId).map((finding) => finding.id)).toEqual(first)
  })

  /**
   * What the feature's agent does about a defect a review left open: close it
   * as addressed or dismiss it, each with a note. Every case starts from the
   * one state that is genuinely open — a defect whose own fix ticket gave up.
   */
  describe('resolving an open defect', () => {
    /** Report a defect and let its fix ticket fail, leaving it open. */
    function abandonedDefect(title = 'Broken save'): string {
      const { finding, fixTicket } = reportWithFixTicket(ctx, { featureId, reviewTicket, input: defect(title) })
      updateTicket(ctx, fixTicket.id, { status: 'failed' })
      return finding.id
    }

    it('closes a defect as addressed on the session\'s word, with the attestation kept', () => {
      const findingId = abandonedDefect()

      const closed = closeAsAddressed(ctx, featureId, findingId, 'addressed by ticket 7')

      expect(closed).toMatchObject({
        status: 'fixed',
        resolvedBy: 'session',
        resolutionNote: 'addressed by ticket 7',
      })
      expect(openDefects(ctx, featureId)).toEqual([])
    })

    it('dismisses a defect on the session\'s word, with the reason kept', () => {
      const findingId = abandonedDefect()

      expect(dismissAsAgent(ctx, featureId, findingId, '  out of scope  ')).toMatchObject({
        status: 'dismissed',
        resolvedBy: 'session',
        resolutionNote: 'out of scope',
      })
      expect(listAfter(ctx, featureId).filter((event) => event.type === 'finding.updated')).toHaveLength(1)
      expect(openDefects(ctx, featureId)).toEqual([])
    })

    it('refuses to close or dismiss without a note', () => {
      const findingId = abandonedDefect()
      expect(() => closeAsAddressed(ctx, featureId, findingId, '   ')).toThrow(InvalidInputError)
      expect(() => dismissAsAgent(ctx, featureId, findingId, '')).toThrow(InvalidInputError)
      expect(listByFeature(ctx, featureId)[0].status).toBe('open')
    })

    it('refuses anything that is not this feature\'s open defect', () => {
      const settled = reportWithFixTicket(ctx, { featureId, reviewTicket, input: defect('Being fixed') }).finding
      const observation = reportFinding(ctx, {
        featureId, reviewTicket,
        input: { ...defect('Could not verify mobile'), kind: 'observation', reproStep: undefined },
      }).finding
      const elsewhere = seedFeature(ctx, project.id, { slug: 'other' })
      const otherReview = storeTickets(ctx, elsewhere.id, [{
        title: 'Review', goal: 'Review', context: '', acceptanceCriteria: [], seams: [],
        blockedBy: [], kind: 'review',
      }])[0]
      const foreign = reportFinding(ctx, {
        featureId: elsewhere.id, reviewTicket: otherReview, input: defect('Not ours'),
      }).finding
      const dismissed = abandonedDefect('Waved away')
      dismiss(ctx, dismissed)
      const fixed = abandonedDefect('Already fixed')
      markFixed(ctx, fixed)

      // A defect the run is still fixing, an observation, another feature's, one
      // the human already settled, and one that landed.
      for (const id of [settled.id, observation.id, foreign.id, dismissed, fixed]) {
        expect(() => dismissAsAgent(ctx, featureId, id, 'no')).toThrow(InvalidInputError)
      }
    })

    it('stamps the burner\'s own fix with fix-ticket provenance, not the session\'s', () => {
      const findingId = abandonedDefect()
      expect(markFixed(ctx, findingId)).toMatchObject({ resolvedBy: 'fix-ticket', resolutionNote: null })
    })

    it('counts every finding on the feature, whichever review reported it', () => {
      const first = abandonedDefect('The first review left this open')
      reportFinding(ctx, {
        featureId, reviewTicket,
        input: { ...defect('Never verified mobile'), kind: 'observation', reproStep: undefined },
      })
      const later = abandonedDefect('A later review found this')

      const view = viewByFeature(ctx, featureId)
      expect(view.summary).toEqual({ found: 2, fixed: 0, open: 2, observations: 1 })
      expect(view.openDefects.map((finding) => finding.id)).toEqual([first, later])
      expect(view.findings).toHaveLength(3)
      expect(view).not.toHaveProperty('carriedFindings')
    })
  })
})
