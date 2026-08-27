import type { Feature, Project, Ticket, WorkflowDef } from '@runcastle/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { getFeatureRow } from '../src/services/repo'
import { markFailed, reportFinding } from '../src/services/review-findings'
import { listByFeature as listTickets, storeTickets, updateTicket } from '../src/services/tickets'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { workflowRegistry } from '../src/workflows/registry'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * The wire the review page's lead card and its "Fix N open defects" button talk
 * to. The findings lifecycle itself is covered at the service seam
 * (`review-findings.test.ts`); what has to be right HERE is the read model the
 * page renders — counts that cannot disagree with the list under them — and that
 * one click really does mint the tickets AND start the burn.
 *
 * A stubbed ticket-burner keeps sandcastle out of the loop: it leaves the fresh
 * tickets pending, so the feature parks at implementation and the run is
 * observable without any of the real machinery.
 */

const stubBurner: WorkflowDef = {
  id: 'ticket-burner',
  async run() {
    return { status: 'succeeded', summary: 'stub' }
  },
}

describe('findings router', () => {
  let ctx: AppCtx
  let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
  let project: Project
  let feature: Feature
  let reviewTicket: Ticket
  let original: WorkflowDef | undefined

  beforeEach(async () => {
    ctx = await makeTestCtx()
    caller = createCallerFactory(appRouter)(ctx)
    project = seedProject(ctx)
    feature = seedFeature(ctx, project.id, { phase: 'review' })
    reviewTicket = storeTickets(ctx, feature.id, [
      {
        title: 'Review the lap',
        goal: 'review',
        context: '',
        acceptanceCriteria: [],
        seams: [],
        blockedBy: [],
        kind: 'review',
      },
    ])[0]
    updateTicket(ctx, reviewTicket.id, { status: 'done', commits: ['abc'] })
    original = workflowRegistry.get('ticket-burner')
    workflowRegistry.set('ticket-burner', stubBurner)
  })

  afterEach(() => {
    if (original) workflowRegistry.set('ticket-burner', original)
    else workflowRegistry.delete('ticket-burner')
  })

  const defect = (title: string) => ({
    kind: 'defect' as const,
    severity: 'high' as const,
    title,
    location: 'packages/server/src/save.ts:42',
    citation: 'spec.md §Save requires persistence',
    detail: 'The save action drops the edited value.',
    reproStep: 'Run the save test and watch the persistence assertion fail.',
  })

  const observation = (title: string) => ({
    ...defect(title),
    kind: 'observation' as const,
    severity: 'low' as const,
  })

  /** Report a defect and take its fix ticket to a terminal state. */
  const report = (title: string) =>
    reportFinding(ctx, { featureId: feature.id, reviewTicket, input: defect(title) })

  it('lists findings with a summary computed from the fix tickets', async () => {
    const landed = report('the save drops the value')
    const broke = report('the chip goes grey')
    reportFinding(ctx, {
      featureId: feature.id,
      reviewTicket,
      input: observation('mobile was not verified'),
    })
    updateTicket(ctx, landed.fixTicket!.id, { status: 'done', commits: ['def'] })
    updateTicket(ctx, broke.fixTicket!.id, { status: 'failed' })
    markFailed(ctx, broke.finding.id, 'tests still red')

    const view = await caller.findings.listByFeature({ featureId: feature.id })

    expect(view.summary).toEqual({ found: 2, fixed: 1, open: 1, observations: 1 })
    expect(view.findings.map((f) => f.title).sort()).toEqual([
      'mobile was not verified',
      'the chip goes grey',
      'the save drops the value',
    ])
    // The one still open is the one whose fix ticket failed, with its reason.
    expect(view.openDefects).toHaveLength(1)
    expect(view.openDefects[0]).toMatchObject({
      title: 'the chip goes grey',
      status: 'failed',
      openReason: 'fix-failed',
      failureReason: 'tests still red',
    })
  })

  it('counts a defect over the auto-fix cap as open, with no ticket of its own', async () => {
    for (let index = 1; index <= 9; index += 1) report(`defect ${index}`)

    const view = await caller.findings.listByFeature({ featureId: feature.id })

    expect(view.summary).toMatchObject({ found: 9, open: 1, observations: 0 })
    expect(view.openDefects).toHaveLength(1)
    expect(view.openDefects[0]).toMatchObject({ openReason: 'over-cap', fixTicketId: null })
    expect(view.findings.filter((f) => f.fixTicketId === null)).toHaveLength(1)
  })

  it('dismisses a finding, and the open count drops', async () => {
    const capped = report('over the cap')
    updateTicket(ctx, capped.fixTicket!.id, { status: 'failed' })
    markFailed(ctx, capped.finding.id, 'could not land')
    expect((await caller.findings.listByFeature({ featureId: feature.id })).summary.open).toBe(1)

    const dismissed = await caller.findings.dismiss({ findingId: capped.finding.id })

    expect(dismissed.status).toBe('dismissed')
    const view = await caller.findings.listByFeature({ featureId: feature.id })
    expect(view.summary).toEqual({ found: 1, fixed: 0, open: 0, observations: 0 })
  })

  it('fixes every open defect in one call: a ticket each on this lap, then a burn', async () => {
    const failed = report('the save drops the value')
    updateTicket(ctx, failed.fixTicket!.id, { status: 'failed' })
    markFailed(ctx, failed.finding.id, 'tests still red')
    // A ninth defect never got a ticket at all — the cap held it back.
    for (let index = 2; index <= 9; index += 1) report(`defect ${index}`)
    for (const ticket of listTickets(ctx, feature.id)) {
      if (ticket.status === 'pending') updateTicket(ctx, ticket.id, { status: 'done', commits: ['abc'] })
    }

    const result = await caller.findings.fixOpenDefects({ featureId: feature.id })

    expect(result.runId).toMatch(/^run/)
    expect(result.tickets).toHaveLength(2)
    expect(result.tickets.map((t) => t.title).sort()).toEqual([
      'defect 9',
      'the save drops the value',
    ])
    // Built mechanically from the finding, on the CURRENT lap, blocking on nothing.
    expect(result.tickets.find((t) => t.originFindingId === failed.finding.id)).toMatchObject({
      title: 'the save drops the value',
      goal: 'Fix: the save drops the value',
      kind: 'implementation',
      status: 'pending',
      lap: feature.lap,
      blockedBy: [],
    })
    expect(result.findings.every((f) => f.status === 'fixing')).toBe(true)
    // The Fix loop-back: review → implementation, same lap.
    const after = getFeatureRow(ctx, feature.id)
    expect(after.phase).toBe('implementation')
    expect(after.lap).toBe(feature.lap)
    // Nothing is open any more, and nothing was minted twice.
    const view = await caller.findings.listByFeature({ featureId: feature.id })
    expect(view.summary).toMatchObject({ found: 9, open: 0 })
  })

  it('refuses a fix with nothing open, minting no tickets', async () => {
    const landed = report('the save drops the value')
    updateTicket(ctx, landed.fixTicket!.id, { status: 'done', commits: ['def'] })
    const before = listTickets(ctx, feature.id).length

    await expect(caller.findings.fixOpenDefects({ featureId: feature.id })).rejects.toThrow(
      /no open defects/,
    )
    expect(listTickets(ctx, feature.id)).toHaveLength(before)
    expect(getFeatureRow(ctx, feature.id).phase).toBe('review')
  })
})
