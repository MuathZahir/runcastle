import type { Project, Ticket } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { InvalidInputError } from '../src/errors'
import { listAfter } from '../src/services/events'
import {
  buildFixTicket,
  carryFinding,
  closeAsAddressed,
  dismiss,
  listByFeature,
  markFailed,
  markFixed,
  markFixing,
  openDefectsAcrossLaps,
  reopenFinding,
  reportFinding,
  viewByFeature,
} from '../src/services/review-findings'
import { triagePreview } from '../src/services/test-notes'
import { listByFeature as listTickets, storeTickets, sweepOrphanedBurning, updateTicket } from '../src/services/tickets'
import { features, reviewFindings } from '../src/db/schema'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

describe('review findings service', () => {
  let ctx: AppCtx
  let project: Project
  let featureId: string
  let reviewTicket: Ticket

  beforeEach(async () => {
    ctx = await makeTestCtx()
    project = seedProject(ctx)
    const feature = seedFeature(ctx, project.id, { lap: 3 })
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

  it('reports a defect and links a pending fix ticket both ways', () => {
    const result = reportFinding(ctx, { featureId, reviewTicket, input: defect() })
    expect(result.finding).toMatchObject({ lap: 3, status: 'open', fixTicketId: result.fixTicket?.id })
    expect(result.fixTicket).toMatchObject({
      status: 'pending', lap: 3, kind: 'implementation', blockedBy: [reviewTicket.seq],
      originFindingId: result.finding.id,
    })
    expect(listTickets(ctx, featureId)).toHaveLength(2)
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

  it('caps auto-fixes at eight and never mints a ticket for an observation', () => {
    for (let index = 1; index <= 8; index += 1) {
      expect(reportFinding(ctx, { featureId, reviewTicket, input: defect(`Defect ${index}`) }).overCap).toBe(false)
    }
    const ninth = reportFinding(ctx, { featureId, reviewTicket, input: defect('Defect 9') })
    expect(ninth).toMatchObject({ fixTicket: null, overCap: true })
    expect(ninth.finding).toMatchObject({ status: 'open', openReason: 'over-cap', fixTicketId: null })

    const observation = reportFinding(ctx, {
      featureId, reviewTicket,
      input: { ...defect('Could not verify mobile'), kind: 'observation', reproStep: undefined },
    })
    expect(observation.fixTicket).toBeNull()
    expect(listTickets(ctx, featureId)).toHaveLength(9)
    expect(listByFeature(ctx, featureId)).toHaveLength(10)
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
    const { finding, fixTicket } = reportFinding(ctx, { featureId, reviewTicket, input: defect() })
    markFixing(ctx, finding.id)
    updateTicket(ctx, fixTicket!.id, { status })
    expect(viewByFeature(ctx, featureId).openDefects.map((row) => row.id)).toContain(finding.id)
  })

  it('marks the finding failed when an orphaned burning fix ticket is swept', () => {
    const { finding, fixTicket } = reportFinding(ctx, { featureId, reviewTicket, input: defect() })
    markFixing(ctx, finding.id)
    updateTicket(ctx, fixTicket!.id, { status: 'burning' })
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
   * The lap boundary's half of the lifecycle: what a later lap does about a
   * defect the review before it left open. Every case here starts from the one
   * state that is genuinely the human's problem — a defect whose own fix ticket
   * gave up — because that is precisely the set `viewByFeature` counts open.
   */
  describe('across a lap boundary', () => {
    /** Move the feature on, as a Rethink does; the finding keeps its own lap. */
    function nextLap(lap: number): void {
      ctx.db.update(features).set({ lap }).where(eq(features.id, featureId)).run()
    }

    /** Report a defect on lap 3 and let its fix ticket fail, leaving it open. */
    function abandonedDefect(title = 'Broken save'): string {
      const { finding, fixTicket } = reportFinding(ctx, { featureId, reviewTicket, input: defect(title) })
      updateTicket(ctx, fixTicket!.id, { status: 'failed' })
      return finding.id
    }

    it('carries a defect into the lap doing the carrying, out of the open count', () => {
      const findingId = abandonedDefect()
      nextLap(4)

      const carried = carryFinding(ctx, featureId, findingId, '  lap 4 is rewriting the save path  ')

      expect(carried).toMatchObject({
        status: 'carried',
        carriedLap: 4,
        resolutionNote: 'lap 4 is rewriting the save path',
        resolvedBy: null,
      })
      expect(listAfter(ctx, featureId).filter((event) => event.type === 'finding.updated')).toHaveLength(1)
      // Its own pile, at any lap, and never the open one — the state `defectState`
      // must not read as open however the dead fix ticket beside it looks.
      const view = viewByFeature(ctx, featureId)
      expect(view.carriedFindings.map((finding) => finding.id)).toEqual([findingId])
      expect(view.openDefects).toEqual([])
      expect(openDefectsAcrossLaps(ctx, featureId)).toEqual([])
    })

    it('carries with no note at all', () => {
      const findingId = abandonedDefect()
      expect(carryFinding(ctx, featureId, findingId)).toMatchObject({ carriedLap: 3, resolutionNote: null })
    })

    it('refuses to carry anything that is not this feature\'s open or carried defect', () => {
      const settled = reportFinding(ctx, { featureId, reviewTicket, input: defect('Being fixed') }).finding
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
        expect(() => carryFinding(ctx, featureId, id)).toThrow(InvalidInputError)
      }
    })

    it('closes a defect as addressed on the session\'s word, with the attestation kept', () => {
      const findingId = abandonedDefect()
      nextLap(4)

      const closed = closeAsAddressed(ctx, featureId, findingId, 'addressed by lap 4 ticket 7')

      expect(closed).toMatchObject({
        status: 'fixed',
        resolvedBy: 'session',
        resolutionNote: 'addressed by lap 4 ticket 7',
        carriedLap: null,
      })
      expect(openDefectsAcrossLaps(ctx, featureId)).toEqual([])
    })

    it('refuses to close as addressed without an attestation', () => {
      const findingId = abandonedDefect()
      expect(() => closeAsAddressed(ctx, featureId, findingId, '   ')).toThrow(InvalidInputError)
      expect(listByFeature(ctx, featureId)[0].status).toBe('open')
    })

    it('lets a carried defect be closed later, and reopened by the human meanwhile', () => {
      const findingId = abandonedDefect()
      nextLap(4)
      carryFinding(ctx, featureId, findingId)

      // Carrying parks a defect, it does not freeze it.
      expect(reopenFinding(ctx, findingId)).toMatchObject({ status: 'open', carriedLap: null })
      expect(() => reopenFinding(ctx, findingId)).toThrow(InvalidInputError)
      carryFinding(ctx, featureId, findingId)
      expect(closeAsAddressed(ctx, featureId, findingId, 'lap 4 rewrote it').status).toBe('fixed')
    })

    it('stamps the burner\'s own fix with fix-ticket provenance, not the session\'s', () => {
      const findingId = abandonedDefect()
      expect(markFixed(ctx, findingId)).toMatchObject({ resolvedBy: 'fix-ticket', resolutionNote: null })
    })

    it('counts the summary from this lap alone, while the carry channel still sees the last one\'s', () => {
      const stale = abandonedDefect('Lap 3 left this open')
      reportFinding(ctx, {
        featureId, reviewTicket,
        input: { ...defect('Lap 3 never verified mobile'), kind: 'observation', reproStep: undefined },
      })
      nextLap(4)
      const fresh = abandonedDefect('Lap 4 found this')

      const view = viewByFeature(ctx, featureId)
      expect(view.summary).toEqual({ found: 1, fixed: 0, open: 1, observations: 0 })
      expect(view.openDefects.map((finding) => finding.id)).toEqual([fresh])
      // Every finding is still listed; only the counts narrowed.
      expect(view.findings).toHaveLength(3)
      // The lap that has to answer for the stale one can still reach it.
      expect(openDefectsAcrossLaps(ctx, featureId).map((finding) => finding.id)).toEqual([stale, fresh])
    })

    it('hands the boundary triage the same current-lap defect count', () => {
      abandonedDefect('Lap 3 left this open')
      expect(triagePreview(ctx, featureId).openDefects).toBe(1)
      nextLap(4)
      expect(triagePreview(ctx, featureId).openDefects).toBe(0)
    })
  })
})
