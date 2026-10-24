import { join } from 'node:path'
import type { Feature, Project, Ticket } from '@runcastle/core'
import { reviewDir } from '@runcastle/core/paths'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { features } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import { toolGetFeatureContext } from '../src/mcp/server'
import { carriedWork } from '../src/services/carried-work'
import { carryFinding, openDefectsAcrossLaps } from '../src/services/review-findings'
import { storeTickets, updateTicket } from '../src/services/tickets'
import { makeTestCtx } from './helpers/db'
import { reportWithFixTicket } from './helpers/findings'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * The carry channel: what a lap hands the next one, and whether the next one
 * arrives knowing it.
 *
 * The bug this pins is a session opened BECAUSE of carried notes and open
 * defects that could name neither — the notes reached it as a pointer to a file
 * `get_feature_context` marked withheld ("already triaged into this lap's
 * tickets", untrue of anything carried), and the defects, which no doc renders,
 * reached it through no channel at all.
 */
describe('the carry channel into the next lap', () => {
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
    feature = seedFeature(ctx, project.id, { slug: 'dark-mode', phase: 'review' })
    reviewTicket = storeTickets(ctx, feature.id, [
      {
        title: 'Review', goal: 'Review', context: '', acceptanceCriteria: [], seams: [],
        blockedBy: [], kind: 'review',
      },
    ])[0]
    session = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'chat',
      worktreePath: repoPath,
    })
    markSessionLive(ctx, session.id)
    setRuntimeCtx(ctx)
  })

  afterEach(() => {
    clearRuntimeCtx()
    rmTemp(repoPath)
  })

  /**
   * A defect whose in-run fix ticket failed, which is the state `openDefects`
   * counts — a defect still being fixed is the run's problem, not the lap's.
   */
  function openDefect(title = 'Deletes are never retried'): void {
    const { fixTicket } = reportWithFixTicket(ctx, {
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
  }

  it('states each open defect with its id, title, location, detail and repro step', () => {
    openDefect()
    const [defect] = openDefectsAcrossLaps(ctx, feature.id)
    expect(toolGetFeatureContext(ctx, session).openDefects).toEqual([
      {
        // The id is the handle every disposition verb takes: a ticket's
        // `originFindingId`, and `resolve_finding`'s `findingId`. Without it a
        // session could read the defects and act on none of them.
        id: defect.id,
        title: 'Deletes are never retried',
        location: 'packages/server/src/dlq.ts:88',
        detail: 'The retry lands at the seam but the endpoint never calls it.',
        reproStep: 'Click Retry on a dead-lettered job and watch nothing change.',
      },
    ])
  })

  it('hands a lap the defects an earlier one parked, beside the ones still open', () => {
    openDefect('Deletes are never retried')
    openDefect('The toast never dismisses')
    const [, parked] = openDefectsAcrossLaps(ctx, feature.id)
    carryFinding(ctx, feature.id, parked.id)

    const context = toolGetFeatureContext(ctx, session)
    // Carried leaves the open pile and joins the agenda — the same move a
    // carried note makes, and the reason the gate stops demanding an answer.
    expect(context.openDefects.map((defect) => defect.title)).toEqual(['Deletes are never retried'])
    expect(context.carriedDefects).toEqual([
      {
        id: parked.id,
        title: 'The toast never dismisses',
        location: 'packages/server/src/dlq.ts:88',
        detail: 'The retry lands at the seam but the endpoint never calls it.',
        reproStep: 'Click Retry on a dead-lettered job and watch nothing change.',
      },
    ])
  })

  it('carries no defect that the run is still fixing, and none at all by default', () => {
    expect(toolGetFeatureContext(ctx, session).openDefects).toEqual([])
    // Reported with a fix ticket that is pending: the run owns it.
    reportWithFixTicket(ctx, {
      featureId: feature.id,
      reviewTicket,
      input: {
        kind: 'defect', severity: 'low', title: 'Being fixed', location: 'a.ts:1',
        citation: 'spec.md §a', detail: 'd', reproStep: 'r',
      },
    })
    expect(toolGetFeatureContext(ctx, session).openDefects).toEqual([])
  })

  /**
   * The third thing a lap carries, and the one with no other channel at all: the
   * previous lap's review evidence. `tickets` strips every `digest`, and the
   * review agent reports through host scratch space outside the repo, so a lap
   * session that is not handed the path cannot read the review of the build it is
   * being asked to plan past.
   */
  it('names the previous lap’s review evidence in the context payload, by path', () => {
    updateTicket(ctx, reviewTicket.id, {
      status: 'done',
      reviewMode: 'drive',
      reviewVerdict: 'unverified',
      reviewVerdictReason: 'The browser could not attach.',
    })
    ctx.db.update(features).set({ lap: 2 }).where(eq(features.id, feature.id)).run()

    expect(toolGetFeatureContext(ctx, session).reviewEvidence).toEqual([
      {
        ticketId: reviewTicket.id,
        seq: reviewTicket.seq,
        status: 'done',
        reviewMode: 'drive',
        reviewVerdict: 'unverified',
        reviewVerdictReason: 'The browser could not attach.',
        lap: 1,
        dir: reviewDir(reviewTicket.id),
        digestPath: join(reviewDir(reviewTicket.id), 'DIGEST.md'),
      },
    ])
  })

  it('names none while the feature is still on the lap that review belongs to', () => {
    updateTicket(ctx, reviewTicket.id, { status: 'done' })

    // Lap 1's review is the CURRENT lap's review — the review loop still owns it.
    expect(toolGetFeatureContext(ctx, session).reviewEvidence).toEqual([])
  })
})
