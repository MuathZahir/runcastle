import { describe, expect, it } from 'vitest'
import { modelRoster } from '@runcastle/core'
import type { EventRow } from '@runcastle/core'
import {
  activeSession,
  awaitingCheckIn,
  burnInterruption,
  defaultBaseBranch,
  deferredScope,
  DRAFT_GLYPH,
  driveFailure,
  duplicateTitleWarning,
  findingCountsLine,
  findingOpenReason,
  headline,
  roundAccount,
  landingFeature,
  lastTestDriveLap,
  mergeConflictKickoff,
  needsMe,
  nextStep,
  openApp,
  openAppWaitingLabel,
  PHASE_ORDER,
  phaseGlyph,
  progressState,
  reviewOutcome,
  reviewWalkthroughUrl,
  rowChip,
  sessionActive,
  sessionNotReady,
  sessionStatusLabel,
  shippedAt,
  shippedChatSessions,
  sortForSidebar,
  startOpensChat,
  testDriveFigure,
  ticketConflictKickoff,
  ticketDurations,
  ticketModelChip,
  landedShare,
  ticketProgress,
  ticketShare,
  triage,
  triageOf,
  unresolvedMergeConflict,
} from '../src/lib/feature-ui'
import type { FeatureFull, FeatureListItem } from '../src/lib/api'
import { runHeadline } from '../src/lib/feature-ui/run'
import { full, listItem } from './fixtures'

describe('run headline review verdict', () => {
  it('does not present an unverified successful review as clean success', () => {
    expect(
      runHeadline(
        [{ seq: 3, status: 'done', kind: 'review', reviewVerdict: 'unverified' }],
        { status: 'succeeded' },
      ),
    ).toBe('Succeeded-unverified · nothing verified')
  })
})

/**
 * Every cutting form prefills Branch-from with the branch the project is
 * currently checked out on, falling back to main when runcastle's own internal
 * branch is the checkout. Tested at the pure derivation, no DOM.
 */
describe('startOpensChat', () => {
  it('chains the grill chat after starting an ordinary draft', () => {
    expect(startOpensChat({ ticketsReadyLap: null })).toBe(true)
  })

  it('opens no session for a parked quick change, born with its tickets ready', () => {
    expect(startOpensChat({ ticketsReadyLap: 1 })).toBe(false)
  })
})

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

describe('burnInterruption', () => {
  const event = {
    type: 'run.reconciled',
    runId: 'r1',
    data: { workflow: 'ticket-burner', landedTickets: 2, pendingTickets: 3 },
  }

  it('keeps the restart alert attached to the reconciled run', () => {
    expect(burnInterruption([event], 'r1')).toEqual({
      runId: 'r1',
      landedTickets: 2,
      pendingTickets: 3,
    })
  })

  it('retires the alert once a resumed burn becomes the latest run', () => {
    expect(burnInterruption([event], 'r2')).toBeUndefined()
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
 * The panel's hint for the other half of the rule: the terminal is up, but the
 * agent inside it has still not said hello. Informational — the session is
 * active throughout.
 */
describe('awaitingCheckIn', () => {
  const session = { id: 'sess_1', status: 'launching' }
  const launched = (ts: number, sessionId = 'sess_1'): EventRow => ({
    id: 1,
    projectId: 'p1',
    ts,
    type: 'session.launching',
    message: 'launching ideation session',
    data: { sessionId },
  })

  it('says nothing while the launch is still young', () => {
    expect(awaitingCheckIn(session, [launched(1_000)], 20_000)).toBe(false)
  })

  it('speaks up once the terminal has been up past the grace period', () => {
    expect(awaitingCheckIn(session, [launched(1_000)], 40_000)).toBe(true)
  })

  it('says nothing about a session that has checked in or ended', () => {
    const events = [launched(1_000)]
    expect(awaitingCheckIn({ id: 'sess_1', status: 'live' }, events, 40_000)).toBe(false)
    expect(awaitingCheckIn({ id: 'sess_1', status: 'ended' }, events, 40_000)).toBe(false)
  })

  it('says nothing when the log cannot date this session', () => {
    expect(awaitingCheckIn(session, [], 40_000)).toBe(false)
    expect(awaitingCheckIn(session, [launched(1_000, 'sess_other')], 40_000)).toBe(false)
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
 * simplify-the-pages decision 8a — "test-driven on lap N (the latest that
 * was)", the one formula the status row and the merge dialog share.
 */
describe('testDriveFigure', () => {
  const ev = (id: number, type: string): EventRow =>
    ({ id, projectId: 'p', ts: id, type, message: type }) as EventRow

  it('says "Not run" for a feature that was never driven', () => {
    expect(testDriveFigure(null, 1)).toEqual({ value: 'Not run', tone: 'idle' })
  })

  it('says it was taken, green when it drove the current build', () => {
    expect(testDriveFigure(2, 2)).toEqual({ value: 'Taken', tone: 'ok' })
  })

  it('reads "Taken · not since" in amber after an undriven later lap', () => {
    const feed = [ev(1, 'testdrive.started'), ev(2, 'lap.started')]
    expect(testDriveFigure(lastTestDriveLap(feed), 2)).toEqual({ value: 'Taken', sub: 'not since', tone: 'warn' })
  })

  /**
   * Ticket 11 / decision 33a — the shipped record states the drive that WAS
   * taken, and a drive filed under the wrong lap is not a record.
   */
  describe('lastTestDriveLap', () => {
    it('is null for a feature that was never driven', () => {
      expect(lastTestDriveLap([ev(1, 'burn.started')])).toBeNull()
    })

    it('is lap 1 for a feature that never iterated', () => {
      expect(lastTestDriveLap([ev(1, 'testdrive.started')])).toBe(1)
    })

    it('counts the laps that started before the drive, not the ones after', () => {
      const feed = [ev(1, 'lap.started'), ev(2, 'testdrive.started'), ev(3, 'lap.started')]
      expect(lastTestDriveLap(feed)).toBe(2)
    })

    it('reports the LAST drive when a feature was driven in several laps', () => {
      const feed = [
        ev(1, 'testdrive.started'),
        ev(2, 'lap.started'),
        ev(3, 'testdrive.started'),
      ]
      expect(lastTestDriveLap(feed)).toBe(2)
    })
  })
})

/**
 * A lane's duration is the burner's own measurement of one execution, not the
 * spread of everything the run happened to say about the ticket — and never a
 * log file's span, which covers every attempt at once.
 */
describe('ticketDurations', () => {
  const ev = (id: number, ts: number, type: string, ticketId?: string, data?: unknown): EventRow =>
    ({ id, projectId: 'p', ts, type, message: type, ticketId, data }) as EventRow

  it('takes the wall clock the timing event carries, not the event spread', () => {
    // The ticket was created at the top of the run and burned much later: the
    // spread is 2 hours, the execution was 5m 35s.
    const events = [
      ev(1, 0, 'ticket.created', 'tk_1'),
      ev(2, 7_200_000, 'ticket.timing', 'tk_1', { wallMs: 335_000, calls: 0, byCategory: {} }),
    ]
    expect(ticketDurations(events).get('tk_1')).toBe(335_000)
  })

  it('takes the last timing event when a ticket was burned twice in one run', () => {
    const events = [
      ev(1, 0, 'ticket.timing', 'tk_1', { wallMs: 60_000 }),
      ev(2, 600_000, 'ticket.timing', 'tk_1', { wallMs: 90_000 }),
    ]
    expect(ticketDurations(events).get('tk_1')).toBe(90_000)
  })

  it('falls back to the event spread while a lane is still burning', () => {
    const events = [ev(1, 1_000, 'ticket.started', 'tk_1'), ev(2, 4_000, 'agent.text', 'tk_1')]
    expect(ticketDurations(events).get('tk_1')).toBe(3_000)
  })

  it('ignores a timing event carrying no usable wall clock', () => {
    const events = [
      ev(1, 1_000, 'ticket.started', 'tk_1'),
      ev(2, 4_000, 'ticket.timing', 'tk_1', { calls: 3 }),
    ]
    expect(ticketDurations(events).get('tk_1')).toBe(3_000)
  })

  it('reports a zero-length execution the timing event measured', () => {
    // A review refused before its agent started: 0s is the truth, and a lane
    // that reports nothing is a lane that falls back to guessing.
    const events = [
      ev(1, 0, 'ticket.created', 'tk_1'),
      ev(2, 7_200_000, 'ticket.timing', 'tk_1', { wallMs: 0 }),
    ]
    expect(ticketDurations(events).get('tk_1')).toBe(0)
  })

  it('skips events with no ticket of their own', () => {
    expect(ticketDurations([ev(1, 0, 'run.started'), ev(2, 5_000, 'run.finished')]).size).toBe(0)
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
 * Ticket 5 / decisions #8 — the review page leads with what the lap delivered, in
 * prose. The review agent ran last, holds the spec plus every implementation
 * digest and actually saw the result working, so its own digest IS the summary;
 * the burners' accounts are the fallback, and the card labels them as such.
 */
describe('roundAccount', () => {
  const impl = (seq: number, digest?: string) => ({
    seq,
    title: `ticket ${seq}`,
    kind: 'implementation' as const,
    ...(digest === undefined ? {} : { digest }),
  })
  const review = (digest?: string, seq = 9) => ({
    seq,
    title: 'review',
    kind: 'review' as const,
    ...(digest === undefined ? {} : { digest }),
  })

  it('leads with the review agent’s own prose when it wrote one', () => {
    expect(roundAccount([impl(1, 'built the thing'), review('This lap made laps legible.')])).toEqual({
      source: 'review',
      prose: 'This lap made laps legible.',
    })
  })

  it('reads the LAST review ticket, exactly as the summary row does', () => {
    expect(roundAccount([review('lap 1'), review('lap 2')])).toEqual({
      source: 'review',
      prose: 'lap 2',
    })
  })

  it('falls back to the burners’ own accounts when no review digest exists', () => {
    expect(roundAccount([impl(1, 'ledger grouping'), impl(2, 'lap banner'), review()])).toEqual({
      source: 'tickets',
      entries: [
        { seq: 1, title: 'ticket 1', digest: 'ledger grouping' },
        { seq: 2, title: 'ticket 2', digest: 'lap banner' },
      ],
    })
  })

  it('treats a whitespace-only review digest as no summary at all', () => {
    expect(roundAccount([impl(1, 'did a thing'), review('  \n ')])?.source).toBe('tickets')
  })

  it('drops tickets that wrote no digest — a done ticket without one is still done', () => {
    const account = roundAccount([impl(1), impl(2, 'the only account')])
    expect(account).toEqual({
      source: 'tickets',
      entries: [{ seq: 2, title: 'ticket 2', digest: 'the only account' }],
    })
  })

  it('is null when nobody wrote anything — there is no summary to lead with', () => {
    expect(roundAccount([impl(1), review()])).toBeNull()
    expect(roundAccount([])).toBeNull()
    expect(roundAccount()).toBeNull()
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

/**
 * The session strip's "this terminal has not started" banner. A terminal that
 * opened and then sat behind a trust prompt looks exactly like a healthy one
 * doing nothing — so it has to be visible, and it must not outlive the session.
 */
describe('sessionNotReady', () => {
  const ev = (id: number, type: string, sessionId?: string): EventRow =>
    ({ id, projectId: 'p', ts: id, type, message: type, data: { sessionId } }) as EventRow

  it('is quiet for a session that launched and reported ready', () => {
    expect(sessionNotReady([ev(1, 'session.started', 's1'), ev(2, 'session.kickoff', 's1')], 's1')).toBe(false)
  })

  it('flags a terminal that never reported ready', () => {
    expect(sessionNotReady([ev(1, 'session.not_ready', 's1')], 's1')).toBe(true)
  })

  it('is scoped to one session — another terminal’s trouble is not this one’s', () => {
    const events = [ev(1, 'session.not_ready', 's2'), ev(2, 'session.kickoff', 's1')]
    expect(sessionNotReady(events, 's1')).toBe(false)
    expect(sessionNotReady(events, 's2')).toBe(true)
  })

  it('does not carry a dead session’s trouble forward', () => {
    const events = [ev(1, 'session.not_ready', 's1'), ev(2, 'session.ended', 's1')]
    expect(sessionNotReady(events, 's1')).toBe(false)
  })

  // REGRESSION (lap-2 drive): a start hook that timed out left the banner over a
  // chat that was plainly working; its first turn checks it in late.
  it('clears once the agent checks in late', () => {
    const events = [ev(1, 'session.not_ready', 's1'), ev(2, 'session.started', 's1')]
    expect(sessionNotReady(events, 's1')).toBe(false)
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
 * The run lane's "Resolve in terminal" — the human escape hatch after the
 * burner's automatic resolver gave up on a ticket's landing conflict. Unlike
 * the review card's kickoff this merges the TICKET branch into the feature
 * branch (the landing that failed), and it carries the ticket's identity so the
 * agent resolves by intent rather than by guessing from the diff.
 */
describe('ticketConflictKickoff', () => {
  const input = {
    seq: 3,
    title: 'Stage founder studio drafts',
    branch: 'runcastle/ticket/improve-user-sto/3-lWsg1vxs',
    featureBranch: 'feature/improve-user-story',
    files: ['a/staging.service.ts', 'b/staging.spec.ts'],
  }

  it('names the ticket, both branches, and the conflicting files', () => {
    const line = ticketConflictKickoff(input)
    expect(line).toContain('#3')
    expect(line).toContain('Stage founder studio drafts')
    expect(line).toContain('git merge runcastle/ticket/improve-user-sto/3-lWsg1vxs')
    expect(line).toContain('feature/improve-user-story')
    expect(line).toContain('a/staging.service.ts, b/staging.spec.ts')
  })

  it('forbids advancing the phase and points back at the lane action', () => {
    const line = ticketConflictKickoff(input)
    expect(line).toContain('complete_phase')
    expect(line).toContain('Retry')
  })

  it('degrades gracefully when git reported no file list', () => {
    expect(ticketConflictKickoff({ ...input, files: [] })).toContain('git status')
  })
})

/**
 * Talk worktrees are docs-only and installs are blocked there, so neither resolve
 * briefing may invite a test run: they ask for dependency-free checks and hand the
 * human the test drive instead.
 */
describe('conflict kickoffs verify without dependencies', () => {
  const lines = [
    mergeConflictKickoff('main', 'feature/x', ['a.ts']),
    ticketConflictKickoff({
      seq: 3,
      title: 't',
      branch: 'runcastle/ticket/x/3-abc',
      featureBranch: 'feature/x',
      files: ['a.ts'],
    }),
  ]

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
  return listItem({ liveSession: { status: 'live', awaitingInput }, ...over })
}

describe('archive derivations', () => {
  it('triageOf sorts an archived feature into the archived lane', () => {
    expect(triageOf(listItem({ status: 'archived', activeRun: true }))).toBe('archived')
  })

  it('needsMe is null for archived features', () => {
    expect(needsMe(listItem({ status: 'archived', phase: 'planning' }))).toBeNull()
  })

  it('excludes archived features from the default lanes', () => {
    const groups = triage([
      listItem({ id: 'a', status: 'active', phase: 'planning' }),
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
        listItem({ id: 'a', status: 'active', phase: 'planning' }),
        listItem({ id: 'b', status: 'archived' }),
      ],
      { showArchived: true },
    )
    const archived = groups.find((g) => g.key === 'archived')
    expect(archived?.features.map((f) => f.id)).toEqual(['b'])
    expect(groups.at(-1)?.key).toBe('archived')
  })

  it('nextStep offers only Unarchive for an archived feature (no pipeline action)', () => {
    const ns = nextStep(full({ status: 'archived', phase: 'review' }), {})
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
    listItem({ status: 'draft', phase: 'planning', ...over })

  it('needsMe is null for a draft, whatever its phase would claim', () => {
    expect(needsMe(draft())).toBeNull()
    expect(needsMe(listItem({ phase: 'planning' }))?.kind).toBe('grill')
  })

  it('chips a draft as "In the backlog" instead of its age', () => {
    const chip = rowChip(draft({ lastActivityAt: NOW - 600_000 }), NOW)
    expect(chip.kind).toBe('draft')
    expect(chip.text).toBe('In the backlog')
  })

  it('wears the ◌ glyph rather than a phase glyph', () => {
    expect(DRAFT_GLYPH).toBe('◌')
    expect(DRAFT_GLYPH).not.toBe(phaseGlyph('planning'))
  })

  it('sorts drafts below active work and above shipped', () => {
    const sorted = sortForSidebar([
      listItem({ id: 'shipped', status: 'shipped', phase: 'shipped' }),
      draft({ id: 'draft' }),
      listItem({ id: 'active', phase: 'planning' }),
      listItem({ id: 'needsMe', phase: 'planning' }),
    ])
    expect(sorted.map((f) => f.id)).toEqual(['needsMe', 'active', 'draft', 'shipped'])
  })

  it('gives drafts their own rail band between In progress and Shipped', () => {
    expect(triageOf(draft())).toBe('drafts')
    const groups = triage([
      listItem({ id: 'shipped', status: 'shipped', phase: 'shipped' }),
      draft({ id: 'draft' }),
      listItem({ id: 'active', phase: 'planning' }),
    ])
    expect(groups.map((g) => g.key)).toEqual(['inProgress', 'drafts', 'shipped'])
    expect(groups.find((g) => g.key === 'drafts')?.label).toBe('Backlog')
  })

  it('nextStep offers Start as a draft’s one action', () => {
    const ns = nextStep(full({ status: 'draft', phase: 'planning' }), {})
    expect(ns.primary).toEqual({ label: 'Start', kind: 'startDraft' })
    expect(ns.secondary).toEqual([])
  })

  it('disables Start until the branch list resolves the base it would send', () => {
    const ns = nextStep(full({ status: 'draft', phase: 'planning' }), {
      draftBaseMissing: 'loading',
    })
    expect(ns.primary?.kind).toBe('startDraft')
    expect(ns.primary?.disabled).toBe('Loading the branch list…')
  })

  // The list arrived and the checkout is not a selectable base (decision 8), so
  // there is nothing left to wait for — the block is a question for the human,
  // and "Loading…" over a loaded list would send them nowhere.
  it('sends the human to the picker when the checkout offers no base at all', () => {
    const ns = nextStep(full({ status: 'draft', phase: 'planning' }), {
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

  it('shows Needs you, carrying the waiting reason as its title', () => {
    const chip = rowChip(listItem({ waitingReason: 'ready to test' }), NOW)
    expect(chip.kind).toBe('needsMe')
    expect(chip.text).toBe('Needs you')
    expect(chip.title).toBe('ready to test')
    expect(chip.needs).toBe('waiting')
  })

  it('reads a failed ticket as its age — a failure is not a needs-you reason', () => {
    const counts = { total: 2, pending: 0, burning: 0, done: 1, failed: 1, cancelled: 0 }
    const chip = rowChip(listItem({ ticketCounts: counts, lastActivityAt: NOW - 600_000 }), NOW)
    expect(chip.kind).toBe('age')
  })

  it('shows Working while a run is active, outranking the age stamp', () => {
    const chip = rowChip(listItem({ activeRun: true, lastActivityAt: NOW - 600_000 }), NOW)
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
    expect(needsMe(f)?.kind).toBe('input')
    expect(triageOf(f)).toBe('needsYou')
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

  it('puts a feature with a waiting reason in Needs you with that reason, whatever its stored phase', () => {
    const f = listItem({ phase: 'building', waitingReason: 'ready to test' })
    expect(needsMe(f)).toEqual({ kind: 'waiting', label: 'ready to test' })
    expect(triageOf(f)).toBe('needsYou')
    expect(needsMe(listItem({ phase: 'planning', waitingReason: 'stopped' }))?.label).toBe('stopped')
  })

  it('leaves a feature with pending tickets and nothing running or asked in progress, whatever its phase', () => {
    const counts = { total: 2, pending: 2, burning: 0, done: 0, failed: 0, cancelled: 0 }
    const f = listItem({ phase: 'planning', ticketCounts: counts })
    expect(needsMe(f)).toBeNull()
    expect(triageOf(f)).toBe('inProgress')
    expect(needsMe(listItem({ phase: 'review' }))).toBeNull()
  })

  it('does not ask for attention over a failed ticket — the agent handles it after the round', () => {
    const counts = { total: 2, pending: 0, burning: 0, done: 1, failed: 1, cancelled: 0 }
    const f = listItem({ ticketCounts: counts })
    expect(needsMe(f)).toBeNull()
    expect(triageOf(f)).toBe('inProgress')
  })

  it('leaves drafts, shipped and archived features out of Needs you either way', () => {
    expect(needsMe(listItem({ status: 'draft', waitingReason: 'stopped' }))).toBeNull()
    expect(needsMe(withSession(true, { status: 'shipped', waitingReason: 'ready to test' }))).toBeNull()
    expect(triageOf(withSession(true, { status: 'shipped' }))).toBe('shipped')
    expect(needsMe(withSession(true, { status: 'archived' }))).toBeNull()
    expect(triageOf(withSession(true, { status: 'archived' }))).toBe('archived')
  })

  it('lets an active run outrank the session and the waiting reason — the round is the louder fact', () => {
    const f = withSession(true, { activeRun: true, waitingReason: 'stopped' })
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

/**
 * improve-features-section ticket 2 — line 2's ticket progress. Omitted
 * entirely when the feature has no tickets: '0/0 done' is a figure about
 * nothing, and the rail has one line's width to spend.
 */
describe('ticketProgress', () => {
  it('reads every ticket done over every ticket not cancelled', () => {
    const counts = { total: 9, pending: 2, burning: 0, done: 5, failed: 1, cancelled: 1 }
    expect(ticketProgress(listItem({ ticketCounts: counts }))).toBe('5/8')
  })

  it('is null when the feature has no tickets, or only cancelled ones', () => {
    expect(ticketProgress(listItem())).toBeNull()
    const cancelled = { total: 2, pending: 0, burning: 0, done: 0, failed: 0, cancelled: 2 }
    expect(ticketProgress(listItem({ ticketCounts: cancelled }))).toBeNull()
  })
})

describe('ticketShare and progressState — the progress glyph', () => {
  it('is the share of non-cancelled tickets that are done, 0 with none', () => {
    const counts = { total: 5, pending: 1, burning: 0, done: 3, failed: 0, cancelled: 1 }
    expect(ticketShare(listItem({ ticketCounts: counts }))).toBe(0.75)
    expect(ticketShare(listItem())).toBe(0)
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
  const working = listItem({ id: 'working', activeRun: true })
  const needsYou = listItem({ id: 'needs', phase: 'planning' })
  const inProgress = listItem({ id: 'planning', phase: 'planning' })
  const draft = listItem({ id: 'draft', status: 'draft' })
  const shipped = listItem({ id: 'shipped', status: 'shipped', phase: 'shipped' })
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
    const first = listItem({ id: 'first', phase: 'planning' })
    const second = listItem({ id: 'second', phase: 'planning' })
    expect(landingFeature([first, second])?.id).toBe('first')
  })

  it('lands on the project home rather than a draft, a shipped or an archived feature', () => {
    expect(landingFeature([draft, shipped, archived])).toBeNull()
  })

  it('lands on the project home when the project has no features at all', () => {
    expect(landingFeature([])).toBeNull()
  })
})

describe('ticketModelChip — what a card says about its burn model', () => {
  const roster = modelRoster({ discovered: [], models: [{ id: 'my-proxy', runtime: 'codex', note: 'bulk edits' }] })

  it('says nothing for an unassigned ticket', () => {
    expect(ticketModelChip({ model: undefined }, roster)).toBeNull()
    expect(ticketModelChip({ model: '' }, roster)).toBeNull()
  })

  it('names the assigned model with the runtime it launches', () => {
    expect(ticketModelChip({ model: 'gpt-5.6-sol' }, roster)).toEqual({
      id: 'gpt-5.6-sol',
      runtime: 'codex',
      runtimeLabel: 'Codex',
    })
    expect(ticketModelChip({ model: 'claude-opus-5' }, roster)?.runtimeLabel).toBe('Claude Code')
  })

  it('reads the runtime an operator declared for their own entry', () => {
    // Never inferred from the id string (decisions.md #3) — "my-proxy" says
    // nothing about its provider; the roster entry does.
    expect(ticketModelChip({ model: 'my-proxy' }, roster)?.runtime).toBe('codex')
  })

  it('falls back to the default runtime for an id no longer on the roster', () => {
    expect(ticketModelChip({ model: 'retired-model' }, roster)).toEqual({
      id: 'retired-model',
      runtime: 'claude-code',
      runtimeLabel: 'Claude Code',
    })
  })
})

