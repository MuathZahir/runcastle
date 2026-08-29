import { afterEach, describe, expect, it } from 'vitest'
import {
  aggregateRuns,
  initialView,
  pickerStartDir,
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
    expect(restoredView(both, readStoredNav(), true)).toEqual({ view: 'project', projectId: 'proj_b' })
  })

  it('keeps a deliberate visit to the chooser, so reload stays on it', () => {
    storage()
    writeStoredNav({ view: 'home' })
    expect(restoredView(both, readStoredNav(), true)).toEqual({ view: 'home', projectId: null })
    // Even against the count rule, which would otherwise walk straight in.
    expect(restoredView([proj('proj_a')], readStoredNav(), true)).toEqual({
      view: 'home',
      projectId: null,
    })
  })

  it('falls back to the landing rule when the stored project is gone', () => {
    storage({ [NAV_KEY]: JSON.stringify({ view: 'project', projectId: 'proj_closed' }) })
    expect(restoredView(both, readStoredNav(), true)).toEqual({ view: 'home', projectId: null })
    expect(restoredView([proj('proj_a')], readStoredNav(), true)).toEqual({
      view: 'project',
      projectId: 'proj_a',
    })
  })

  it('falls back to the landing rule when nothing is stored', () => {
    storage()
    expect(readStoredNav()).toBeNull()
    expect(restoredView(both, readStoredNav(), true)).toEqual({ view: 'home', projectId: null })
  })

  it('treats corrupted or unusable storage as nothing stored', () => {
    storage({ [NAV_KEY]: '{half-written' })
    expect(readStoredNav()).toBeNull()
    storage({ [NAV_KEY]: JSON.stringify({ view: 'project' }) }) // no id
    expect(readStoredNav()).toBeNull()
    expect(restoredView(both, readStoredNav(), true)).toEqual({ view: 'home', projectId: null })
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
    expect(restoredView(both, readStoredNav(), true)).toEqual({ view: 'home', projectId: null })
  })

  it('leaves the fresh install on the open-a-project flow whatever is stored', () => {
    storage({ [NAV_KEY]: JSON.stringify({ view: 'home' }) })
    expect(restoredView([], readStoredNav(), true)).toEqual({ view: 'open', projectId: null })
  })
})

/**
 * Decision 3 — where the app lands, as a table over the two facts it has: is the
 * host set up (git identity + a ready coding agent), and what is open. The bug
 * this closes: onboarding used to be "no projects", so closing your last project
 * replayed the whole wizard at someone who had already been through it.
 */
describe('landing by setup state', () => {
  const one = [proj('proj_a')]
  const both = [proj('proj_a'), proj('proj_b')]

  it('sends an unfinished setup to the wizard, whatever is open', () => {
    const wizard = { view: 'setup', projectId: null }
    expect(restoredView([], null, false)).toEqual(wizard)
    expect(restoredView(one, null, false)).toEqual(wizard)
    expect(restoredView(both, { view: 'home' }, false)).toEqual(wizard)
    expect(restoredView(both, { view: 'project', projectId: 'proj_b' }, false)).toEqual(wizard)
  })

  it('sends a finished setup with nothing open to the first-project screen', () => {
    expect(restoredView([], null, true)).toEqual({ view: 'open', projectId: null })
  })

  it('leaves every other landing to the count and the remembered navigation', () => {
    expect(restoredView(one, null, true)).toEqual({ view: 'project', projectId: 'proj_a' })
    expect(restoredView(both, null, true)).toEqual({ view: 'home', projectId: null })
    expect(restoredView(both, { view: 'project', projectId: 'proj_b' }, true)).toEqual({
      view: 'project',
      projectId: 'proj_b',
    })
    expect(restoredView(one, { view: 'home' }, true)).toEqual({ view: 'home', projectId: null })
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
 * far corner, with no hint for the commonest one of all. Decision 5 then asked
 * for the problem said *once*: the server's message names the path, and the card
 * printed it a second time in the hint, so a recognised failure is restated
 * short and hands the path back separately to be shown exactly once.
 */
describe('repoOpenFailure', () => {
  it('states a non-repository once and names git init', () => {
    const f = repoOpenFailure('not a git repository: /tmp/notes', '/tmp/notes')
    expect(f.message).toBe('Not a git repository')
    expect(f.hint).toContain('git init')
    expect(f.hint).not.toContain('/tmp/notes')
    expect(f.path).toBe('/tmp/notes')
  })

  it('states a missing path once and points at Browse', () => {
    const f = repoOpenFailure('path does not exist: /tmp/typo', '/tmp/typo')
    expect(f.message).toBe('Path does not exist')
    expect(f.hint).toContain('Browse')
    expect(f.path).toBe('/tmp/typo')
  })

  it('keeps an unreadable path apart from a missing one', () => {
    expect(repoOpenFailure('cannot read path: /root/x', '/root/x').message).toBe(
      'Cannot read that path',
    )
  })

  it('passes an unrecognised failure through with no invented advice', () => {
    const f = repoOpenFailure('EACCES: permission denied', '/root/secret')
    expect(f.message).toBe('EACCES: permission denied')
    expect(f.hint).toBeNull()
    // The server's own wording is the whole message; a path beside it would be
    // the second printing this classifier exists to stop.
    expect(f.path).toBeNull()
  })

  it('claims no path when the attempted one is unknown', () => {
    expect(repoOpenFailure('not a git repository', '')).toMatchObject({
      message: 'Not a git repository',
      path: null,
    })
  })
})

/**
 * Decision 6 — the picker used to open on whatever the path field held, so a
 * stale or half-typed path produced a dialog that was nothing but an error. One
 * segment is dropped per failure until something lists, with home as the floor.
 */
describe('pickerStartDir', () => {
  it('browses the handed path when nothing has failed', () => {
    expect(pickerStartDir('/home/you/code', undefined)).toEqual({
      dir: '/home/you/code',
      keepTyped: false,
    })
  })

  it('asks for home when it was handed nothing', () => {
    expect(pickerStartDir(undefined, undefined)).toEqual({ dir: undefined, keepTyped: false })
    expect(pickerStartDir('   ', 'path does not exist:    ')).toEqual({
      dir: undefined,
      keepTyped: false,
    })
  })

  it('steps up one segment from a path that is not there, and keeps the text', () => {
    expect(pickerStartDir('/home/you/code/typo', 'path does not exist: /home/you/code/typo')).toEqual(
      { dir: '/home/you/code', keepTyped: true },
    )
  })

  it('steps up from an unreadable path too', () => {
    expect(pickerStartDir('/root/private/x', 'cannot read path: /root/private/x (EACCES)')).toEqual({
      dir: '/root/private',
      keepTyped: true,
    })
  })

  it('walks a windows path up to its drive root and then to home', () => {
    const missing = 'path does not exist: x'
    expect(pickerStartDir('C:\\Users\\you\\code', missing)).toEqual({
      dir: 'C:\\Users\\you',
      keepTyped: true,
    })
    // `C:` alone is drive-relative and names no directory, so the drive root
    // keeps its separator.
    expect(pickerStartDir('C:\\Users', missing)).toEqual({ dir: 'C:\\', keepTyped: true })
    expect(pickerStartDir('C:\\', missing)).toEqual({ dir: undefined, keepTyped: true })
  })

  it('bottoms out at home rather than below the last segment', () => {
    const missing = 'path does not exist: x'
    expect(pickerStartDir('/gone', missing)).toEqual({ dir: undefined, keepTyped: true })
    expect(pickerStartDir('/', missing)).toEqual({ dir: undefined, keepTyped: true })
    expect(pickerStartDir('\\\\server', missing)).toEqual({ dir: undefined, keepTyped: true })
  })

  it('ignores a trailing separator rather than stepping up twice', () => {
    expect(pickerStartDir('/home/you/code/', 'path does not exist: /home/you/code/')).toEqual({
      dir: '/home/you',
      keepTyped: true,
    })
  })

  it('leaves any other failure where it is', () => {
    expect(pickerStartDir('code/repo', 'path is not absolute: code/repo')).toEqual({
      dir: 'code/repo',
      keepTyped: false,
    })
    expect(pickerStartDir('/home/you', 'EMFILE: too many open files')).toEqual({
      dir: '/home/you',
      keepTyped: false,
    })
  })
})
