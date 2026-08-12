import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { checkGate, overrideGate, undoGateOverride } from '../src/services/gates'
import { listAfter } from '../src/services/events'
import { featureDocsDir } from '../src/services/feature-docs'
import { getFeatureRow } from '../src/services/repo'
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

  it('spec-file-exists requires spec.md for every feature', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'g2' })
    expect(checkGate(ctx, 'spec-file-exists', feature).satisfied).toBe(false)
    writeDoc(project, feature, 'spec.md')
    expect(checkGate(ctx, 'spec-file-exists', feature).satisfied).toBe(true)
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

/**
 * Override crosses the gate the feature is actually standing at. The gate id was
 * previously recorded and emitted but never read: any id advanced the feature one
 * phase, so a caller working from a stale view crossed a gate it did not name and
 * the override row misdescribed the crossing.
 */
describe('gate override — the gate has to be the current one', () => {
  let ctx: AppCtx
  let project: Project

  beforeEach(async () => {
    ctx = await makeTestCtx()
    project = seedProject(ctx, tmpRepo())
  })

  it('advances when the gate is the one guarding the current phase', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'ov-ok', phase: 'tickets' })
    expect(overrideGate(ctx, feature.id, 'G3', 'burning without approval').phase).toBe(
      'implementation',
    )
  })

  it('rejects a gate the feature is not standing at, leaving the phase alone', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'ov-wrong', phase: 'tickets' })

    expect(() => overrideGate(ctx, feature.id, 'G1', 'stale view')).toThrow(
      /cannot override G1: the feature is at tickets, whose gate is G3/,
    )
    expect(getFeatureRow(ctx, feature.id).phase).toBe('tickets')
    expect(listAfter(ctx, feature.id).map((e) => e.type)).not.toContain('gate.overridden')
  })

  it('rejects any override at the final phase', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'ov-shipped', phase: 'shipped' })

    expect(() => overrideGate(ctx, feature.id, 'G5', 'already done')).toThrow(/no gate to cross/)
    expect(getFeatureRow(ctx, feature.id).phase).toBe('shipped')
  })

  it("uses the mapped feature's G1 without changing which gate is current", () => {
    const feature = seedFeature(ctx, project.id, {
      slug: 'ov-mapped',
      phase: 'ideation',
      mapped: true,
    })
    expect(overrideGate(ctx, feature.id, 'G1', 'fog is fine').phase).toBe('spec')
  })
})

/**
 * Findings F24 — "Override with reason…" + Apply was a one-way door: it advanced
 * the phase instantly with no consequence copy and no way back but DB surgery.
 * The reversal is one phase back, the phase the override stepped over, and it
 * leaves the `gate.overridden` event standing (the timeline records what was
 * attempted) while dropping the row (the table records what stands).
 */
describe('gate override — undo', () => {
  let ctx: AppCtx
  let project: Project

  beforeEach(async () => {
    ctx = await makeTestCtx()
    project = seedProject(ctx, tmpRepo())
  })

  it('restores the phase the override advanced past and records the reversal', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'undo-g4', phase: 'implementation' })

    expect(overrideGate(ctx, feature.id, 'G4', 'shipping it anyway').phase).toBe('review')
    expect(undoGateOverride(ctx, feature.id, 'G4').phase).toBe('implementation')

    const types = listAfter(ctx, feature.id).map((e) => e.type)
    expect(types).toContain('gate.overridden')
    expect(types).toContain('gate.override.undone')
  })

  it('drops the override row, so advancing again needs a fresh override', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'undo-reopen', phase: 'implementation' })
    overrideGate(ctx, feature.id, 'G4', 'first try')
    undoGateOverride(ctx, feature.id, 'G4')

    expect(() => undoGateOverride(ctx, feature.id, 'G4')).toThrow(/no G4 override/)
  })

  it('refuses when no override of that gate was ever recorded, changing nothing', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'undo-none', phase: 'review' })
    expect(() => undoGateOverride(ctx, feature.id, 'G4')).toThrow(/no G4 override/)
    expect(getFeatureRow(ctx, feature.id).phase).toBe('review')
  })

  it('refuses at the first phase, where there is nothing to step back to', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'undo-first', phase: 'ideation' })
    expect(() => undoGateOverride(ctx, feature.id, 'G1')).toThrow(/first phase/)
  })
})
