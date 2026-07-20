import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { checkGate } from '../src/services/gates'
import { featureDocsDir } from '../src/services/feature-docs'
import { storeTickets } from '../src/services/tickets'
import { updateTicket } from '../src/services/tickets'
import { claim, resolve as resolveWaypoint, storeWaypoints } from '../src/services/waypoints'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

function writeDoc(project: Project, feature: Feature, name: string): void {
  const dir = featureDocsDir(project, feature)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), '# doc\n', 'utf8')
}

describe('gates service', () => {
  let ctx: AppCtx
  let project: Project

  beforeEach(async () => {
    ctx = await makeTestCtx()
    project = seedProject(ctx, tmpRepo())
  })

  it('decisions-file-exists reflects decisions.md presence', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'g1' })
    expect(checkGate(ctx, 'decisions-file-exists', feature).satisfied).toBe(false)
    writeDoc(project, feature, 'decisions.md')
    expect(checkGate(ctx, 'decisions-file-exists', feature).satisfied).toBe(true)
  })

  it('spec-file-exists reflects spec.md for full features, auto-true for collapsed', () => {
    const full = seedFeature(ctx, project.id, { slug: 'g2-full', size: 'full' })
    expect(checkGate(ctx, 'spec-file-exists', full).satisfied).toBe(false)
    writeDoc(project, full, 'spec.md')
    expect(checkGate(ctx, 'spec-file-exists', full).satisfied).toBe(true)

    const collapsed = seedFeature(ctx, project.id, { slug: 'g2-col', size: 'collapsed' })
    expect(checkGate(ctx, 'spec-file-exists', collapsed).satisfied).toBe(true)
  })

  it('tickets-approved requires at least one ticket', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'g3', phase: 'tickets' })
    expect(checkGate(ctx, 'tickets-approved', feature).satisfied).toBe(false)
    storeTickets(ctx, feature.id, [
      { title: 't', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: [], blockedBy: [] },
    ])
    expect(checkGate(ctx, 'tickets-approved', feature).satisfied).toBe(true)
  })

  it('tickets-approved does not count cancelled tickets', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'g3-cancel', phase: 'tickets' })
    const [only] = storeTickets(ctx, feature.id, [
      { title: 't', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: [], blockedBy: [] },
    ])
    updateTicket(ctx, only.id, { status: 'cancelled' })
    expect(checkGate(ctx, 'tickets-approved', feature).satisfied).toBe(false)
  })

  it('all-tickets-terminal is satisfied only when every ticket is done/failed/cancelled', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'g4', phase: 'implementation' })
    const [a, b, c] = storeTickets(ctx, feature.id, [
      { title: 'a', goal: 'g', context: 'c', acceptanceCriteria: ['x'], seams: [], blockedBy: [] },
      { title: 'b', goal: 'g', context: 'c', acceptanceCriteria: ['x'], seams: [], blockedBy: [] },
      { title: 'c', goal: 'g', context: 'c', acceptanceCriteria: ['x'], seams: [], blockedBy: [] },
    ])
    expect(checkGate(ctx, 'all-tickets-terminal', feature).satisfied).toBe(false)
    updateTicket(ctx, a.id, { status: 'done' })
    expect(checkGate(ctx, 'all-tickets-terminal', feature).satisfied).toBe(false)
    updateTicket(ctx, b.id, { status: 'failed' })
    expect(checkGate(ctx, 'all-tickets-terminal', feature).satisfied).toBe(false)
    updateTicket(ctx, c.id, { status: 'cancelled' })
    expect(checkGate(ctx, 'all-tickets-terminal', feature).satisfied).toBe(true)
  })

  it('human-merge is always false (Merge click bypasses)', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'g5', phase: 'review' })
    expect(checkGate(ctx, 'human-merge', feature).satisfied).toBe(false)
  })

  it('all-waypoints-terminal (mapped G1) is satisfied only when every waypoint is resolved/dropped', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'g1-mapped', mapped: true })
    // no waypoints charted → not satisfiable (nothing to converge)
    expect(checkGate(ctx, 'all-waypoints-terminal', feature).satisfied).toBe(false)

    const [a, b] = storeWaypoints(ctx, feature.id, [
      { title: 'a', type: 'grilling', question: 'qa', blockedBy: [] },
      { title: 'b', type: 'grilling', question: 'qb', blockedBy: [] },
    ])
    // both open → refused while any waypoint is open
    expect(checkGate(ctx, 'all-waypoints-terminal', feature).satisfied).toBe(false)

    resolveWaypoint(ctx, a.id, 'resolved', 'answered')
    expect(checkGate(ctx, 'all-waypoints-terminal', feature).satisfied).toBe(false)

    // a drop counts as terminal exactly like a resolve
    resolveWaypoint(ctx, b.id, 'dropped', 'out of scope')
    expect(checkGate(ctx, 'all-waypoints-terminal', feature).satisfied).toBe(true)
  })

  it('all-waypoints-terminal reason aggregates status counts (no per-item dump)', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'g1-reason', mapped: true })
    const [a] = storeWaypoints(ctx, feature.id, [
      { title: 'a', type: 'grilling', question: 'qa', blockedBy: [] },
      { title: 'b', type: 'grilling', question: 'qb', blockedBy: [] },
      { title: 'c', type: 'grilling', question: 'qc', blockedBy: [] },
    ])
    claim(ctx, a.id, 'sess_test')

    expect(checkGate(ctx, 'all-waypoints-terminal', feature).reason).toBe(
      '3 waypoints not yet terminal (2 open, 1 claimed)',
    )
  })

  it('all-waypoints-terminal reason uses the singular for one remaining waypoint', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'g1-one', mapped: true })
    storeWaypoints(ctx, feature.id, [
      { title: 'only', type: 'grilling', question: 'q', blockedBy: [] },
    ])

    expect(checkGate(ctx, 'all-waypoints-terminal', feature).reason).toBe(
      '1 waypoint not yet terminal (1 open)',
    )
  })

  it('all-tickets-terminal reason aggregates status counts (no per-item dump)', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'g4-reason', phase: 'implementation' })
    const [a] = storeTickets(ctx, feature.id, [
      { title: 'a', goal: 'g', context: 'c', acceptanceCriteria: ['x'], seams: [], blockedBy: [] },
      { title: 'b', goal: 'g', context: 'c', acceptanceCriteria: ['x'], seams: [], blockedBy: [] },
      { title: 'c', goal: 'g', context: 'c', acceptanceCriteria: ['x'], seams: [], blockedBy: [] },
    ])
    updateTicket(ctx, a.id, { status: 'burning' })

    expect(checkGate(ctx, 'all-tickets-terminal', feature).reason).toBe(
      '3 tickets not yet terminal (2 pending, 1 burning)',
    )
  })
})
