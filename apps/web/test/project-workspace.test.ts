import { describe, expect, it } from 'vitest'
import { matchesProjectChat, projectSessionState, sessionBranchState, workspaceView } from '../src/lib/project-workspace'
import type { ProjectSession } from '../src/lib/api'

/**
 * The project workspace's swap rules and its chrome (decision 20). The rail
 * gains one row that is not a feature, and everything downstream of selecting it
 * — which body renders, whether the Inspector exists, what the chrome promises
 * about where commits go — is decided here.
 */

const session = (status: 'launching' | 'live' | 'ended'): ProjectSession =>
  ({ id: 'sess_1', projectId: 'proj_1', kind: 'project', status, worktreePath: '/w' }) as ProjectSession

/** Nothing selected — the resting case every test varies. */
const state = (over: Partial<Parameters<typeof workspaceView>[0]> = {}) => ({
  creating: false,
  projectSelected: false,
  selectedFeatureId: null,
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

  /**
   * Nothing selected is the project home, which a new project opens on Start the
   * project (the-orchestrator-prepares-the-project decision 1): whether to
   * prepare is the Orchestrator's call, so no state yields a Preparation view.
   */
  it('falls back to the project home with neither selected', () => {
    expect(workspaceView(state())).toBe('project')
  })

  it('lets a creation form own the body outright', () => {
    expect(
      workspaceView(state({ creating: true, projectSelected: true, selectedFeatureId: 'f1' })),
    ).toBe('create')
  })
})

describe('matchesProjectChat', () => {
  it('answers to the words an idea is brought in by', () => {
    for (const q of ['orchestrator', 'talk', 'ask', 'chat', 'project chat', 'conversation', 'idea', 'discuss'])
      expect(matchesProjectChat(q)).toBe(true)
  })

  it('stays out of the way of unrelated queries', () => {
    expect(matchesProjectChat('merge')).toBe(false)
    expect(matchesProjectChat('baseline')).toBe(false)
  })

  // Decision 12 — the palette opens on its whole hand.
  it('shows on an empty query', () => {
    expect(matchesProjectChat('')).toBe(true)
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

/**
 * Where the project chat's work lands is its own visible, per-project setting
 * (decisions 5–6): stored if a human picked, else detected at read time, and
 * only an explicit pick ever writes. The menu has to say which of those it is
 * showing — "main, because we looked" and "main, because you said so" are
 * different promises — and refuse the launch when the pick is gone.
 */
describe('sessionBranchState', () => {
  const branches = ['main', 'develop']

  it('reads an unpicked project as detected, and never as a choice', () => {
    const state = sessionBranchState(
      { stored: null, effective: 'main', detected: 'main' },
      branches,
    )
    expect(state).toEqual({ value: 'main', origin: 'detected' })
  })

  it('shows a human pick as theirs, over the detected main line', () => {
    const state = sessionBranchState(
      { stored: 'develop', effective: 'develop', detected: 'main' },
      branches,
    )
    expect(state).toEqual({ value: 'develop', origin: 'picked' })
  })

  // The one state the menu exists to fix (spec, "Seams"): the launch refuses to
  // run and points here, so here has to admit what is wrong.
  it('marks a pick whose branch is gone, which is what blocks New chat', () => {
    const state = sessionBranchState(
      { stored: 'release/1.2', effective: 'release/1.2', detected: 'main' },
      branches,
    )
    expect(state).toEqual({ value: 'release/1.2', origin: 'vanished' })
  })

  it('never accuses a pick of being gone while the branch list is in flight', () => {
    expect(
      sessionBranchState({ stored: 'develop', effective: 'develop', detected: 'main' }, undefined),
    ).toMatchObject({ origin: 'picked' })
  })

  // "Detected" and "your pick" read as opposites, so there is no safe guess
  // before the answer arrives — the picker renders nothing at all.
  it('renders nothing until the query answers', () => {
    expect(sessionBranchState(undefined, branches)).toBeNull()
  })
})
