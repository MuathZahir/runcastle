import { afterEach, describe, expect, it } from 'vitest'
import {
  aggregateRuns,
  initialView,
  projectStats,
  repoOpenFailure,
  restoredView,
} from '../src/lib/projects'
import { readStoredNav, writeStoredNav } from '../src/lib/use-project-nav'
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

/**
 * Refresh used to cost the user their place: the landing was re-derived from
 * open-project count every load, so anyone with two projects open came back to
 * the chooser. Where you were is persisted now (decision 3) — these tests drive
 * the real localStorage round-trip the hook does on boot, then hand what it read
 * to the rule that resolves the landing.
 */
describe('restored navigation', () => {
  const NAV_KEY = 'runcastle.project.v1'
  const both = [proj('proj_a'), proj('proj_b')]
  const realStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

  /** The node test env has no DOM; the nav store needs only these methods. */
  function fakeStorage(entries: Record<string, string> = {}) {
    const map = new Map(Object.entries(entries))
    return {
      get length() {
        return map.size
      },
      clear: () => map.clear(),
      getItem: (k: string) => map.get(k) ?? null,
      key: (i: number) => [...map.keys()][i] ?? null,
      removeItem: (k: string) => void map.delete(k),
      setItem: (k: string, v: string) => void map.set(k, v),
    }
  }

  function storage(entries: Record<string, string> = {}): void {
    Object.defineProperty(globalThis, 'localStorage', {
      value: fakeStorage(entries),
      configurable: true,
      writable: true,
    })
  }

  afterEach(() => {
    if (realStorage) Object.defineProperty(globalThis, 'localStorage', realStorage)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  })

  it('comes back to the project you were in, without passing the chooser', () => {
    storage()
    writeStoredNav({ view: 'project', projectId: 'proj_b' })
    expect(restoredView(both, readStoredNav())).toEqual({ view: 'project', projectId: 'proj_b' })
  })

  it('keeps a deliberate visit to the chooser, so reload stays on it', () => {
    storage()
    writeStoredNav({ view: 'home' })
    expect(restoredView(both, readStoredNav())).toEqual({ view: 'home', projectId: null })
    // Even against the count rule, which would otherwise walk straight in.
    expect(restoredView([proj('proj_a')], readStoredNav())).toEqual({
      view: 'home',
      projectId: null,
    })
  })

  it('falls back to the landing rule when the stored project is gone', () => {
    storage({ [NAV_KEY]: JSON.stringify({ view: 'project', projectId: 'proj_closed' }) })
    expect(restoredView(both, readStoredNav())).toEqual({ view: 'home', projectId: null })
    expect(restoredView([proj('proj_a')], readStoredNav())).toEqual({
      view: 'project',
      projectId: 'proj_a',
    })
  })

  it('falls back to the landing rule when nothing is stored', () => {
    storage()
    expect(readStoredNav()).toBeNull()
    expect(restoredView(both, readStoredNav())).toEqual({ view: 'home', projectId: null })
  })

  it('treats corrupted or unusable storage as nothing stored', () => {
    storage({ [NAV_KEY]: '{half-written' })
    expect(readStoredNav()).toBeNull()
    storage({ [NAV_KEY]: JSON.stringify({ view: 'project' }) }) // no id
    expect(readStoredNav()).toBeNull()
    expect(restoredView(both, readStoredNav())).toEqual({ view: 'home', projectId: null })
  })

  it('survives storage being unavailable at all (private mode)', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
    expect(readStoredNav()).toBeNull()
    expect(() => writeStoredNav({ view: 'home' })).not.toThrow()
  })

  // The create/import flow is somewhere you pass through, not a place to be
  // returned to — a stored 'open' is not written by the hook, and is ignored.
  it('never restores the open-a-project flow', () => {
    storage({ [NAV_KEY]: JSON.stringify({ view: 'open', projectId: null }) })
    expect(readStoredNav()).toBeNull()
    expect(restoredView(both, readStoredNav())).toEqual({ view: 'home', projectId: null })
  })

  it('leaves the fresh install on the open-a-project flow whatever is stored', () => {
    storage({ [NAV_KEY]: JSON.stringify({ view: 'home' }) })
    expect(restoredView([], readStoredNav())).toEqual({ view: 'open', projectId: null })
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

/**
 * Findings F17.2 — repo-open failures arrived as auto-dismissing toasts in the
 * far corner, with no hint for the commonest one of all.
 */
describe('repoOpenFailure', () => {
  it('names git init for a folder that is not a repository', () => {
    const f = repoOpenFailure('not a git repository: /tmp/notes', '/tmp/notes')
    expect(f.hint).toContain('git init')
    expect(f.hint).toContain('/tmp/notes')
  })

  it('points at Browse when the path is not there at all', () => {
    expect(repoOpenFailure('path does not exist: /tmp/typo', '/tmp/typo').hint).toContain('Browse')
  })

  it('passes an unrecognised failure through with no invented advice', () => {
    const f = repoOpenFailure('EACCES: permission denied', '/root/secret')
    expect(f.message).toBe('EACCES: permission denied')
    expect(f.hint).toBeNull()
  })

  it('still reads sensibly when the attempted path is unknown', () => {
    expect(repoOpenFailure('not a git repository', '')?.hint).toContain('that folder')
  })
})
