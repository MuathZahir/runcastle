import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, Project, Ticket, TicketInput } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { features } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import { toolCompletePhase } from '../src/mcp/server'
import { burnWarnings } from '../src/services/burn-warnings'
import { markFixProgress, reportFinding } from '../src/services/review-findings'
import { storeTickets, updateTicket } from '../src/services/tickets'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * The warnings that used to be refusals (decisions §5).
 *
 * Each line here was a gate: G3's one-review-ticket rule, the
 * un-dispositioned-earlier-lap-defects rule, and G2's spec file check. What has
 * to be right now is that each one fires exactly on its own condition and
 * nothing else, and that the same list reaches BOTH audiences — the human at the
 * Burn click, through the tRPC query, and the ticket-writing session, through
 * `complete_phase("tickets")`, which no longer refuses on any of them.
 */
describe('burn warnings', () => {
  let ctx: AppCtx
  let repoPath: string
  let project: Project
  let feature: Feature
  let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
  let session: ReturnType<typeof createSessionRow>

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = tmpRepo()
    project = seedProject(ctx, repoPath)
    feature = seedFeature(ctx, project.id, { slug: 'dark-mode', phase: 'planning' })
    caller = createCallerFactory(appRouter)(ctx)
    session = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'ideation',
      worktreePath: repoPath,
    })
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

  function writeSpec(): void {
    const docsDir = join(repoPath, 'docs', 'features', feature.slug)
    mkdirSync(docsDir, { recursive: true })
    writeFileSync(join(docsDir, 'spec.md'), '# Spec\n\nthe build order', 'utf8')
  }

  /** The batch a healthy lap emits: work plus the review ticket that closes it. */
  function healthyBatch(): Ticket[] {
    return storeTickets(ctx, feature.id, [
      ticketInput('Add the thing'),
      { ...ticketInput('Review the lap'), kind: 'review' },
    ])
  }

  /**
   * A defect lap 1's review left open: reported, its in-run fix ticket tried and
   * failed, so the defect is the NEXT lap's to answer for.
   */
  function openDefectFromLapOne(title = 'Deletes are never retried'): void {
    const reviewTicket = storeTickets(ctx, feature.id, [
      { ...ticketInput('Lap 1 review'), kind: 'review' },
    ])[0]
    updateTicket(ctx, reviewTicket.id, { status: 'done' })
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
    ctx.db.update(features).set({ lap: 2 }).where(eq(features.id, feature.id)).run()
    feature = { ...feature, lap: 2 }
  }

  it('says nothing when the batch closes with a review ticket and the spec is on disk', () => {
    healthyBatch()
    writeSpec()
    expect(burnWarnings(ctx, feature.id)).toEqual([])
  })

  it('warns when no pending ticket carries kind "review"', () => {
    storeTickets(ctx, feature.id, [ticketInput('Add the thing')])
    writeSpec()
    expect(burnWarnings(ctx, feature.id)).toEqual([expect.stringContaining('no review ticket')])
  })

  it('counts only PENDING review tickets — an earlier lap’s finished one is not this batch’s', () => {
    const [done] = storeTickets(ctx, feature.id, [{ ...ticketInput('Lap 1 review'), kind: 'review' }])
    updateTicket(ctx, done.id, { status: 'done' })
    storeTickets(ctx, feature.id, [ticketInput('Lap 2 work')])
    writeSpec()
    expect(burnWarnings(ctx, feature.id)).toEqual([expect.stringContaining('no review ticket')])
  })

  it('warns about an earlier lap’s open defect, naming it', () => {
    openDefectFromLapOne()
    healthyBatch()
    writeSpec()
    const [warning, ...rest] = burnWarnings(ctx, feature.id)
    expect(rest).toEqual([])
    expect(warning).toContain('Deletes are never retried')
    expect(warning).toContain('resolve_finding')
  })

  it('warns when the lap has no spec.md to burn against', () => {
    healthyBatch()
    expect(burnWarnings(ctx, feature.id)).toEqual([expect.stringContaining('no spec.md')])
  })

  it('reaches the Burn dialog through the feature router, unchanged', async () => {
    storeTickets(ctx, feature.id, [ticketInput('Add the thing')])
    await expect(caller.feature.burnWarnings({ featureId: feature.id })).resolves.toEqual(
      burnWarnings(ctx, feature.id),
    )
  })

  describe('complete_phase("tickets") hears the same list', () => {
    it('returns ok with the warning instead of the refusal G3 used to be', () => {
      storeTickets(ctx, feature.id, [ticketInput('Add the thing')])
      writeSpec()

      const out = toolCompletePhase(ctx, session, { phase: 'tickets' })

      expect(out.ok).toBe(true)
      expect(out.warnings).toEqual([expect.stringContaining('no review ticket')])
      // Warned, not parked: the tickets are still armed for the human's click.
      expect(out.waitingOn).toBe('human burn')
    })

    it('returns no warnings once the batch carries its review ticket', () => {
      healthyBatch()
      writeSpec()
      expect(toolCompletePhase(ctx, session, { phase: 'tickets' })).toMatchObject({
        ok: true,
        warnings: [],
      })
    })
  })
})
