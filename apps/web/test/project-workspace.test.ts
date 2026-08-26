import { describe, expect, it } from 'vitest'
import {
  PROJECT_BRANCH,
  matchesPreparation,
  matchesProjectChat,
  prepRailRow,
  projectBranchNote,
  projectSessionState,
  sessionBranchState,
  showsInspector,
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

describe('prepRailRow', () => {
  /**
   * The row that replaced the vanishing nudge. `prepared` is monotonic, so a
   * boolean gate on it removed the rail row and the whole-body call-to-action at
   * the same instant preparation succeeded — leaving nothing that represented a
   * finished preparation and no way back to it. Both variants render.
   */
  it('carries the job while it is open', () => {
    expect(prepRailRow({ prepared: false, pendingCount: 8, staleCount: 0 })).toMatchObject({
      variant: 'todo',
      count: 8,
      label: 'Prepare this project',
      // A bare "8" was read as a count of anything at all (findings F17.5).
      badge: '8 to establish',
    })
  })

  it('stays on as a way back once the job is done', () => {
    expect(prepRailRow({ prepared: true, pendingCount: 0, staleCount: 0 })).toMatchObject({
      variant: 'done',
      label: 'Re-prepare the project',
      badge: null,
    })
  })

  // Prepared is not the same as current: the one number worth a badge afterwards
  // is what has silently rotted, since agents trust a stale baseline.
  it('badges drift rather than pending count once prepared', () => {
    expect(prepRailRow({ prepared: true, pendingCount: 3, staleCount: 2 })).toMatchObject({
      variant: 'done',
      stale: 2,
      badge: '2 stale',
    })
  })

  it('drops the badge when there is no number to report', () => {
    expect(prepRailRow({ prepared: false, pendingCount: 0, staleCount: 0 })?.badge).toBeNull()
  })

  // The two variants read as opposites, so there is no safe guess before the
  // answer lands — "Re-prepare" flashing on an unprepared project is a lie.
  it('renders nothing at all until the prep view answers', () => {
    expect(prepRailRow(undefined)).toBeNull()
    expect(prepRailRow(null)).toBeNull()
  })
})

describe('matchesPreparation', () => {
  it('still answers to the words it always did', () => {
    expect(matchesPreparation('prepare')).toBe(true)
    expect(matchesPreparation('baseline')).toBe(true)
    expect(matchesPreparation('')).toBe(true)
  })

  /**
   * The words someone types looking for preparation a SECOND time. All of these
   * missed, which is how a finished preparation became unreachable for anyone who
   * had not memorised the noun — the palette was the last way in.
   */
  it('answers to the words a re-run is searched for by', () => {
    for (const q of ['re-prepare', 'reprepare', 'redo', 're-run', 'rerun', 'stale', 'findings'])
      expect(matchesPreparation(q)).toBe(true)
  })

  it('stays out of the way of unrelated queries', () => {
    expect(matchesPreparation('merge')).toBe(false)
    expect(matchesPreparation('ticket')).toBe(false)
  })

  /**
   * Preparation used to answer to 'talk' and 'ask' on the reasoning that the
   * conversation was reached through its row. Typing "talk" landing on
   * Preparation was the complaint; the chat has its own row now.
   */
  it('no longer answers to the words for having a conversation', () => {
    expect(matchesPreparation('talk')).toBe(false)
    expect(matchesPreparation('ask')).toBe(false)
  })
})

describe('matchesProjectChat', () => {
  it('answers to the words an idea is brought in by', () => {
    for (const q of ['talk', 'ask', 'chat', 'project chat', 'conversation', 'idea', 'discuss'])
      expect(matchesProjectChat(q)).toBe(true)
  })

  it('stays out of the way of unrelated queries', () => {
    expect(matchesProjectChat('merge')).toBe(false)
    expect(matchesProjectChat('baseline')).toBe(false)
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

  // The session-branch query has not landed on the first paint; naming no branch
  // beats promising commits land somewhere they do not.
  it('names no branch rather than the wrong one before the project loads', () => {
    expect(projectBranchNote('')).toContain('the base branch')
  })
})

/**
 * Where the project chat's work lands is its own visible, per-project setting
 * (decisions 5–6): stored if a human picked, else detected at read time, and
 * only an explicit pick ever writes. The picker has to say which of those it is
 * showing — "main, because we looked" and "main, because you said so" are
 * different promises — and that a change waits for the next chat.
 */
describe('sessionBranchState', () => {
  const branches = ['main', 'develop']

  it('reads an unpicked project as detected, and never as a choice', () => {
    const state = sessionBranchState(
      { stored: null, effective: 'main', detected: 'main' },
      branches,
    )
    expect(state).toMatchObject({ value: 'main', origin: 'detected', label: 'detected' })
    expect(state?.note).toContain('nobody has picked')
    expect(state?.note).toContain('next chat you open')
  })

  it('shows a human pick as theirs, over the detected main line', () => {
    const state = sessionBranchState(
      { stored: 'develop', effective: 'develop', detected: 'main' },
      branches,
    )
    expect(state).toMatchObject({ value: 'develop', origin: 'picked', label: 'your pick' })
    expect(state?.note).toContain('nothing re-detects over it')
  })

  // The one state the picker exists to fix (spec, "Seams"): the launch refuses
  // to run and points here, so here has to admit what is wrong.
  it('says a pick whose branch is gone will refuse to launch', () => {
    const state = sessionBranchState(
      { stored: 'release/1.2', effective: 'release/1.2', detected: 'main' },
      branches,
    )
    expect(state).toMatchObject({ value: 'release/1.2', origin: 'vanished', label: 'branch gone' })
    expect(state?.note).toContain('refuse to launch')
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
