import { describe, expect, it } from 'vitest'
import { aggregateRuns, initialView, projectStats } from '../src/lib/projects'
import type { FeatureListItem } from '../src/lib/api'
import type { Project } from '../src/lib/api'

/**
 * Issue #45 — multi-project UI landing + portfolio-card derivations. Pure
 * functions over wire data (projects + per-project feature lists), so the shell
 * router and project cards can be reasoned about without a DOM.
 */

const proj = (id: string): Project => ({
  id,
  name: id,
  repoPath: `/repos/${id}`,
  mainBranch: 'main',
})

const feat = (over: Partial<FeatureListItem>): FeatureListItem =>
  ({
    id: 'feat_1',
    projectId: 'proj_1',
    slug: 'x',
    title: 'x',
    oneLiner: '',
    size: 'full',
    mapped: false,
    phase: 'ideation',
    branch: 'feature/x',
    status: 'active',
    createdAt: 0,
    ticketCounts: { total: 0, pending: 0, burning: 0, done: 0, failed: 0 },
    activeRun: false,
    ...over,
  }) as FeatureListItem

describe('initialView', () => {
  it('lands on the open-a-project flow with no projects (fresh install)', () => {
    expect(initialView([])).toEqual({ view: 'open', projectId: null })
  })

  it('lands straight into the project when exactly one is open', () => {
    expect(initialView([proj('proj_a')])).toEqual({ view: 'project', projectId: 'proj_a' })
  })

  it('lands on the portfolio home when more than one is open', () => {
    expect(initialView([proj('proj_a'), proj('proj_b')])).toEqual({
      view: 'home',
      projectId: null,
    })
  })
})

describe('projectStats', () => {
  it('reports an empty project as empty', () => {
    expect(projectStats([])).toEqual({
      total: 0,
      needsYou: 0,
      activeRuns: 0,
      shipped: 0,
      health: 'empty',
    })
  })

  it('counts active runs and marks health working when a run is in flight', () => {
    const s = projectStats([
      feat({ id: 'a', phase: 'implementation', activeRun: true }),
      feat({ id: 'b', phase: 'shipped', status: 'shipped' }),
    ])
    expect(s.activeRuns).toBe(1)
    expect(s.shipped).toBe(1)
    expect(s.needsYou).toBe(0)
    expect(s.health).toBe('working')
  })

  it('counts needs-you features and prefers attention over working', () => {
    const s = projectStats([
      feat({ id: 'a', phase: 'ideation' }), // needs grilling
      feat({ id: 'b', phase: 'implementation', activeRun: true }),
    ])
    expect(s.needsYou).toBe(1)
    expect(s.activeRuns).toBe(1)
    expect(s.health).toBe('attention')
  })

  it('is steady when features exist but nothing needs you and no run is live', () => {
    const s = projectStats([feat({ id: 'a', phase: 'shipped', status: 'shipped' })])
    expect(s.health).toBe('steady')
  })
})

describe('aggregateRuns', () => {
  it('sums active runs across every open project', () => {
    const a = projectStats([feat({ activeRun: true }), feat({ activeRun: true })])
    const b = projectStats([feat({ activeRun: true })])
    const c = projectStats([])
    expect(aggregateRuns([a, b, c])).toBe(3)
  })
})
