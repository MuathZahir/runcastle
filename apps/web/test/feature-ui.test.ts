import { describe, expect, it } from 'vitest'
import type { EventRow, TicketStatus } from '@runcastle/core'
import {
  defaultBaseBranch,
  mergeConflictKickoff,
  needsMe,
  nextStep,
  parseMapSections,
  REVIEW_ITERATE_KICKOFF,
  triage,
  triageOf,
  unresolvedMergeConflict,
  waypointGroups,
  type Waypoint,
} from '../src/lib/feature-ui'
import type { FeatureFull, FeatureListItem } from '../src/lib/api'

/**
 * Streamlining-ux ticket 2 — the New Feature form defaults Branch-from to the
 * branch the project is currently checked out on, falling back to the project
 * main branch when that checkout isn't a selectable base. Tested at the pure
 * derivation, no DOM.
 */
describe('defaultBaseBranch', () => {
  it('defaults to the current checkout when it is a selectable base', () => {
    expect(
      defaultBaseBranch({ current: 'develop', mainBranch: 'main', branches: ['main', 'develop'] }),
    ).toBe('develop')
  })

  it('defaults to main when the current checkout is main', () => {
    expect(
      defaultBaseBranch({ current: 'main', mainBranch: 'main', branches: ['main', 'develop'] }),
    ).toBe('main')
  })

  it('falls back to main on a detached HEAD (current not in the list)', () => {
    expect(
      defaultBaseBranch({ current: '', mainBranch: 'main', branches: ['main', 'develop'] }),
    ).toBe('main')
  })

  it('falls back to main when a test drive holds a feature/* checkout (excluded)', () => {
    // The picker excludes feature/* branches, so a test-drive checkout is never
    // a selectable base — the default lands on the project main branch.
    expect(
      defaultBaseBranch({ current: 'feature/x', mainBranch: 'main', branches: ['main'] }),
    ).toBe('main')
  })
})

/**
 * Reopening a terminal resumes its conversation, so the bar must say so. A
 * session row is `ended` the moment runcastle restarts (the PTY dies with the
 * server), but a row that reached `live` recorded a `ccSessionId` and the
 * launcher `--resume`s it on the next same-kind launch. The action is unchanged
 * either way — only the wording tells the human which one they'll get.
 */
describe('nextStep — Resume vs Start wording for the grill', () => {
  const grillFull = (opts: { phase?: string; sessions?: unknown[]; tickets?: unknown[] }) =>
    ({
      feature: { id: 'f1', phase: opts.phase ?? 'ideation', mapped: false, status: 'active' },
      tickets: opts.tickets ?? [],
      sessions: opts.sessions ?? [],
      runs: [],
      gate: { next: { id: 'G1' }, satisfied: false, reason: 'no decisions yet' },
    }) as unknown as FeatureFull

  const endedGrill = [{ id: 's1', status: 'ended', kind: 'ideation', ccSessionId: 'cc-1' }]

  it('says Start when the feature has never had a grill conversation', () => {
    const ns = nextStep(grillFull({}), { driving: false })
    expect(ns.primary).toEqual({ label: 'Start grill session', kind: 'startGrill' })
  })

  it('says Resume once an ended grill session left a resumable conversation', () => {
    const ns = nextStep(grillFull({ sessions: endedGrill }), { driving: false })
    expect(ns.primary).toEqual({ label: 'Resume grill session', kind: 'startGrill' })
    expect(ns.desc).toContain('still on disk')
  })

  it('keeps saying Start when the ended session never reached live (no cc id)', () => {
    const stillborn = [{ id: 's1', status: 'ended', kind: 'ideation', ccSessionId: null }]
    const ns = nextStep(grillFull({ sessions: stillborn }), { driving: false })
    expect(ns.primary?.label).toBe('Start grill session')
  })

  it('ignores a resumable session of a DIFFERENT kind (the launcher would not pick it)', () => {
    const qaOnly = [{ id: 's1', status: 'ended', kind: 'qa', ccSessionId: 'cc-qa' }]
    const ns = nextStep(grillFull({ sessions: qaOnly }), { driving: false })
    expect(ns.primary?.label).toBe('Start grill session')
  })

  it('carries the same wording into the spec and tickets phases', () => {
    expect(nextStep(grillFull({ phase: 'spec' }), { driving: false }).primary?.label).toBe(
      'Open grill',
    )
    expect(
      nextStep(grillFull({ phase: 'spec', sessions: endedGrill }), { driving: false }).primary
        ?.label,
    ).toBe('Resume grill')
    expect(nextStep(grillFull({ phase: 'tickets' }), { driving: false }).primary?.label).toBe(
      'Open grill to emit tickets',
    )
    expect(
      nextStep(grillFull({ phase: 'tickets', sessions: endedGrill }), { driving: false }).primary
        ?.label,
    ).toBe('Resume grill to emit tickets')
  })
})

/**
 * Streamlining-ux ticket 6 — the review-phase next step is a loop, not a
 * terminus: Iterate opens a revisit session (hidden while one is live), and a
 * pending fix ticket promotes Burn to primary while Merge & ship + test drive
 * stay available. Tested at the pure `nextStep` derivation.
 */
describe('nextStep at review', () => {
  const reviewFull = (opts: {
    ticketStatuses?: TicketStatus[]
    sessionLive?: boolean
  }): FeatureFull => {
    const tickets = (opts.ticketStatuses ?? []).map((status, i) => ({
      id: `t${i}`,
      status,
      commits: [],
    }))
    const sessions = opts.sessionLive ? [{ id: 's1', status: 'live', kind: 'revisit' }] : []
    return {
      feature: { id: 'f1', phase: 'review', mapped: false },
      tickets,
      sessions,
      runs: [{ id: 'r1', status: 'succeeded', startedAt: 1 }],
      gate: { next: null, satisfied: false, reason: null },
    } as unknown as FeatureFull
  }
  const labels = (as: { label: string }[]) => as.map((a) => a.label)

  it('offers Iterate and keeps Merge & ship primary when no tickets are pending', () => {
    const ns = nextStep(reviewFull({}), { driving: false })
    expect(ns.primary).toEqual({ label: 'Merge & ship', kind: 'merge' })
    expect(labels(ns.secondary)).toEqual(['Start test drive', 'Iterate'])
  })

  it('promotes Burn to primary and drops Merge & ship to secondary with a pending ticket', () => {
    const ns = nextStep(reviewFull({ ticketStatuses: ['done', 'pending'] }), { driving: false })
    expect(ns.primary).toEqual({ label: 'Burn 1 ticket', kind: 'burn' })
    expect(labels(ns.secondary)).toEqual(['Merge & ship', 'Start test drive', 'Iterate'])
  })

  it('hides Iterate while a session is live (one terminal per feature)', () => {
    const ns = nextStep(reviewFull({ sessionLive: true }), { driving: false })
    expect(labels(ns.secondary)).not.toContain('Iterate')
    // Merge & ship + test drive remain available throughout.
    expect(ns.primary?.label).toBe('Merge & ship')
    expect(labels(ns.secondary)).toEqual(['Start test drive'])
  })

  it('hides Iterate but still promotes Burn when a session is live with pending tickets', () => {
    const ns = nextStep(
      reviewFull({ ticketStatuses: ['pending'], sessionLive: true }),
      { driving: false },
    )
    expect(ns.primary).toEqual({ label: 'Burn 1 ticket', kind: 'burn' })
    expect(labels(ns.secondary)).toEqual(['Merge & ship', 'Start test drive'])
  })

  it('keeps the test-drive toggle and Merge & ship available while driving', () => {
    const ns = nextStep(reviewFull({ ticketStatuses: ['pending'] }), { driving: true })
    expect(ns.primary?.kind).toBe('burn')
    expect(labels(ns.secondary)).toEqual(['Merge & ship', 'Stop test drive', 'Iterate'])
  })

  it('exposes the review-iteration kickoff briefing for the launch override', () => {
    // The dispatch passes this verbatim as the launchSession kickoff override.
    expect(REVIEW_ITERATE_KICKOFF).toContain('REVIEW ITERATION')
    expect(REVIEW_ITERATE_KICKOFF).toContain('emit_tickets')
    expect(REVIEW_ITERATE_KICKOFF).toContain('click Burn')
  })
})

/**
 * Streamlining-ux ticket 9 — a conflicted Merge & ship is surfaced from the
 * event feed (so the conflict card survives a reload) and the resolve action
 * briefs a merge-into-feature session. Tested at the pure derivations.
 */
describe('unresolvedMergeConflict', () => {
  const ev = (id: number, type: string, data?: unknown): EventRow =>
    ({ id, projectId: 'p', ts: id, type, message: type, data }) as EventRow

  it('returns null when there is no merge.conflict event', () => {
    expect(unresolvedMergeConflict([ev(1, 'burn.started'), ev(2, 'phase.advanced')])).toBeNull()
  })

  it('reads the base branch and files off the latest merge.conflict event', () => {
    const events = [
      ev(1, 'merge.conflict', { base: 'main', files: ['a.ts'] }),
      ev(2, 'merge.conflict', { base: 'develop', files: ['x.ts', 'y.ts'] }),
    ]
    expect(unresolvedMergeConflict(events)).toEqual({ base: 'develop', files: ['x.ts', 'y.ts'] })
  })

  it('clears once a burn supersedes the conflict (loop moved on)', () => {
    const events = [
      ev(1, 'merge.conflict', { base: 'main', files: ['a.ts'] }),
      ev(2, 'burn.started', { from: 'review' }),
    ]
    expect(unresolvedMergeConflict(events)).toBeNull()
  })

  it('re-surfaces a fresh conflict after a burn cycle', () => {
    const events = [
      ev(1, 'merge.conflict', { base: 'main', files: ['a.ts'] }),
      ev(2, 'burn.started', { from: 'review' }),
      ev(3, 'merge.conflict', { base: 'main', files: ['b.ts'] }),
    ]
    expect(unresolvedMergeConflict(events)).toEqual({ base: 'main', files: ['b.ts'] })
  })

  it('tolerates a conflict event with a missing/blank file list', () => {
    expect(unresolvedMergeConflict([ev(1, 'merge.conflict', { base: 'main' })])).toEqual({
      base: 'main',
      files: [],
    })
  })
})

describe('mergeConflictKickoff', () => {
  it('names the base, feature branch, and files, and forbids advancing the phase', () => {
    const line = mergeConflictKickoff('main', 'feature/x', ['a.ts', 'b.ts'])
    expect(line).toContain('git merge main')
    expect(line).toContain('feature/x')
    expect(line).toContain('a.ts, b.ts')
    expect(line).toContain('complete_phase')
    expect(line).toContain('Merge & ship')
  })

  it('degrades gracefully when the file list is empty', () => {
    const line = mergeConflictKickoff('main', 'feature/x', [])
    expect(line).toContain('git status')
  })
})

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

/**
 * Improve-map-workflow ticket 3 — the map rail's two seams. `parseMapSections`
 * was private to the grill body; the rail and the fog warning now read one
 * implementation, so it is tested here on its own.
 */
describe('parseMapSections', () => {
  it('splits a map into its `## ` sections, keyed by heading', () => {
    const map = [
      '# Map — demo',
      '',
      'preamble that belongs to no section',
      '',
      '## Destination',
      'Ship the rail.',
      '',
      '## Out of scope',
      'The tickets body.',
    ].join('\n')
    expect(parseMapSections(map)).toEqual({
      Destination: 'Ship the rail.\n',
      'Out of scope': 'The tickets body.',
    })
  })

  it('keeps deeper headings inside their section rather than opening a new one', () => {
    const map = ['## Notes', 'intro', '### A sub-heading', 'detail'].join('\n')
    expect(parseMapSections(map)).toEqual({ Notes: 'intro\n### A sub-heading\ndetail' })
  })

  it('returns nothing for a map with no `## ` headings at all', () => {
    expect(parseMapSections('just prose\nand more prose')).toEqual({})
  })

  it('records an empty body for a heading with nothing under it', () => {
    expect(parseMapSections('## Not yet specified')).toEqual({ 'Not yet specified': '' })
  })
})

/**
 * Improve-map-workflow ticket 3 — the rail's grouping, ordering, lineage and
 * default-expanded state as a pure derivation, because this repo has no DOM
 * test environment and the rail component is kept thin over it.
 */
describe('waypointGroups', () => {
  function wp(over: Partial<Waypoint> & Pick<Waypoint, 'id' | 'seq' | 'title'>): Waypoint {
    return {
      featureId: 'feat_1',
      type: 'grilling',
      question: `what about ${over.title}?`,
      blockedBy: [],
      originWaypointId: null,
      status: 'open',
      claimedBy: null,
      lastSessionId: null,
      summary: null,
      ...over,
    } as Waypoint
  }

  const keys = (gs: ReturnType<typeof waypointGroups>) => gs.map((g) => g.key)
  const titles = (gs: ReturnType<typeof waypointGroups>, key: string) =>
    gs.find((g) => g.key === key)?.waypoints.map((r) => r.waypoint.title) ?? []

  it('returns nothing for a map with no waypoints yet', () => {
    expect(waypointGroups([], [])).toEqual([])
  })

  it('groups frontier, claimed, blocked and terminal waypoints in rail order', () => {
    const ws = [
      wp({ id: 'w1', seq: 1, title: 'resolved one', status: 'resolved', summary: 'done' }),
      wp({ id: 'w2', seq: 2, title: 'claimed one', status: 'claimed', claimedBy: 'sess_1' }),
      wp({ id: 'w3', seq: 3, title: 'open one' }),
      wp({ id: 'w4', seq: 4, title: 'blocked one', blockedBy: [2] }),
      wp({ id: 'w5', seq: 5, title: 'dropped one', status: 'dropped' }),
    ]
    const groups = waypointGroups(ws, ['w3'])
    expect(keys(groups)).toEqual(['frontier', 'claimed', 'blocked', 'done'])
    expect(titles(groups, 'frontier')).toEqual(['open one'])
    expect(titles(groups, 'claimed')).toEqual(['claimed one'])
    expect(titles(groups, 'blocked')).toEqual(['blocked one'])
    expect(titles(groups, 'done')).toEqual(['resolved one', 'dropped one'])
  })

  it('omits groups that have no waypoints', () => {
    const ws = [wp({ id: 'w1', seq: 1, title: 'only one' })]
    expect(keys(waypointGroups(ws, ['w1']))).toEqual(['frontier'])
  })

  it('orders the frontier by ascending seq whatever order the server sent', () => {
    const ws = [
      wp({ id: 'w9', seq: 9, title: 'ninth' }),
      wp({ id: 'w2', seq: 2, title: 'second' }),
      wp({ id: 'w5', seq: 5, title: 'fifth' }),
    ]
    const groups = waypointGroups(ws, ['w9', 'w2', 'w5'])
    expect(titles(groups, 'frontier')).toEqual(['second', 'fifth', 'ninth'])
  })

  it('resolves blockedBy seqs to blocker titles, dropping the ones already terminal', () => {
    const ws = [
      wp({ id: 'w1', seq: 1, title: 'already resolved', status: 'resolved' }),
      wp({ id: 'w2', seq: 2, title: 'still open' }),
      wp({ id: 'w3', seq: 3, title: 'waits on both', blockedBy: [1, 2] }),
    ]
    const groups = waypointGroups(ws, ['w2'])
    const blocked = groups.find((g) => g.key === 'blocked')?.waypoints ?? []
    expect(blocked.map((r) => r.blockerTitles)).toEqual([['still open']])
  })

  it('ignores a blockedBy seq that names no waypoint', () => {
    const ws = [wp({ id: 'w1', seq: 1, title: 'orphan edge', blockedBy: [42] })]
    const groups = waypointGroups(ws, [])
    expect(groups.find((g) => g.key === 'blocked')?.waypoints[0].blockerTitles).toEqual([])
  })

  it('names the waypoint that surfaced a later one, and leaves origin-less ones bare', () => {
    const ws = [
      wp({ id: 'w1', seq: 1, title: 'the origin', status: 'resolved' }),
      wp({ id: 'w2', seq: 2, title: 'surfaced later', originWaypointId: 'w1' }),
      wp({ id: 'w3', seq: 3, title: 'charted up front' }),
    ]
    const groups = waypointGroups(ws, ['w2', 'w3'])
    const frontier = groups.find((g) => g.key === 'frontier')?.waypoints ?? []
    expect(frontier.map((r) => r.originTitle)).toEqual(['the origin', undefined])
  })

  it('starts frontier waypoints expanded and every other group collapsed', () => {
    const ws = [
      wp({ id: 'w1', seq: 1, title: 'frontier', status: 'open' }),
      wp({ id: 'w2', seq: 2, title: 'claimed', status: 'claimed', claimedBy: 'sess_1' }),
      wp({ id: 'w3', seq: 3, title: 'blocked', blockedBy: [2] }),
      wp({ id: 'w4', seq: 4, title: 'done', status: 'resolved' }),
    ]
    const groups = waypointGroups(ws, ['w1'])
    expect(groups.map((g) => g.waypoints.map((r) => r.expanded))).toEqual([
      [true],
      [false],
      [false],
      [false],
    ])
  })

  it('labels each group for the rail header', () => {
    const ws = [
      wp({ id: 'w1', seq: 1, title: 'frontier' }),
      wp({ id: 'w2', seq: 2, title: 'done', status: 'dropped' }),
    ]
    const groups = waypointGroups(ws, ['w1'])
    expect(groups.map((g) => g.label)).toEqual(['Frontier', 'Resolved / dropped'])
  })
})
