import { describe, expect, it } from 'vitest'
import {
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
]

describe('pathFor', () => {
  it('gives every location a canonical path', () => {
    expect(LOCATIONS.map(pathFor)).toEqual([
      '/',
      '/p/proj_a',
      '/p/proj_a/chat',
      '/p/proj_a/prepare',
      '/p/proj_a/f/flow-redesign-shell',
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

  it('round-trips ids and slugs that needed escaping', () => {
    const location: AppLocation = { kind: 'feature', projectId: 'a/b', featureSlug: 'c d' }
    expect(parsePath(pathFor(location))).toEqual(location)
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

  it('is the project home when nothing inside it is selected', () => {
    expect(locationFor(base)).toEqual({ kind: 'project', projectId: 'proj_a' })
  })
})
