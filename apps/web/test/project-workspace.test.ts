import { describe, expect, it } from 'vitest'
import {
  PROJECT_BRANCH,
  projectBranchNote,
  projectSessionState,
  showsInspector,
  showsPrepNudge,
  workspaceView,
} from '../src/lib/project-workspace'
import type { ProjectSession } from '../src/lib/api'

/**
 * The project workspace's swap rules and its chrome (decision 20). The rail
 * gains one row that is not a feature, and everything downstream of selecting it
 * — which body renders, whether the Inspector exists, what the chrome promises
 * about where commits go — is decided here.
 */

const session = (status: 'launching' | 'live' | 'ended'): ProjectSession =>
  ({ id: 'sess_1', projectId: 'proj_1', kind: 'project', status, worktreePath: '/w' }) as ProjectSession

/** A prepared project with one feature — the resting case every test varies. */
const state = (over: Partial<Parameters<typeof workspaceView>[0]> = {}) => ({
  creating: false,
  preparing: false,
  projectSelected: false,
  selectedFeatureId: null,
  featureCount: 1,
  prepared: true,
  ...over,
})

describe('workspaceView', () => {
  it('swaps to the project workspace when the pinned row is selected', () => {
    expect(workspaceView(state({ projectSelected: true, selectedFeatureId: 'f1' }))).toBe('project')
  })

  // Selecting any feature must restore the feature workspace — the pinned row is
  // a selection, not a mode you have to leave.
  it('restores the feature workspace once a feature is selected', () => {
    expect(workspaceView(state({ selectedFeatureId: 'f1' }))).toBe('feature')
  })

  it('falls back to the project home with neither selected', () => {
    expect(workspaceView(state())).toBe('empty')
  })

  it('lets a creation form own the body outright', () => {
    expect(
      workspaceView(state({ creating: true, projectSelected: true, selectedFeatureId: 'f1' })),
    ).toBe('create')
  })

  /**
   * The call-to-action. An unprepared project with no features has exactly one
   * sensible next step, and the whole point of the change is that it stops being
   * a card beside the new-feature buttons — where it was, and where nobody found
   * it.
   */
  it('gives the whole body to preparation on an unprepared, featureless project', () => {
    expect(workspaceView(state({ featureCount: 0, prepared: false }))).toBe('prepare')
  })

  it('reads as the ordinary home once either half of that stops holding', () => {
    expect(workspaceView(state({ featureCount: 0, prepared: true }))).toBe('empty')
    expect(workspaceView(state({ featureCount: 3, prepared: false }))).toBe('empty')
  })

  // Opening it deliberately (the rail's nudge, ⌘K) beats every automatic rule
  // below it — including one that would swap it away the moment it succeeds.
  it('honours a deliberately opened preparation over the selected feature', () => {
    expect(workspaceView(state({ preparing: true, selectedFeatureId: 'f1' }))).toBe('prepare')
  })

  it('still lets a creation form outrank it', () => {
    expect(workspaceView(state({ creating: true, preparing: true }))).toBe('create')
  })
})

describe('showsPrepNudge', () => {
  // The demoted half: exactly the case the whole-body version gives up.
  it('is the unprepared project that already has features', () => {
    expect(showsPrepNudge({ featureCount: 2, prepared: false })).toBe(true)
    expect(showsPrepNudge({ featureCount: 0, prepared: false })).toBe(false)
    expect(showsPrepNudge({ featureCount: 2, prepared: true })).toBe(false)
  })
})

describe('showsInspector', () => {
  // Every Inspector panel is feature-scoped, so the project workspace hides it
  // rather than showing panels about a feature you are not looking at.
  it('is the feature workspace only', () => {
    expect(showsInspector('feature', false)).toBe(true)
    expect(showsInspector('project', false)).toBe(false)
    expect(showsInspector('empty', false)).toBe(false)
    expect(showsInspector('create', false)).toBe(false)
    expect(showsInspector('prepare', false)).toBe(false)
  })

  it('still respects the collapse toggle', () => {
    expect(showsInspector('feature', true)).toBe(false)
  })
})

describe('projectSessionState', () => {
  it('reads the polled session row, including while it launches', () => {
    expect(projectSessionState(null)).toBe('none')
    expect(projectSessionState(undefined)).toBe('none')
    expect(projectSessionState(session('launching'))).toBe('launching')
    expect(projectSessionState(session('live'))).toBe('live')
  })

  // The row is the single source of truth: a session ended from anywhere stops
  // showing a live indicator on the pinned row.
  it('never reads an ended session as live', () => {
    expect(projectSessionState(session('ended'))).toBe('none')
  })
})

describe('projectBranchNote', () => {
  it('states the branch and where its commits land', () => {
    const note = projectBranchNote('main')
    expect(note).toContain(PROJECT_BRANCH)
    expect(note).toContain('commits land on main')
    expect(note).toContain('checkout')
  })

  // `project.list` has not landed on the first paint; naming no branch beats
  // promising commits land somewhere they do not.
  it('names no branch rather than the wrong one before the project loads', () => {
    expect(projectBranchNote('')).toContain('the base branch')
  })
})
