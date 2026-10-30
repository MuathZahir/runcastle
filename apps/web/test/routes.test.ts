import { describe, expect, it } from 'vitest'
import {
  addressedView, featureViewOf,
  insideProject,
  locationFor,
  parsePath,
  pathFor,
  projectIdOf,
  type AppLocation,
} from '../src/lib/routes'

/**
 * Ticket 1 / decision 1 — the URL is a projection of the navigation state
 * machine, so the codec is a pure function pair and is tested as one: no DOM,
 * no history, no react. What the DOM tier covers instead is the *history*
 * behaviour built on top (`test/history-sync.test.tsx`).
 */

const LOCATIONS: AppLocation[] = [
  { kind: 'home' },
  { kind: 'project', projectId: 'proj_a' },
  { kind: 'chat', projectId: 'proj_a' },
  { kind: 'prepare', projectId: 'proj_a' },
  { kind: 'feature', projectId: 'proj_a', featureSlug: 'flow-redesign-shell' },
  { kind: 'feature', projectId: 'proj_a', featureSlug: 'flow-redesign-shell', view: 'chat' },
  { kind: 'feature', projectId: 'proj_a', featureSlug: 'flow-redesign-shell', view: 'plan' },
]

describe('pathFor', () => {
  it('gives every location a canonical path', () => {
    expect(LOCATIONS.map(pathFor)).toEqual([
      '/',
      '/p/proj_a',
      '/p/proj_a/chat',
      '/p/proj_a/prepare',
      '/p/proj_a/f/flow-redesign-shell',
      '/p/proj_a/f/flow-redesign-shell/chat',
      '/p/proj_a/f/flow-redesign-shell/plan',
    ])
  })

  it('escapes ids and slugs, so a path never has an extra segment in it', () => {
    expect(pathFor({ kind: 'feature', projectId: 'a/b', featureSlug: 'c d' })).toBe(
      '/p/a%2Fb/f/c%20d',
    )
  })
})

describe('parsePath', () => {
  it('round-trips every location', () => {
    for (const location of LOCATIONS) {
      expect(parsePath(pathFor(location))).toEqual(location)
    }
  })

  it("reads the retired Tickets tab's path, the retired body and a hand-typed work as the feature's Work", () => {
    const work = { kind: 'feature', projectId: 'proj_a', featureSlug: 'flow-redesign-shell', namesWork: true }
    expect(parsePath('/p/proj_a/f/flow-redesign-shell/tickets')).toEqual(work)
    expect(parsePath('/p/proj_a/f/flow-redesign-shell/body')).toEqual(work)
    expect(parsePath('/p/proj_a/f/flow-redesign-shell/work')).toEqual(work)
  })

  // the-feature-s-right-panel decision 15: Review's findings are the review ticket's row.
  it('lands the retired Review address on Tickets', () => {
    expect(parsePath('/p/proj_a/f/flow-redesign-shell/review')).toEqual({
      kind: 'feature',
      projectId: 'proj_a',
      featureSlug: 'flow-redesign-shell',
      namesWork: true,
    })
  })

  // A bare path restores the remembered view on landing; these must not.
  it('lands an address that names Work on Work, and leaves a bare one to what is remembered', () => {
    const at = (path: string) => {
      const location = parsePath(path)
      return location?.kind === 'feature' ? addressedView(location) : null
    }
    expect(at('/p/proj_a/f/slug/review')).toBe('work')
    expect(at('/p/proj_a/f/slug/work')).toBe('work')
    expect(at('/p/proj_a/f/slug/details')).toBe('details')
    expect(at('/p/proj_a/f/slug')).toBeUndefined()
  })

  // tickets-and-review-are-tools-not-phases decision 8: the preview folded into Plan.
  it('reads the retired preview address as the feature’s Plan', () => {
    expect(parsePath('/p/proj_a/f/flow-redesign-shell/preview')).toEqual({
      kind: 'feature',
      projectId: 'proj_a',
      featureSlug: 'flow-redesign-shell',
      view: 'plan',
    })
  })

  // design-mode: the tabs became the panel. The old Overview link was the bare
  // path, which shows Work, the body's successor; the old Chat link is the chat alone.
  it('lands the old Overview and Chat links on Work and on the chat alone', () => {
    const feature = parsePath('/p/proj_a/f/slug')
    expect(feature && feature.kind === 'feature' && featureViewOf(feature)).toBe('work')
    const chat = parsePath('/p/proj_a/f/slug/chat')
    expect(chat && chat.kind === 'feature' && featureViewOf(chat)).toBe('chat')
  })

  it('names every panel view but Work by its own segment', () => {
    for (const view of ['plan', 'design', 'drive', 'details'] as const) {
      expect(parsePath(`/p/proj_a/f/slug/${view}`)).toEqual({
        kind: 'feature',
        projectId: 'proj_a',
        featureSlug: 'slug',
        view,
      })
    }
  })

  it('round-trips ids and slugs that needed escaping', () => {
    const location: AppLocation = { kind: 'feature', projectId: 'a/b', featureSlug: 'c d' }
    expect(parsePath(pathFor(location))).toEqual(location)
  })

  it('reads the retired map address as unknown', () => {
    expect(parsePath('/p/proj_a/map')).toBeNull()
    expect(parsePath('/p/proj_a/map/checkout')).toBeNull()
  })

  it('reads a trailing slash as the same place', () => {
    expect(parsePath('/p/proj_a/')).toEqual({ kind: 'project', projectId: 'proj_a' })
    expect(parsePath('')).toEqual({ kind: 'home' })
  })

  it('has no opinion about a path this app does not own', () => {
    expect(parsePath('/projects/proj_a')).toBeNull()
    expect(parsePath('/p')).toBeNull()
    expect(parsePath('/p/proj_a/settings')).toBeNull()
    expect(parsePath('/p/proj_a/f')).toBeNull()
    expect(parsePath('/p/proj_a/f/slug/extra')).toBeNull()
    expect(parsePath('/p/proj_a/f/slug/board')).toBeNull()
    expect(parsePath('/p/proj_a/f/slug/chat/more')).toBeNull()
  })

  it('treats a malformed escape as an unknown path rather than throwing', () => {
    expect(parsePath('/p/%E0%A4%A')).toBeNull()
  })
})

describe('projectIdOf', () => {
  it('names the project a location is inside, and nothing for the home', () => {
    expect(projectIdOf({ kind: 'home' })).toBeNull()
    expect(projectIdOf({ kind: 'chat', projectId: 'proj_a' })).toBe('proj_a')
  })
})

describe('insideProject', () => {
  it('names the place inside the project it was asked about', () => {
    expect(insideProject({ kind: 'chat', projectId: 'p1' }, 'p1')).toEqual({
      kind: 'chat',
      projectId: 'p1',
    })
    expect(insideProject({ kind: 'prepare', projectId: 'p1' }, 'p1')?.kind).toBe('prepare')
    expect(
      insideProject({ kind: 'feature', projectId: 'p1', featureSlug: 'a' }, 'p1')?.kind,
    ).toBe('feature')
  })

  it('has nothing to say about a bare project path — where to land is undecided', () => {
    expect(insideProject({ kind: 'project', projectId: 'p1' }, 'p1')).toBeNull()
  })

  it('has nothing to say about the home, another project, or an unknown path', () => {
    expect(insideProject({ kind: 'home' }, 'p1')).toBeNull()
    expect(insideProject({ kind: 'chat', projectId: 'p2' }, 'p1')).toBeNull()
    expect(insideProject(null, 'p1')).toBeNull()
  })
})

describe('locationFor', () => {
  const base = { projectId: 'proj_a', preparing: false, projectSelected: false, featureSlug: null }

  it('follows the same precedence as the workspace body', () => {
    expect(locationFor({ ...base, preparing: true, projectSelected: true })).toEqual({
      kind: 'prepare',
      projectId: 'proj_a',
    })
    expect(locationFor({ ...base, projectSelected: true, featureSlug: 'x' })).toEqual({
      kind: 'chat',
      projectId: 'proj_a',
    })
    expect(locationFor({ ...base, featureSlug: 'x' })).toEqual({
      kind: 'feature',
      projectId: 'proj_a',
      featureSlug: 'x',
    })
  })

  it("carries the selected feature's view, and none for Work", () => {
    const feature = { kind: 'feature', projectId: 'proj_a', featureSlug: 'x' }
    expect(locationFor({ ...base, featureSlug: 'x', featureView: 'work' })).toEqual(feature)
    expect(locationFor({ ...base, featureSlug: 'x', featureView: 'chat' })).toEqual({
      ...feature,
      view: 'chat',
    })
    expect(locationFor({ ...base, featureSlug: 'x', featureView: 'design' })).toEqual({
      ...feature,
      view: 'design',
    })
    // A view is the feature's; the project chat and preparation have none.
    expect(locationFor({ ...base, projectSelected: true, featureSlug: 'x', featureView: 'chat' })).toEqual({
      kind: 'chat',
      projectId: 'proj_a',
    })
  })

  it('is the project home when nothing inside it is selected', () => {
    expect(locationFor(base)).toEqual({ kind: 'project', projectId: 'proj_a' })
  })
})
