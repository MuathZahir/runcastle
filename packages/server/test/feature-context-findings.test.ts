import { join } from 'node:path'
import type { Feature, Project, Ticket } from '@runcastle/core'
import { reviewDir } from '@runcastle/core/paths'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import { workers } from '../src/db/schema'
import { toolGetFeatureContext } from '../src/mcp/server'
import { dismiss, openDefects } from '../src/services/review-findings'
import { storeTickets, updateTicket } from './helpers/tickets'
import { makeTestCtx } from './helpers/db'
import { reportWithFixTicket } from './helpers/findings'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * What `get_feature_context` hands the feature's agent about its reviews: every
 * defect still open, whichever review reported it, and where the latest review
 * pass left its evidence. No phase, no lap, nothing carried — a finding stays
 * open until its fix lands or the agent resolves it
 * (tickets-and-review-are-tools-not-phases decisions 2 and 11).
 */
describe('get_feature_context: findings and review evidence', () => {
  let ctx: AppCtx
  let repoPath: string
  let project: Project
  let feature: Feature
  let session: ReturnType<typeof createSessionRow>

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = tmpRepo()
    project = seedProject(ctx, repoPath)
    feature = seedFeature(ctx, project.id, { slug: 'dark-mode' })
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

  function reviewTicket(): Ticket {
    return storeTickets(ctx, feature.id, [
      {
        title: 'Review', goal: 'Review', context: '', acceptanceCriteria: [], seams: [],
        blockedBy: [], kind: 'review',
      },
    ])[0]
  }

  /** A defect whose fix ticket failed — open, and the agent's to answer. */
  function openDefect(review: Ticket, title = 'Deletes are never retried'): void {
    const { fixTicket } = reportWithFixTicket(ctx, {
      featureId: feature.id,
      reviewTicket: review,
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

  it('carries no phase, lap, carried defects or test notes', () => {
    const context = toolGetFeatureContext(ctx, session) as unknown as Record<string, unknown>
    for (const gone of ['phase', 'lap', 'carriedDefects', 'testNotes', 'currentLapReview']) {
      expect(context).not.toHaveProperty(gone)
    }
    expect(context.feature).not.toHaveProperty('phase')
    expect(context.feature).not.toHaveProperty('lap')
  })

  it('states each open defect with its id, title, location, detail and repro step', () => {
    openDefect(reviewTicket())
    const [defect] = openDefects(ctx, feature.id)
    expect(toolGetFeatureContext(ctx, session).openDefects).toEqual([
      {
        // The handle every disposition takes: a ticket's `originFindingId`,
        // and `resolve_finding`'s `findingId`.
        id: defect.id,
        title: 'Deletes are never retried',
        location: 'packages/server/src/dlq.ts:88',
        detail: 'The retry lands at the seam but the endpoint never calls it.',
        reproStep: 'Click Retry on a dead-lettered job and watch nothing change.',
      },
    ])
  })

  it('keeps every review’s open defects, not only the latest review’s', () => {
    openDefect(reviewTicket(), 'Deletes are never retried')
    openDefect(reviewTicket(), 'The toast never dismisses')
    expect(toolGetFeatureContext(ctx, session).openDefects.map((d) => d.title)).toEqual([
      'Deletes are never retried',
      'The toast never dismisses',
    ])
  })

  it('drops a defect once it is dismissed, and states none being fixed', () => {
    const review = reviewTicket()
    openDefect(review)
    dismiss(ctx, openDefects(ctx, feature.id)[0].id)
    // Reported with a fix ticket still pending: the fix owns it.
    reportWithFixTicket(ctx, {
      featureId: feature.id,
      reviewTicket: review,
      input: {
        kind: 'defect', severity: 'low', title: 'Being fixed', location: 'a.ts:1',
        citation: 'spec.md §a', detail: 'd', reproStep: 'r',
      },
    })
    expect(toolGetFeatureContext(ctx, session).openDefects).toEqual([])
  })

  it('names the latest finished Review worker’s evidence by path, and none before a pass has finished', () => {
    expect(toolGetFeatureContext(ctx, session).reviewEvidence).toBeNull()
    const now = Date.now()
    const insert = (id: string, status: 'working' | 'handed-back', handbackSummary: string | null) =>
      ctx.db
        .insert(workers)
        .values({ id, featureId: feature.id, projectId: feature.projectId, label: 'Review', purpose: 'p', kind: 'review', reviewMode: 'drive', model: 'm', runtime: 'claude-code', startedBy: 'lead', status, handbackSummary, engine: 'docker', featureBranch: feature.branch, createdAt: now, updatedAt: now })
        .run()
    insert('wkr_running', 'working', null)
    expect(toolGetFeatureContext(ctx, session).reviewEvidence).toBeNull()
    insert('wkr_done', 'handed-back', 'Everything holds.')

    expect(toolGetFeatureContext(ctx, session).reviewEvidence).toEqual({
      workerId: 'wkr_done',
      label: 'Review',
      status: 'handed-back',
      reviewMode: 'drive',
      account: 'Everything holds.',
      dir: reviewDir('wkr_done'),
    })
  })
})
