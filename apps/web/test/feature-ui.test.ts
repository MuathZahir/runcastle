import { describe, expect, it } from 'vitest'
import type { FeatureFull, FeatureListItem } from '../src/lib/api'
import { needsMe, nextStep, triage, triageOf } from '../src/lib/feature-ui'

/**
 * Ticket 7 — archive/unarchive derivations. Archived features leave the default
 * sidebar lanes (surfacing only under a show-archived toggle) and expose no
 * pipeline next-step action — only a way back (Unarchive).
 */

function listItem(over: Partial<FeatureListItem> = {}): FeatureListItem {
  return {
    id: over.id ?? 'feat_1',
    projectId: 'proj_1',
    slug: over.slug ?? 'demo',
    title: 'Demo',
    oneLiner: '',
    size: 'full',
    mapped: false,
    phase: over.phase ?? 'tickets',
    branch: 'feature/demo',
    baseBranch: 'main',
    status: over.status ?? 'active',
    createdAt: 0,
    ticketCounts: over.ticketCounts ?? {
      total: 0,
      pending: 0,
      burning: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
    },
    activeRun: over.activeRun ?? false,
  } as FeatureListItem
}

function full(over: Partial<FeatureFull['feature']> = {}): FeatureFull {
  return {
    feature: { ...listItem(over as Partial<FeatureListItem>) } as FeatureFull['feature'],
    tickets: [],
    sessions: [],
    runs: [],
    docs: [],
    gate: { next: null, satisfied: false },
    waypoints: [],
    frontierIds: [],
  } as unknown as FeatureFull
}

describe('archive derivations', () => {
  it('triageOf sorts an archived feature into the archived lane', () => {
    expect(triageOf(listItem({ status: 'archived', activeRun: true }))).toBe('archived')
  })

  it('needsMe is null for archived features', () => {
    expect(needsMe(listItem({ status: 'archived', phase: 'ideation' }))).toBeNull()
  })

  it('excludes archived features from the default lanes', () => {
    const groups = triage([
      listItem({ id: 'a', status: 'active', phase: 'ideation' }),
      listItem({ id: 'b', status: 'archived' }),
    ])
    expect(groups.some((g) => g.key === 'archived')).toBe(false)
    const all = groups.flatMap((g) => g.features.map((f) => f.id))
    expect(all).not.toContain('b')
    expect(all).toContain('a')
  })

  it('surfaces archived features in a trailing lane when showArchived is on', () => {
    const groups = triage(
      [
        listItem({ id: 'a', status: 'active', phase: 'ideation' }),
        listItem({ id: 'b', status: 'archived' }),
      ],
      { showArchived: true },
    )
    const archived = groups.find((g) => g.key === 'archived')
    expect(archived?.features.map((f) => f.id)).toEqual(['b'])
    expect(groups.at(-1)?.key).toBe('archived')
  })

  it('nextStep offers only Unarchive for an archived feature (no pipeline action)', () => {
    const ns = nextStep(full({ status: 'archived', phase: 'review' }), { driving: false })
    expect(ns.primary?.kind).toBe('unarchive')
    expect(ns.secondary).toEqual([])
  })
})
