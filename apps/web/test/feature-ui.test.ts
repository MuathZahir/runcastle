import { describe, expect, it } from 'vitest'
import type { EventRow, TicketStatus } from '@runcastle/core'
import {
  defaultBaseBranch,
  mergeConflictKickoff,
  nextStep,
  REVIEW_ITERATE_KICKOFF,
  unresolvedMergeConflict,
} from '../src/lib/feature-ui'
import type { FeatureFull } from '../src/lib/api'

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
