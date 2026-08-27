import type { Project, Ticket } from '@runcastle/core'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listAfter } from '../src/services/events'
import {
  buildFixTicket,
  dismiss,
  listByFeature,
  markFailed,
  markFixed,
  markFixing,
  reportFinding,
} from '../src/services/review-findings'
import { listByFeature as listTickets, storeTickets } from '../src/services/tickets'
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
})
