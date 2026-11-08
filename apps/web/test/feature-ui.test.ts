import { describe, expect, it } from 'vitest'
import type { EventRow } from '@runcastle/core'
import {
  activeSession,
  defaultBaseBranch,
  deferredScope,
  driveFailure,
  duplicateTitleWarning,
  findingCountsLine,
  findingOpenReason,
  headline,
  landingFeature,
  lastTestDriveAt,
  mergeConflictKickoff,
  needsMe,
  nextStep,
  openApp,
  openAppWaitingLabel,
  PHASE_ORDER,
  progressState,
  reviewOutcome,
  reviewWalkthroughUrl,
  rowChip,
  sessionActive,
  sessionStatusLabel,
  shippedAt,
  shippedChatSessions,
  sortForSidebar,
  testDriveFigure,
  landedShare,
  buildShare,
  ticketShare,
  triage,
  triageOf,
  unresolvedMergeConflict,
} from '../src/lib/feature-ui'
import type { FeatureFull, FeatureListItem } from '../src/lib/api'
import { full, listItem, need } from './fixtures'

/**
 * Every cutting form prefills Branch-from with the branch the project is
 * currently checked out on, falling back to main when runcastle's own internal
 * branch is the checkout. Tested at the pure derivation, no DOM.
 */
describe('defaultBaseBranch', () => {
  it('defaults to the current checkout when it is a selectable base', () => {
    expect(defaultBaseBranch({ current: 'develop', detected: 'main', branches: ['main', 'develop'] })).toBe('develop')
  })

  it('defaults to main when the current checkout is main', () => {
    expect(defaultBaseBranch({ current: 'main', detected: 'main', branches: ['main', 'develop'] })).toBe('main')
  })

  it('uses the detected main line on a detached HEAD', () => {
    expect(defaultBaseBranch({ current: '', detected: 'main', branches: ['main', 'develop'] })).toBe('main')
  })

  it('offers no default when neither current nor detected is available', () => {
    expect(defaultBaseBranch({ current: '', detected: 'missing', branches: ['develop'] })).toBe('')
  })

  it('falls back to the detected main line when a test drive holds an excluded checkout', () => {
    expect(
      defaultBaseBranch({ current: 'feature/x', detected: 'main', branches: ['main'] }),
    ).toBe('main')
  })

  it('defaults to main when runcastle runs from an internal checkout', () => {
    expect(
      defaultBaseBranch({
        current: 'runcastle/project',
        detected: 'main',
        branches: ['main', 'develop'],
      }),
    ).toBe('main')
  })
})

/**
 * The New Feature form had no duplicate guard at all (findings F25.3). The
 * warning matches on the SLUG, because that is what actually collides — and it
 * warns rather than blocks, since a second attempt at the same idea is a real
 * thing to want.
 */
describe('duplicateTitleWarning', () => {
  const existing = [
    { title: 'Slack notifications', slug: 'slack-notifications', status: 'active' },
    { title: 'Entry tags', slug: 'entry-tags', status: 'shipped' },
  ] as unknown as FeatureListItem[]

  it('says nothing for a title nothing else uses', () => {
    expect(duplicateTitleWarning('Dark mode', existing)).toBeNull()
  })

  it('says nothing for an empty or punctuation-only title', () => {
    expect(duplicateTitleWarning('', existing)).toBeNull()
    expect(duplicateTitleWarning('   ', existing)).toBeNull()
    expect(duplicateTitleWarning('!!!', existing)).toBeNull()
  })

  it('warns when the title slugifies onto an existing feature', () => {
    expect(duplicateTitleWarning('Slack notifications', existing)).toContain(
      'feature/slack-notifications',
    )
  })

  it('catches collisions the raw titles do not show', () => {
    // Different strings, same branch name — which is the collision that matters.
    expect(duplicateTitleWarning('  slack   NOTIFICATIONS!  ', existing)).toContain(
      '“Slack notifications”',
    )
  })

  it('says a shipped feature was already shipped', () => {
    expect(duplicateTitleWarning('Entry tags', existing)).toContain('was already shipped')
  })

  it('warns against an empty project without throwing', () => {
    expect(duplicateTitleWarning('Anything', [])).toBeNull()
  })
})

/**
 * ui-state-management ticket 3 — the session registry's one rule, in one place.
 * The server spawns and owns the PTY, so a spawned session is an active session;
 * the `live` status only records that the agent's `SessionStart` hook checked in.
 * Every surface asks this, so it is tested here rather than through each of them.
 */
describe('sessionActive', () => {
  const rows = (list: unknown[]) => list as FeatureFull['sessions']

  it('counts a launching session — its terminal is already running', () => {
    expect(sessionActive({ status: 'launching' })).toBe(true)
  })

  it('counts a live session', () => {
    expect(sessionActive({ status: 'live' })).toBe(true)
  })

  it('does not count an ended session', () => {
    expect(sessionActive({ status: 'ended' })).toBe(false)
  })

  // The one place the two active statuses are read apart, and only for wording.
  it('labels a strip by whether the agent has checked in', () => {
    expect(sessionStatusLabel({ status: 'launching' })).toBe('launching…')
    expect(sessionStatusLabel({ status: 'live' })).toBe('live')
  })

  it('finds the active session among ended ones, and none when there is none', () => {
    const launching = { id: 's2', status: 'launching', kind: 'chat' }
    expect(
      activeSession(rows([{ id: 's1', status: 'ended', kind: 'chat' }, launching])),
    ).toEqual(launching)
    expect(activeSession(rows([{ id: 's1', status: 'ended', kind: 'chat' }]))).toBeUndefined()
    expect(activeSession(rows([]))).toBeUndefined()
  })

  // design-mode ticket 12: the drive's scenario chat is docked to the drive, not
  // the feature's own session, so it never reads as the agent working.
  it('passes over a live scenario session for the feature’s own one', () => {
    const chat = { id: 's2', status: 'live', kind: 'chat' }
    expect(activeSession(rows([{ id: 's1', status: 'live', kind: 'scenario' }, chat]))).toEqual(chat)
    expect(activeSession(rows([{ id: 's1', status: 'live', kind: 'scenario' }]))).toBeUndefined()
  })
})


/**
 * Review findings are fixed in-run, decisions #7 and #4 — what the review card
 * says in one line, why a defect is still open, and the headline/detail split
 * that stops every list on the page being a wall of prose.
 */
describe('finding rendering', () => {
  it('reads out found, fixed and open in that order', () => {
    expect(findingCountsLine({ found: 9, fixed: 8, open: 1, observations: 3 })).toBe(
      '9 defects found · 8 fixed automatically · 1 still open',
    )
  })

  /**
   * Decision 2: observations keep the line alive — a lap that saw only those
   * still had a review — but they are never named on arrival.
   */
  it('counts observations without saying them', () => {
    expect(findingCountsLine({ found: 0, fixed: 0, open: 0, observations: 1 })).toBe(
      'no defects found',
    )
  })

  it('drops every clause whose count is zero', () => {
    expect(findingCountsLine({ found: 1, fixed: 1, open: 0, observations: 0 })).toBe(
      '1 defect found · 1 fixed automatically',
    )
  })

  it('has nothing to say when the review reported nothing at all', () => {
    expect(findingCountsLine({ found: 0, fixed: 0, open: 0, observations: 0 })).toBeNull()
    expect(findingCountsLine(undefined)).toBeNull()
  })

  it('names why a defect is still open', () => {
    expect(findingOpenReason({ openReason: 'over-cap' })).toBe('over the auto-fix cap')
    expect(findingOpenReason({ openReason: 'fix-failed', failureReason: 'tests red' })).toBe(
      'fix failed: tests red',
    )
    expect(findingOpenReason({ openReason: 'fix-failed', failureReason: null })).toBe('fix failed')
    expect(findingOpenReason({ openReason: 'verification' })).toBe(
      'found by the verification pass — not auto-fixed',
    )
    expect(findingOpenReason({ openReason: null })).toBeNull()
  })

  it('leaves a short single-line note whole, with nothing to expand', () => {
    expect(headline('the run chip goes grey')).toEqual({
      head: 'the run chip goes grey',
      rest: '',
    })
  })

  it('splits a note at its own first line', () => {
    expect(headline('the run chip goes grey\n\nonly while burning')).toEqual({
      head: 'the run chip goes grey',
      rest: 'only while burning',
    })
  })

  it('cuts a long first line on a word boundary and keeps the remainder', () => {
    const long = `${'word '.repeat(30)}end`
    const { head, rest } = headline(long)
    expect(head.endsWith('…')).toBe(true)
    expect(head.length).toBeLessThanOrEqual(81)
    expect(head).not.toContain('wor…')
    expect(rest.endsWith('end')).toBe(true)
  })

  it('cuts at the limit when there is no word boundary to prefer', () => {
    const { head, rest } = headline('x'.repeat(200))
    expect(head).toBe(`${'x'.repeat(80)}…`)
    expect(rest).toBe('x'.repeat(120))
  })
})

/**
 * Streamlining-ux ticket 9 — a conflicted Merge & ship is surfaced from the
 * event feed (so the conflict card survives a reload) and the resolve action
 * briefs a merge-into-feature session. Tested at the pure derivations.
 */
describe('unresolvedMergeConflict', () => {
  it('retires a standing conflict when the feature ships', () => {
    expect(unresolvedMergeConflict([
      ev(1, 'merge.conflict', { base: 'main', files: ['a.ts'] }),
      ev(2, 'feature.shipped'),
    ])).toBeNull()
  })
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
    expect(unresolvedMergeConflict(events)).toEqual({
      base: 'develop',
      files: ['x.ts', 'y.ts'],
      at: 2,
    })
  })

  it('carries when the conflict happened — a 15-day-old conflict may be stale (F8)', () => {
    const conflict = unresolvedMergeConflict([
      ev(7, 'merge.conflict', { base: 'main', files: ['a.ts'] }),
    ])
    expect(conflict?.at).toBe(7)
  })

  it('clears once a burn supersedes the conflict (loop moved on)', () => {
    const events = [
      ev(1, 'merge.conflict', { base: 'main', files: ['a.ts'] }),
      ev(2, 'burn.started', { from: 'review' }),
    ]
    expect(unresolvedMergeConflict(events)).toBeNull()
  })

  /**
   * Fix-merge-conflict-system ticket 2 / decision 2a — a resolve session that
   * lands the merge emits `merge.resolved`, and until this the ONLY event that
   * cleared a conflict was a burn starting, so a resolved conflict left Merge &
   * ship disabled forever.
   */
  it('clears once the resolve session lands the merge', () => {
    const events = [
      ev(1, 'merge.conflict', { base: 'main', files: ['a.ts'] }),
      ev(2, 'merge.resolved', { mergeFrom: 'main', mergeInto: 'feature/dark-mode' }),
    ]
    expect(unresolvedMergeConflict(events)).toBeNull()
  })

  it('re-surfaces a conflict recorded after a resolution (the retry failed too)', () => {
    const events = [
      ev(1, 'merge.conflict', { base: 'main', files: ['a.ts'] }),
      ev(2, 'merge.resolved', { mergeFrom: 'main', mergeInto: 'feature/dark-mode' }),
      ev(3, 'merge.conflict', { base: 'main', files: ['b.ts'] }),
    ]
    expect(unresolvedMergeConflict(events)).toEqual({ base: 'main', files: ['b.ts'], at: 3 })
  })

  /**
   * A retry re-merges from scratch, so the server emits a fresh `merge.conflict`
   * with the current timestamp and files — the card must follow the latest one,
   * or the human reads a stale file list off a merge that has moved on.
   */
  it('follows the newest conflict when a retry conflicts on other files', () => {
    const events = [
      ev(1, 'merge.conflict', { base: 'main', files: ['a.ts'] }),
      ev(5, 'merge.conflict', { base: 'main', files: ['b.ts', 'c.ts'] }),
    ]
    expect(unresolvedMergeConflict(events)).toEqual({ base: 'main', files: ['b.ts', 'c.ts'], at: 5 })
  })

  it('re-surfaces a fresh conflict after a burn cycle', () => {
    const events = [
      ev(1, 'merge.conflict', { base: 'main', files: ['a.ts'] }),
      ev(2, 'burn.started', { from: 'review' }),
      ev(3, 'merge.conflict', { base: 'main', files: ['b.ts'] }),
    ]
    expect(unresolvedMergeConflict(events)).toEqual({ base: 'main', files: ['b.ts'], at: 3 })
  })

  it('tolerates a conflict event with a missing/blank file list', () => {
    expect(unresolvedMergeConflict([ev(1, 'merge.conflict', { base: 'main' })])).toEqual({
      base: 'main',
      files: [],
      at: 1,
    })
  })
})

/**
 * simplify-the-pages decision 8a — whether the build was driven, and whether
 * that drive still describes it: the one formula the status row and the merge
 * dialog share.
 */
describe('testDriveFigure', () => {
  const ev = (id: number, type: string): EventRow =>
    ({ id, projectId: 'p', ts: id * 10, type, message: type }) as EventRow
  const landed = (completedAt: number) => ({ kind: 'implementation' as const, status: 'done', completedAt })

  it('says "Not run" for a feature that was never driven', () => {
    expect(testDriveFigure(null, [landed(5)])).toEqual({ value: 'Not run', tone: 'idle' })
  })

  it('says it was taken, green when nothing landed after it', () => {
    expect(testDriveFigure(20, [landed(5)])).toEqual({ value: 'Taken', tone: 'ok' })
  })

  it('reads "Taken · not since" in amber once work landed after the drive', () => {
    expect(testDriveFigure(20, [landed(5), landed(30)])).toEqual({ value: 'Taken', sub: 'not since', tone: 'warn' })
  })

  it('never counts a review pass landing after the drive as moved work', () => {
    expect(testDriveFigure(20, [{ kind: 'review', status: 'done', completedAt: 30 }])).toEqual({ value: 'Taken', tone: 'ok' })
  })

  /** Decision 33a — the shipped record states the drive that WAS taken. */
  describe('lastTestDriveAt', () => {
    it('is null for a feature that was never driven', () => {
      expect(lastTestDriveAt([ev(1, 'burn.started')])).toBeNull()
    })

    it('reports when the LAST drive started', () => {
      const feed = [ev(1, 'testdrive.started'), ev(2, 'burn.started'), ev(3, 'testdrive.started')]
      expect(lastTestDriveAt(feed)).toBe(30)
    })
  })
})

/**
 * Ticket 2 — "Open app" is a promise that the link loads. A sniffed URL is not
 * that promise: only the server having watched it answer is.
 */
describe('openApp', () => {
  it('is nothing at all until a URL has been sniffed', () => {
    expect(openApp(undefined)).toBeNull()
    expect(openApp(null)).toBeNull()
    expect(openApp({ devReady: false })).toBeNull()
  })

  it('is a starting state — never a link — while the app has not answered', () => {
    const open = openApp({ devUrl: 'http://localhost:5173/', devReady: false })
    expect(open).toEqual({ url: 'http://localhost:5173/', state: 'starting' })
    // The URL is still visible, as text: a human who wants to try it early can.
    expect(openAppWaitingLabel(open!)).toBe('starting… http://localhost:5173/')
  })

  it('becomes the link once the server has seen the app respond', () => {
    expect(openApp({ devUrl: 'http://localhost:5173/', devReady: true })).toEqual({
      url: 'http://localhost:5173/',
      state: 'ready',
    })
  })

  it('says so when the readiness poll gave up, and still does not link', () => {
    const open = openApp({
      devUrl: 'http://localhost:5173/',
      devReady: false,
      devReadyTimedOut: true,
    })
    expect(open?.state).toBe('timedOut')
    expect(openAppWaitingLabel(open!)).toBe('http://localhost:5173/ — not answering')
  })
})

/**
 * The setup-failure surface (multi-service decisions 4 and 9): a drive that
 * failed to come up is the one moment the human is most stranded, so the panel
 * shows what failed and offers the one click that puts an agent on it.
 */
describe('driveFailure', () => {
  const hookFailure = {
    phase: 'setup' as const,
    command: 'bash .runcastle/drive-setup.sh',
    exitCode: 3,
    timedOut: false,
    output: 'psql: FATAL: role "app" does not exist',
  }

  it('is nothing at all for a drive that came up', () => {
    // Bound to a const so the polled drive's other fields read as the wider
    // object they come from rather than as excess properties on a literal, and
    // spelling `hookFailure` so the all-optional parameter is not a weak type.
    const cameUp = { devReady: true, hookFailure: undefined }
    expect(driveFailure(undefined)).toBeNull()
    expect(driveFailure(null)).toBeNull()
    expect(driveFailure(cameUp)).toBeNull()
  })

  it('surfaces the command, how it ended and its own output', () => {
    expect(driveFailure({ hookFailure })).toEqual({
      command: 'bash .runcastle/drive-setup.sh',
      outcome: 'exited 3',
      output: 'psql: FATAL: role "app" does not exist',
      canFix: true,
    })
  })

  it('says a timeout was a timeout, and a killed command had no code', () => {
    expect(driveFailure({ hookFailure: { ...hookFailure, timedOut: true, exitCode: null } })
      ?.outcome).toBe('timed out')
    expect(driveFailure({ hookFailure: { ...hookFailure, exitCode: null } })?.outcome).toBe(
      'exited without a code',
    )
  })

  // One terminal per feature: the launcher refuses a second one, so offering
  // Fix drive over a live session would be a button that can only be turned down.
  it('withholds Fix drive while a session is already live', () => {
    expect(driveFailure({ hookFailure }, { sessionLive: true })?.canFix).toBe(false)
    expect(driveFailure({ hookFailure }, { sessionLive: false })?.canFix).toBe(true)
  })
})

/**
 * The review agent's report, on the two surfaces that quote it (decisions #7).
 * The failure this covers is a silent one: findings that land as three more rows
 * in a notes list nobody scrolls to, leaving the human reviewing from zero
 * exactly as before. So the report leads the summary card, and it says something
 * when the review could NOT run too.
 */
describe('reviewOutcome', () => {
  const impl = (status: string) => ({ kind: 'implementation' as const, status })

  it('reports none when the batch held no review ticket', () => {
    expect(reviewOutcome({ tickets: [impl('done')], findings: 0 })).toEqual({ state: 'none' })
    expect(reviewOutcome({})).toEqual({ state: 'none' })
  })

  /**
   * Counted from the review's own `review_findings` rows, not from the notes
   * ledger: the review agent no longer writes notes at all, so counting those
   * would report every review as a clean pass.
   */
  it('counts what the review reported, whatever became of it', () => {
    expect(reviewOutcome({ tickets: [{ kind: 'review', status: 'done' }], findings: 2 })).toEqual({
      state: 'ran',
      findings: 2,
    })
  })

  it('reports a clean review as ran with zero findings, not as nothing', () => {
    expect(reviewOutcome({ tickets: [{ kind: 'review', status: 'done' }], findings: 0 })).toEqual({
      state: 'ran',
      findings: 0,
    })
  })

  it('leaves findings unknown while the count is still in flight', () => {
    expect(reviewOutcome({ tickets: [{ kind: 'review', status: 'done' }] })).toEqual({
      state: 'ran',
    })
  })

  it('carries the ticket’s error as the reason a review could not run', () => {
    expect(
      reviewOutcome({
        tickets: [{ kind: 'review', status: 'failed', error: 'the drive slot was held' }],
        findings: 1,
      }),
    ).toEqual({ state: 'failed', reason: 'the drive slot was held' })
  })

  it('reports a failed review with no recorded error, reasonless', () => {
    expect(reviewOutcome({ tickets: [{ kind: 'review', status: 'failed' }] })).toEqual({
      state: 'failed',
    })
  })

  it('reports a review ticket that has not finished as waiting, not as ran', () => {
    expect(reviewOutcome({ tickets: [{ kind: 'review', status: 'running' }], findings: 0 })).toEqual(
      { state: 'waiting', status: 'running' },
    )
  })
})

describe('reviewWalkthroughUrl', () => {
  const recorded = (ticketId: string) => ({
    hasVideo: true,
    videoUrl: `/api/reviews/ticket/${ticketId}/walkthrough.webm`,
  })
  const silent = { hasVideo: false, videoUrl: null }

  it('has nothing to play when no review ran, or when none recorded', () => {
    expect(reviewWalkthroughUrl()).toBeNull()
    expect(reviewWalkthroughUrl([])).toBeNull()
    expect(reviewWalkthroughUrl([silent])).toBeNull()
  })

  it('plays the recording a review left behind', () => {
    expect(reviewWalkthroughUrl([recorded('t1')])).toBe(
      '/api/reviews/ticket/t1/walkthrough.webm',
    )
  })

  it('plays the LATEST review that recorded, not the latest review', () => {
    expect(reviewWalkthroughUrl([recorded('t1'), recorded('t2')])).toBe(
      '/api/reviews/ticket/t2/walkthrough.webm',
    )
    // A later review that recorded nothing must not hide the one that did.
    expect(reviewWalkthroughUrl([recorded('t1'), silent])).toBe(
      '/api/reviews/ticket/t1/walkthrough.webm',
    )
  })
})

/**
 * Ticket 5 / decisions #7 — the fact the review page never knew. A spec written
 * as a thin lap 1 reached review, nothing on screen knew a lap 2 was planned, and
 * the human shipped half a feature by clicking the main button.
 */
describe('deferredScope', () => {
  const spec = ['# Feature', '', '## Approach', '', 'one lap', '', '## Later laps', '', '- the inspector', ''].join('\n')

  it('returns the Later laps section verbatim, trimmed', () => {
    expect(deferredScope(spec)).toBe('- the inspector')
  })

  it('is null when the spec has no Later laps section', () => {
    expect(deferredScope('# Feature\n\n## Approach\n\none lap\n')).toBeNull()
  })

  it('is null for an empty section — a heading over nothing defers nothing', () => {
    expect(deferredScope('## Later laps\n\n   \n\n## Seams\n\nnone\n')).toBeNull()
  })

  it('is null while the spec is still loading, or was never written', () => {
    expect(deferredScope(undefined)).toBeNull()
    expect(deferredScope('')).toBeNull()
  })

  it('keeps the section’s own shape — the card quotes it verbatim', () => {
    expect(deferredScope('## Later laps\n\n- a\n- b\n\n## Out of scope\n\nx\n')).toBe('- a\n- b')
  })
})


describe('mergeConflictKickoff', () => {
  it('names the base, feature branch, and files, and names no phase', () => {
    const line = mergeConflictKickoff('main', 'feature/x', ['a.ts', 'b.ts'])
    expect(line).toContain('git merge main')
    expect(line).toContain('feature/x')
    expect(line).toContain('a.ts, b.ts')
    expect(line).not.toMatch(/complete_phase|phase/)
    expect(line).toContain('Merge & ship')
  })

  it('degrades gracefully when the file list is empty', () => {
    const line = mergeConflictKickoff('main', 'feature/x', [])
    expect(line).toContain('git status')
  })
})

/**
 * Talk worktrees are docs-only and installs are blocked there, so the resolve
 * briefing may not invite a test run: it asks for dependency-free checks and hands
 * the human the test drive instead.
 */
describe('conflict kickoffs verify without dependencies', () => {
  const lines = [mergeConflictKickoff('main', 'feature/x', ['a.ts'])]

  it('no longer asks to run the tests', () => {
    for (const line of lines) expect(line).not.toMatch(/run the tests/i)
  })

  it('lists the dependency-free checks and says installs are blocked', () => {
    for (const line of lines) {
      expect(line).toContain('git diff --check')
      expect(line).toContain('<<<<<<<')
      expect(line).toMatch(/re-read each resolved hunk against both sides/)
      expect(line).toMatch(/import and symbol/)
      expect(line).toMatch(/installs are blocked/)
    }
  })

  it('ends by offering the human a test drive', () => {
    for (const line of lines) expect(line).toMatch(/test-drive the branch[^.]*\.$/)
  })
})

/**
 * Ticket 7 — archive/unarchive derivations. Archived features leave the default
 * sidebar lanes (surfacing only under a show-archived toggle) and expose no
 * pipeline next-step action — only a way back (Unarchive).
 */

/** A feature whose terminal is open, with its agent mid-turn or waiting. */
function withSession(
  awaitingInput: boolean,
  over: Partial<FeatureListItem> = {},
): FeatureListItem {
  return listItem({
    liveSession: { status: 'live', awaitingInput },
    leadAwaitsHuman: awaitingInput,
    // The server reads a lead waiting on the human as an answer it needs.
    need: awaitingInput ? need('answer', 'Needs your answer') : null,
    ...over,
  })
}

describe('archive derivations', () => {
  it('triageOf sorts an archived feature into the archived lane', () => {
    expect(triageOf(listItem({ status: 'archived', workersWorking: 1 }))).toBe('archived')
  })

  it('needsMe is null for archived features', () => {
    expect(needsMe(listItem({ status: 'archived' }))).toBeNull()
  })

  it('excludes archived features from the default lanes', () => {
    const groups = triage([
      listItem({ id: 'a', status: 'active' }),
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
        listItem({ id: 'a', status: 'active' }),
        listItem({ id: 'b', status: 'archived' }),
      ],
      { showArchived: true },
    )
    const archived = groups.find((g) => g.key === 'archived')
    expect(archived?.features.map((f) => f.id)).toEqual(['b'])
    expect(groups.at(-1)?.key).toBe('archived')
  })

  it('nextStep offers only Unarchive for an archived feature (no pipeline action)', () => {
    const ns = nextStep(full({ status: 'archived' }), {})
    expect(ns.primary?.kind).toBe('unarchive')
    expect(ns.secondary).toEqual([])
  })
})

/**
 * draft-features ticket 3 — a parked draft is not in the pipeline (decision 9).
 * Every derivation below reads its STATUS over its phase: drafts are created at
 * `ideation`, which is also the phase that claims the loudest needs-me dot, so a
 * phase-first reading would have the rail begging to grill a feature with no
 * branch behind it.
 */
describe.skip('draft derivations', () => {
  const NOW = 1_000_000_000_000
  const draft = (over: Partial<FeatureListItem> = {}) =>
    listItem({ status: 'draft', ...over })

  it('needsMe is null for a draft, whatever its phase would claim', () => {
    expect(needsMe(draft())).toBeNull()
    expect(needsMe(listItem({}))?.kind).toBe('grill')
  })

  it('chips a draft as "In the backlog" instead of its age', () => {
    const chip = rowChip(draft({ lastActivityAt: NOW - 600_000 }), NOW)
    expect(chip.kind).toBe('draft')
    expect(chip.text).toBe('In the backlog')
  })

  it('sorts drafts below active work and above shipped', () => {
    const sorted = sortForSidebar([
      listItem({ id: 'shipped', status: 'shipped' }),
      draft({ id: 'draft' }),
      listItem({ id: 'active' }),
      listItem({ id: 'needsMe' }),
    ])
    expect(sorted.map((f) => f.id)).toEqual(['needsMe', 'active', 'draft', 'shipped'])
  })

  it('gives drafts their own rail band between In progress and Shipped', () => {
    expect(triageOf(draft())).toBe('drafts')
    const groups = triage([
      listItem({ id: 'shipped', status: 'shipped' }),
      draft({ id: 'draft' }),
      listItem({ id: 'active' }),
    ])
    expect(groups.map((g) => g.key)).toEqual(['inProgress', 'drafts', 'shipped'])
    expect(groups.find((g) => g.key === 'drafts')?.label).toBe('Backlog')
  })

  it('nextStep offers Start as a draft’s one action', () => {
    const ns = nextStep(full({ status: 'draft' }), {})
    expect(ns.primary).toEqual({ label: 'Start', kind: 'startDraft' })
    expect(ns.secondary).toEqual([])
  })

  it('disables Start until the branch list resolves the base it would send', () => {
    const ns = nextStep(full({ status: 'draft' }), {
      draftBaseMissing: 'loading',
    })
    expect(ns.primary?.kind).toBe('startDraft')
    expect(ns.primary?.disabled).toBe('Loading the branch list…')
  })

  // The list arrived and the checkout is not a selectable base (decision 8), so
  // there is nothing left to wait for — the block is a question for the human,
  // and "Loading…" over a loaded list would send them nowhere.
  it('sends the human to the picker when the checkout offers no base at all', () => {
    const ns = nextStep(full({ status: 'draft' }), {
      draftBaseMissing: 'unpicked',
    })
    expect(ns.primary?.disabled).toBe('pick a branch first')
  })
})

/**
 * Chat lives on the shipped bar, so the terminal it resumes has to appear in the
 * shipped body — but only the chat conversation, and only when there is one
 * worth showing: a shipped feature is full of ended pipeline sessions, and a
 * quiet one must stay the plain hero. This is the derivation the body renders
 * through.
 */
describe('shippedChatSessions', () => {
  const sessions = (rows: unknown[]) => rows as FeatureFull['sessions']

  it('shows a live chat session', () => {
    const rows = sessions([{ id: 's1', status: 'live', kind: 'chat', ccSessionId: null }])
    expect(shippedChatSessions(rows)).toEqual(rows)
  })

  it('shows an ended chat session whose conversation is still on disk', () => {
    const rows = sessions([{ id: 's1', status: 'ended', kind: 'chat', ccSessionId: 'cc-1' }])
    expect(shippedChatSessions(rows)).toEqual(rows)
  })

  it('shows nothing for an ended chat session that never reached live (no cc id)', () => {
    const rows = sessions([{ id: 's1', status: 'ended', kind: 'chat', ccSessionId: null }])
    expect(shippedChatSessions(rows)).toEqual([])
  })

  it('shows nothing on a shipped feature that was never talked to', () => {
    // Every pipeline session is ended and resumable by the time a feature ships —
    // those belong to the phase bodies that own them, not to the shipped hero.
    const rows = sessions([
      { id: 's1', status: 'ended', kind: 'drive-fix', ccSessionId: 'cc-1' },
    ])
    expect(shippedChatSessions(rows)).toEqual([])
    expect(shippedChatSessions(sessions([]))).toEqual([])
  })

  it('keeps only the chat rows when the feature also has other sessions', () => {
    const chat = { id: 's2', status: 'live', kind: 'chat', ccSessionId: null }
    const rows = sessions([
      { id: 's1', status: 'ended', kind: 'drive-fix', ccSessionId: 'cc-1' },
      chat,
    ])
    expect(shippedChatSessions(rows)).toEqual([chat])
  })
})

/**
 * REPORT 1.7 — the shipped hero has never shown a merge time. The merge emits
 * `feature.shipped` and THEN `feature.status`, and the hero's reverse scan took
 * the last event of either, so it always landed on the status event.
 */
describe('shippedAt', () => {
  const ev = (id: number, type: string): EventRow =>
    ({ id, projectId: 'p', ts: id * 1000, type, message: type, data: null }) as EventRow

  it('finds the merge time in a log that ends with feature.status', () => {
    expect(
      shippedAt([ev(1, 'merge.started'), ev(2, 'feature.shipped'), ev(3, 'feature.status')]),
    ).toBe(2000)
  })

  it('reports nothing for a feature that has not shipped', () => {
    expect(shippedAt([ev(1, 'burn.started'), ev(2, 'feature.status')])).toBeNull()
    expect(shippedAt([])).toBeNull()
  })

  it('takes the latest shipped event when a feature shipped more than once', () => {
    expect(shippedAt([ev(1, 'feature.shipped'), ev(4, 'feature.shipped')])).toBe(4000)
  })
})

/**
 * improve-features-section ticket 2 — the two-line sidebar row's status chip.
 * The chip slot holds exactly one thing, and `rowChip` is the one place that
 * decides which (ticket 3 re-derives its inputs from live session state).
 */
describe('rowChip', () => {
  const NOW = 1_000_000_000_000

  it('shows Needs you, carrying the need’s words as its title', () => {
    const chip = rowChip(listItem({ need: need('test', 'Ready to test · Checkout') }), NOW)
    expect(chip.kind).toBe('needsMe')
    expect(chip.text).toBe('Needs you')
    expect(chip.title).toBe('Ready to test · Checkout')
    expect(chip.needs).toBe('test')
  })

  it('reads a failed ticket as its age — a failure is not a needs-you reason', () => {
    const counts = { total: 2, pending: 0, burning: 0, done: 1, failed: 1, cancelled: 0 }
    const chip = rowChip(listItem({ ticketCounts: counts, lastActivityAt: NOW - 600_000 }), NOW)
    expect(chip.kind).toBe('age')
  })

  it('shows Working while a run is active, outranking the age stamp', () => {
    const chip = rowChip(listItem({ workersWorking: 1, lastActivityAt: NOW - 600_000 }), NOW)
    expect(chip.kind).toBe('working')
    expect(chip.text).toBe('Working')
  })

  it('shows the shipped check — glyph alone, no text', () => {
    const chip = rowChip(listItem({ status: 'shipped' }), NOW)
    expect(chip.kind).toBe('shipped')
    expect(chip.text).toBe('')
    expect(chip.title).toBe('shipped')
  })

  it('falls back to the relative last-activity stamp', () => {
    expect(rowChip(listItem({ lastActivityAt: NOW - 600_000 }), NOW).text).toBe('10m')
    expect(rowChip(listItem({ lastActivityAt: NOW - 10_800_000 }), NOW).text).toBe('3h')
    expect(rowChip(listItem({ lastActivityAt: NOW - 172_800_000 }), NOW).text).toBe('2d')
    expect(rowChip(listItem({ lastActivityAt: NOW }), NOW).text).toBe('now')
  })

  it('reads an archived feature as its age — archived rows claim no attention', () => {
    const chip = rowChip(listItem({ status: 'archived', lastActivityAt: NOW - 600_000 }), NOW)
    expect(chip.kind).toBe('age')
    expect(chip.text).toBe('10m')
  })

  /**
   * Ticket 4 — the chip reads the same turn state the lanes do: a spinner while
   * the agent works, the needs-you dot once it stops and waits.
   */
  it('spins while the agent is mid-turn in a live session', () => {
    const chip = rowChip(withSession(false), NOW)
    expect(chip.kind).toBe('working')
    expect(chip.text).toBe('Working')
  })

  it('shows Needs you the moment that agent stops and waits', () => {
    const chip = rowChip(withSession(true), NOW)
    expect(chip.kind).toBe('needsMe')
    expect(chip.text).toBe('Needs you')
  })
})

/**
 * improve-features-section ticket 4 — turn-aware feature states (decisions §3).
 *
 * The rail's whole claim is triage, and it was lying: `feature.list` carried no
 * session at all, so `needsMe` fired on the PHASE alone and every active
 * ideation feature showed the grilling dot — including one whose agent was
 * mid-answer. Now a live session outranks the phase in both directions: while
 * its agent works the feature is "Agent working", and when it stops for an
 * answer that IS "Needs you", whatever phase the feature is on.
 */
describe('turn-aware feature states', () => {
  it('keeps a mid-turn chat out of Needs you', () => {
    const f = withSession(false)
    expect(needsMe(f)).toBeNull()
    expect(triageOf(f)).toBe('agentWorking')
  })

  it('moves it to Needs you once the agent stops and waits for an answer', () => {
    const f = withSession(true)
    expect(needsMe(f)?.kind).toBe('answer')
    expect(triageOf(f)).toBe('needsYou')
  })

  it('keeps a feature whose lead replied in Needs you after its process stopped idle', () => {
    const f = listItem({ liveSession: null, leadAwaitsHuman: true, need: need('answer', 'Needs your answer') })
    expect(needsMe(f)).toEqual({ kind: 'answer', label: 'Needs your answer' })
    expect(triageOf(f)).toBe('needsYou')
  })

  it('reads a turn-end bit the main chat’s log does not back (a turn the human stopped) as in progress', () => {
    const f = listItem({ liveSession: { status: 'live', awaitingInput: true }, leadAwaitsHuman: false })
    expect(needsMe(f)).toBeNull()
    expect(triageOf(f)).toBe('inProgress')
  })

  it('reads a terminal that is still launching as working, not waiting', () => {
    const f = listItem({ liveSession: { status: 'launching', awaitingInput: false } })
    expect(needsMe(f)).toBeNull()
    expect(triageOf(f)).toBe('agentWorking')
  })

  it('holds a working session out of Needs you even with a waiting reason left over', () => {
    const f = withSession(false, { waitingReason: 'stopped' })
    expect(needsMe(f)).toBeNull()
    expect(triageOf(f)).toBe('agentWorking')
  })

  it('puts a feature with a need in Needs you with that need’s words, whatever its stored phase', () => {
    const f = listItem({ need: need('test', 'Ready to test · Checkout') })
    expect(needsMe(f)).toEqual({ kind: 'test', label: 'Ready to test · Checkout' })
    expect(triageOf(f)).toBe('needsYou')
    expect(needsMe(listItem({ need: need('stopped', 'Stopped · you stopped it') }))?.label).toBe('Stopped · you stopped it')
  })

  it('files a need its orchestrator holds with the work in motion, not Needs you', () => {
    const f = listItem({ need: need('plan', 'With the orchestrator · Plan to approve', { held: true }) })
    expect(needsMe(f)).toBeNull()
    expect(triageOf(f)).toBe('agentWorking')
  })

  it('leaves a feature with pending tickets and nothing running or asked in progress, whatever its phase', () => {
    const counts = { total: 2, pending: 2, burning: 0, done: 0, failed: 0, cancelled: 0 }
    const f = listItem({ ticketCounts: counts })
    expect(needsMe(f)).toBeNull()
    expect(triageOf(f)).toBe('inProgress')
    expect(needsMe(listItem({}))).toBeNull()
  })

  it('does not ask for attention over a failed ticket — the agent handles it after the round', () => {
    const counts = { total: 2, pending: 0, burning: 0, done: 1, failed: 1, cancelled: 0 }
    const f = listItem({ ticketCounts: counts })
    expect(needsMe(f)).toBeNull()
    expect(triageOf(f)).toBe('inProgress')
  })

  it('leaves drafts, shipped and archived features out of Needs you either way', () => {
    expect(needsMe(listItem({ status: 'draft', need: need('stopped', 'Stopped · you stopped it') }))).toBeNull()
    expect(needsMe(withSession(true, { status: 'shipped', need: need('merge', 'Ready to merge') }))).toBeNull()
    expect(triageOf(withSession(true, { status: 'shipped' }))).toBe('shipped')
    expect(needsMe(withSession(true, { status: 'archived' }))).toBeNull()
    expect(triageOf(withSession(true, { status: 'archived' }))).toBe('archived')
  })

  it('lets an active run outrank the session and a stale waiting reason — the server needs nothing while a round runs', () => {
    const f = withSession(true, { workersWorking: 1, waitingReason: 'stopped', need: null })
    expect(needsMe(f)).toBeNull()
    expect(triageOf(f)).toBe('agentWorking')
  })

  it('sorts a waiting session to the top of the rail and a working one below it', () => {
    const sorted = sortForSidebar([
      listItem({ id: 'quiet' }),
      withSession(false, { id: 'working' }),
      withSession(true, { id: 'waiting' }),
    ])
    expect(sorted[0].id).toBe('waiting')
  })
})

describe('ticketShare and progressState — the progress glyph', () => {
  it('is the share of non-cancelled tickets that are done, 0 with none', () => {
    const counts = { total: 5, pending: 1, burning: 0, done: 3, failed: 0, cancelled: 1 }
    expect(ticketShare(listItem({ ticketCounts: counts }))).toBe(0.75)
    expect(ticketShare(listItem())).toBe(0)
  })

  it('counts landed build workers for a feature built with workers (burns-become-workers review)', () => {
    expect(ticketShare(listItem({ workerProgress: { counted: 4, landed: 3 } }))).toBe(0.75)
    const counts = { total: 2, pending: 0, burning: 0, done: 2, failed: 0, cancelled: 0 }
    expect(ticketShare(listItem({ ticketCounts: counts, workerProgress: { counted: 2, landed: 0 } }))).toBe(0.5)
  })

  it('buildShare reads the same share from tickets and worker rows, leaving out reviews, "+" workers and dropped ones', () => {
    const workers = [
      { kind: 'on-its-own', status: 'landed' },
      { kind: 'with-you', status: 'working' },
      { kind: 'on-its-own', status: 'dropped' },
      { kind: 'review', status: 'handed-back' },
      { kind: null, status: 'needs-you' },
    ]
    expect(buildShare([], workers)).toBe(0.5)
    expect(buildShare([{ status: 'done' }, { status: 'cancelled' }], [])).toBe(1)
    expect(buildShare([], [])).toBe(0)
  })

  it('is a draft ring for a draft, a check once shipped, and the pie otherwise', () => {
    expect(progressState(listItem({ status: 'draft' }))).toBe('draft')
    expect(progressState(listItem({ status: 'shipped' }))).toBe('shipped')
    expect(progressState(listItem({ status: 'active' }))).toBe('active')
    expect(progressState(listItem({ status: 'archived' }))).toBe('active')
  })
})

/**
 * tickets-and-review-are-tools-not-phases decision 9 — the feature glyph's pie:
 * the share of every ticket that landed, review tickets included and cancelled
 * ones not counted.
 */
describe('landedShare', () => {
  it('is done over the non-cancelled tickets, review tickets counted', () => {
    expect(landedShare([{ status: 'done' }, { status: 'pending' }, { status: 'cancelled' }])).toBe(0.5)
    expect(landedShare([{ status: 'done' }, { status: 'failed' }, { status: 'burning' }, { status: 'done' }])).toBe(0.5)
  })

  it('is nothing with no ticket, or only cancelled ones', () => {
    expect(landedShare([])).toBe(0)
    expect(landedShare([{ status: 'cancelled' }])).toBe(0)
  })
})

/**
 * flow-redesign shell ticket 1 / decision 4 — where entering a project puts
 * you. It used to be `list.data[0]`: newest-created and lane-blind, which is how
 * a parked draft or a shipped retrospective became the first screen (F10.4).
 * The rule reads the rail's own triage order instead, so the workspace opens on
 * the row the eye lands on.
 */
describe.skip('landingFeature', () => {
  const working = listItem({ id: 'working', workersWorking: 1 })
  const needsYou = listItem({ id: 'needs' })
  const inProgress = listItem({ id: 'planning' })
  const draft = listItem({ id: 'draft', status: 'draft' })
  const shipped = listItem({ id: 'shipped', status: 'shipped' })
  const archived = listItem({ id: 'archived', status: 'archived' })

  it('prefers the top Needs-you row over everything below it', () => {
    expect(landingFeature([shipped, inProgress, working, needsYou])?.id).toBe('needs')
  })

  it('falls to Agent working when nothing needs you', () => {
    expect(landingFeature([draft, inProgress, working])?.id).toBe('working')
  })

  it('falls to In progress when no agent is working either', () => {
    expect(landingFeature([shipped, draft, inProgress])?.id).toBe('planning')
  })

  it('keeps the incoming order within a lane', () => {
    const first = listItem({ id: 'first' })
    const second = listItem({ id: 'second' })
    expect(landingFeature([first, second])?.id).toBe('first')
  })

  it('lands on the project home rather than a draft, a shipped or an archived feature', () => {
    expect(landingFeature([draft, shipped, archived])).toBeNull()
  })

  it('lands on the project home when the project has no features at all', () => {
    expect(landingFeature([])).toBeNull()
  })
})

