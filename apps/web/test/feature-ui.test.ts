import { describe, expect, it } from 'vitest'
import { modelRoster } from '@runcastle/core'
import type { EventRow, TicketStatus } from '@runcastle/core'
import {
  activeSession,
  awaitingCheckIn,
  capLane,
  defaultBaseBranch,
  deferredScope,
  DRAFT_GLYPH,
  driveFailure,
  driveWheel,
  duplicateTitleWarning,
  findingCountsLine,
  findingOpenReason,
  groupByLap,
  headline,
  lapAccount,
  kickoffTrouble,
  lapBanner,
  liveSessionBlocker,
  mergeConflictKickoff,
  mergeSummary,
  needsMe,
  nextStep,
  openApp,
  openAppWaitingLabel,
  parseMapSections,
  phaseGlyph,
  reviewChecks,
  reviewOutcome,
  reviewWalkthroughUrl,
  rowChip,
  sessionActive,
  sessionDoneState,
  sessionStatusLabel,
  shippedAt,
  shippedQaSessions,
  sortForSidebar,
  testDriveTaken,
  ticketConflictKickoff,
  ticketDurations,
  ticketModelChip,
  ticketProgress,
  triage,
  triageOf,
  undoableOverride,
  unresolvedMergeConflict,
  waypointGroups,
  type CheckRow,
  type NextAction,
  type TriageGroup,
  type TriageKey,
  type Waypoint,
} from '../src/lib/feature-ui'
import type { FeatureFull, FeatureListItem } from '../src/lib/api'

/**
 * Every cutting form prefills Branch-from with the branch the project is
 * currently checked out on — and prefills NOTHING when that checkout isn't a
 * selectable base (decision 8), which is what makes the select empty and
 * mandatory rather than silently forking off main. Tested at the pure
 * derivation, no DOM.
 */
describe('defaultBaseBranch', () => {
  it('defaults to the current checkout when it is a selectable base', () => {
    expect(defaultBaseBranch({ current: 'develop', branches: ['main', 'develop'] })).toBe('develop')
  })

  it('defaults to main when the current checkout is main', () => {
    expect(defaultBaseBranch({ current: 'main', branches: ['main', 'develop'] })).toBe('main')
  })

  it('offers no default on a detached HEAD (current not in the list)', () => {
    expect(defaultBaseBranch({ current: '', branches: ['main', 'develop'] })).toBe('')
  })

  it('offers no default when a test drive holds a feature/* checkout (excluded)', () => {
    // The picker excludes feature/* branches, so a test-drive checkout is never
    // a selectable base. Main is NOT the answer here — mid-drive the checkout is
    // parked on something unrelated, so the human has to say where to fork from.
    expect(defaultBaseBranch({ current: 'feature/x', branches: ['main'] })).toBe('')
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
 * The build phase with an empty ledger. It used to offer an enabled
 * "Burn 0 tickets" as the primary action, directly above an empty state whose
 * own copy contradicted it (findings F25.1).
 */
describe('nextStep at implementation with no tickets', () => {
  const buildFull = (opts: { sessions?: unknown[]; runs?: unknown[] } = {}) =>
    ({
      feature: { id: 'f1', phase: 'implementation', mapped: false, status: 'active' },
      tickets: [],
      sessions: opts.sessions ?? [],
      runs: opts.runs ?? [],
      gate: { next: { id: 'G4' }, satisfied: false, reason: 'no run' },
    }) as unknown as FeatureFull

  it('never offers a burn when there is nothing to burn', () => {
    const ns = nextStep(buildFull(), { driving: false })
    expect(ns.primary?.kind).not.toBe('burn')
    expect(ns.title).toBe('No tickets to burn')
  })

  it('points at the thing that produces tickets', () => {
    const ns = nextStep(buildFull(), { driving: false })
    expect(ns.primary).toEqual({ label: 'Open a session', kind: 'startGrill' })
    expect(ns.desc).toContain('tickets')
  })

  it('offers to resume the conversation that exists rather than start another', () => {
    const ended = [{ id: 's1', status: 'ended', kind: 'ideation', ccSessionId: 'cc-1' }]
    expect(nextStep(buildFull({ sessions: ended }), { driving: false }).primary).toEqual({
      label: 'Resume the session',
      kind: 'startGrill',
    })
  })

  it('goes status-only while a session is live instead of launching a second one', () => {
    const live = [{ id: 's1', status: 'live', kind: 'revisit', ccSessionId: 'cc-1' }]
    const ns = nextStep(buildFull({ sessions: live }), { driving: false })
    expect(ns.title).toBe('No tickets to burn')
    expect(ns.primary).toBeUndefined()
    expect(ns.secondary).toEqual([])
  })

  it('still offers the burn once there is a ticket to burn', () => {
    const withTicket = {
      ...buildFull(),
      tickets: [{ id: 't1', status: 'pending' }],
    } as unknown as FeatureFull
    expect(nextStep(withTicket, { driving: false }).primary).toEqual({
      label: 'Burn 1 ticket',
      kind: 'burn',
    })
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
    const launching = { id: 's2', status: 'launching', kind: 'ideation' }
    expect(
      activeSession(rows([{ id: 's1', status: 'ended', kind: 'ideation' }, launching])),
    ).toEqual(launching)
    expect(activeSession(rows([{ id: 's1', status: 'ended', kind: 'ideation' }]))).toBeUndefined()
    expect(activeSession(rows([]))).toBeUndefined()
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
 * Next-step-bar affordance audit — the bar never counsels the human to do the
 * agent's job. While a session is live the bar is a status line: no primary, no
 * secondaries, because the session agent promotes the phase itself. The live
 * check therefore wins over the gate check — `decisions.md` exists minutes into
 * a grill, and the old precedence flipped the bar to "Promote the idea"
 * mid-conversation. With no session live, a satisfied gate keeps `advance` as a
 * quiet escape hatch behind the Resume/Start grill primary.
 */
describe('nextStep — live sessions go status-only', () => {
  const auditFull = (opts: {
    phase?: string
    live?: boolean
    /** The status that session carries; both of these are active sessions. */
    sessionStatus?: 'live' | 'launching'
    satisfied?: boolean
    gateId?: string
    tickets?: number
  }): FeatureFull =>
    ({
      feature: { id: 'f1', phase: opts.phase ?? 'ideation', mapped: false, status: 'active' },
      tickets: Array.from({ length: opts.tickets ?? 0 }, (_, i) => ({
        id: `t${i}`,
        status: 'pending',
        commits: [],
      })),
      sessions: opts.live
        ? [{ id: 's1', status: opts.sessionStatus ?? 'live', kind: 'ideation' }]
        : [],
      runs: [],
      gate: {
        next: { id: opts.gateId ?? 'G1' },
        satisfied: opts.satisfied ?? false,
        reason: null,
      },
    }) as unknown as FeatureFull

  const kinds = (ns: ReturnType<typeof nextStep>) =>
    [ns.primary, ...ns.secondary].map((a) => a?.kind)

  it('shows ideation status-only while a grill is live, even once G1 is satisfied', () => {
    const ns = nextStep(auditFull({ live: true, satisfied: true }), { driving: false })
    expect(ns.kick).toBe('GRILL LIVE')
    expect(ns.primary).toBeUndefined()
    expect(ns.secondary).toEqual([])
    expect(kinds(ns)).not.toContain('advance')
  })

  // ui-state-management ticket 3 — the reported lie. The bar used to demand
  // `live`, which only records the agent's hook check-in, so a terminal the
  // human was already typing in still offered to start one.
  it('never offers to start a grill while the terminal is still launching', () => {
    const ns = nextStep(auditFull({ live: true, sessionStatus: 'launching' }), { driving: false })
    expect(ns.kick).toBe('GRILL LIVE')
    expect(ns.primary).toBeUndefined()
    expect(kinds(ns)).not.toContain('startGrill')
  })

  it('demotes the ideation promotion to a secondary once the grill has ended', () => {
    const ns = nextStep(auditFull({ satisfied: true }), { driving: false })
    expect(ns.primary).toEqual({ label: 'Start grill session', kind: 'startGrill' })
    expect(ns.secondary).toEqual([{ label: 'Promote to spec', kind: 'advance' }])
  })

  it('says Resume on the idle satisfied-gate primary when the conversation survives', () => {
    const full = auditFull({ satisfied: true })
    const resumable = {
      ...full,
      sessions: [{ id: 's1', status: 'ended', kind: 'ideation', ccSessionId: 'cc-1' }],
    } as unknown as FeatureFull
    const ns = nextStep(resumable, { driving: false })
    expect(ns.primary).toEqual({ label: 'Resume grill session', kind: 'startGrill' })
    expect(ns.secondary).toEqual([{ label: 'Promote to spec', kind: 'advance' }])
  })

  it('shows spec status-only while a session is live, even once the spec exists', () => {
    const ns = nextStep(auditFull({ phase: 'spec', gateId: 'G2', live: true, satisfied: true }), {
      driving: false,
    })
    expect(ns.kick).toBe('GRILL LIVE')
    expect(ns.title).toBe('Writing the spec')
    expect(ns.primary).toBeUndefined()
    expect(ns.secondary).toEqual([])
  })

  it('demotes the spec approval to a secondary once the session has ended', () => {
    const ns = nextStep(auditFull({ phase: 'spec', gateId: 'G2', satisfied: true }), {
      driving: false,
    })
    expect(ns.primary).toEqual({ label: 'Open grill', kind: 'startGrill' })
    expect(ns.secondary).toEqual([{ label: 'Approve spec → tickets', kind: 'advance' }])
  })

  it('keeps Burn primary at tickets while live — emit_tickets lands one batch', () => {
    const live = nextStep(auditFull({ phase: 'tickets', gateId: 'G3', live: true, tickets: 2 }), {
      driving: false,
    })
    expect(live.primary).toEqual({ label: 'Burn 2 tickets', kind: 'burn' })
    expect(live.secondary).toEqual([])

    const idle = nextStep(auditFull({ phase: 'tickets', gateId: 'G3', tickets: 2 }), {
      driving: false,
    })
    expect(idle.primary).toEqual({ label: 'Burn 2 tickets', kind: 'burn' })
    expect(idle.secondary).toEqual([{ label: 'Revisit', kind: 'revisit' }])
  })

  it('waits status-only for the first tickets while the session is emitting them', () => {
    const ns = nextStep(auditFull({ phase: 'tickets', gateId: 'G3', live: true }), {
      driving: false,
    })
    expect(ns.kick).toBe('WAITING')
    expect(ns.title).toBe('Emitting tickets')
    expect(ns.primary).toBeUndefined()
    expect(ns.secondary).toEqual([])
  })

  it('still offers a grill to emit the first tickets when nothing is live', () => {
    const ns = nextStep(auditFull({ phase: 'tickets', gateId: 'G3' }), { driving: false })
    expect(ns.primary).toEqual({ label: 'Open grill to emit tickets', kind: 'startGrill' })
  })

  it('never offers the scroll-to-terminal action in any live state', () => {
    for (const phase of ['ideation', 'spec', 'tickets']) {
      for (const tickets of [0, 2]) {
        const ns = nextStep(auditFull({ phase, live: true, satisfied: true, tickets }), {
          driving: false,
        })
        expect(kinds(ns)).not.toContain('openGrill')
      }
    }
  })
})

/**
 * Laps ticket 3 (ADR-0010 §3) — the review bar offers three verbs: Fix (the
 * Burn primary a pending ticket promotes), Iterate (starts lap N+1, hidden
 * while a session is live, disabled while the test drive holds the branch) and
 * Merge & ship. Tested at the pure `nextStep` derivation.
 */
describe('nextStep at review', () => {
  const reviewFull = (opts: {
    ticketStatuses?: TicketStatus[]
    sessionLive?: boolean
    lap?: number
    runs?: { id: string; status: string; startedAt: number }[]
  }): FeatureFull => {
    const tickets = (opts.ticketStatuses ?? []).map((status, i) => ({
      id: `t${i}`,
      status,
      commits: [],
    }))
    const sessions = opts.sessionLive ? [{ id: 's1', status: 'live', kind: 'revisit' }] : []
    return {
      feature: { id: 'f1', phase: 'review', mapped: false, lap: opts.lap ?? 1 },
      tickets,
      sessions,
      runs: opts.runs ?? [{ id: 'r1', status: 'succeeded', startedAt: 1 }],
      gate: { next: null, satisfied: false, reason: null },
    } as unknown as FeatureFull
  }
  const labels = (as: { label: string }[]) => as.map((a) => a.label)

  it('offers Iterate and keeps Merge & ship primary when no tickets are pending', () => {
    const ns = nextStep(reviewFull({}), { driving: false })
    expect(ns.primary).toEqual({ label: 'Merge & ship', kind: 'merge' })
    expect(labels(ns.secondary)).toEqual(['Start test drive', 'Iterate'])
    expect(ns.secondary).toContainEqual({ label: 'Iterate', kind: 'rethink' })
  })

  it('promotes Burn to primary and drops Merge & ship to secondary with a pending ticket', () => {
    const ns = nextStep(reviewFull({ ticketStatuses: ['done', 'pending'] }), { driving: false })
    expect(ns.primary).toEqual({ label: 'Burn 1 ticket', kind: 'burn' })
    expect(labels(ns.secondary)).toEqual(['Merge & ship', 'Start test drive', 'Iterate'])
    expect(ns.secondary).toContainEqual({ label: 'Iterate', kind: 'rethink' })
  })

  it('hides Iterate while a session is live (one terminal per feature)', () => {
    const ns = nextStep(reviewFull({ sessionLive: true }), { driving: false })
    expect(labels(ns.secondary)).not.toContain('Iterate')
    // Merge & ship + test drive remain available throughout.
    expect(ns.primary?.label).toBe('Merge & ship')
    expect(labels(ns.secondary)).toEqual(['Start test drive'])
  })

  it('disables Iterate while the test drive holds the branch, with the reason', () => {
    // The lap's talk worktree needs the feature branch the drive has checked out;
    // the server refuses outright (findings F3), so the bar says why here.
    const ns = nextStep(reviewFull({}), { driving: true })
    expect(ns.secondary).toContainEqual({
      label: 'Iterate',
      kind: 'rethink',
      disabled: 'Stop the test drive first — the branch is checked out',
    })
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

  it('never offers a bare revisit — review`s verbs are Fix, Iterate and Merge', () => {
    for (const full of [reviewFull({}), reviewFull({ ticketStatuses: ['pending'] })]) {
      const ns = nextStep(full, { driving: false })
      expect(ns.secondary.map((a) => a.kind)).not.toContain('revisit')
    }
  })

  it('offers the same verbs on a later lap (the bar does not vary by lap)', () => {
    const ns = nextStep(reviewFull({ lap: 3 }), { driving: false })
    expect(labels(ns.secondary)).toEqual(['Start test drive', 'Iterate'])
  })

  /**
   * Ticket 4 / findings F23 — "Checks are in." rendered over a feature with no run
   * recorded, contradicting the summary card two inches below it.
   */
  it('claims the checks are in only when a run was actually recorded', () => {
    expect(nextStep(reviewFull({}), { driving: false }).desc).toContain('Checks are in')

    const noRun = nextStep(reviewFull({ runs: [] }), { driving: false })
    expect(noRun.desc).not.toContain('Checks are in')
    expect(noRun.desc).toContain('No run')
  })

  /**
   * Ticket 4 / findings F8 — the bar highlighted Merge & ship directly above a red
   * MERGE CONFLICT panel telling the user to resolve first; following the bar
   * re-ran a merge that could only fail again.
   */
  describe('with an unresolved merge conflict', () => {
    const conflict = { base: 'main', files: ['a.ts'], at: 1_000 }

    it('makes resolving the conflict the primary action', () => {
      const ns = nextStep(reviewFull({}), { driving: false, conflict })
      expect(ns.primary).toEqual({ label: 'Resolve the merge conflict', kind: 'resolveConflict' })
      expect(ns.title).toBe('Resolve the merge conflict')
      expect(ns.desc).toContain('main')
    })

    /**
     * Ticket 2 / decision 2b — the merge secondary used to be DISABLED, so a
     * conflict resolved outside a session (or by one runcastle could not read)
     * left the pipeline's last step permanently dead. It is a retry now: it
     * ships on success and refreshes this card on failure. Still a secondary —
     * F8 is about never RECOMMENDING a merge that will fail, not about locking
     * the door.
     */
    it('demotes Merge & ship to an enabled retry, never a disabled button', () => {
      const ns = nextStep(reviewFull({}), { driving: false, conflict })
      expect(ns.primary?.kind).toBe('resolveConflict')
      expect(ns.secondary).toContainEqual({ label: 'Retry Merge & ship', kind: 'merge' })
    })

    /**
     * Ticket 2 / decision 3 — the conflict branch used to shadow the pending
     * burn entirely, hiding the one button whose event (`burn.started`) clears
     * the conflict. Burning runs tickets on the feature branch and never
     * touches the base merge.
     */
    it('offers the fix-ticket burn alongside it — a conflict is no reason to hide Burn', () => {
      const ns = nextStep(reviewFull({ ticketStatuses: ['pending', 'pending'] }), {
        driving: false,
        conflict,
      })
      expect(ns.primary?.kind).toBe('resolveConflict')
      expect(labels(ns.secondary)).toEqual([
        'Retry Merge & ship',
        'Burn 2 tickets',
        'Start test drive',
        'Iterate',
      ])
      expect(ns.secondary.every((a) => a.disabled === undefined)).toBe(true)
    })

    it('offers no Burn when nothing is pending', () => {
      const ns = nextStep(reviewFull({}), { driving: false, conflict })
      expect(ns.secondary.map((a) => a.kind)).not.toContain('burn')
    })

    it('keeps the burn reachable while a session is live', () => {
      const ns = nextStep(reviewFull({ ticketStatuses: ['pending'], sessionLive: true }), {
        driving: false,
        conflict,
      })
      expect(labels(ns.secondary)).toEqual([
        'Retry Merge & ship',
        'Burn 1 ticket',
        'Start test drive',
      ])
    })

    /**
     * REPORT 1.6 / E2E F18 — the conflict branch returned before the fix-ticket
     * branch, so Burn vanished exactly when fix tickets existed. The agent that
     * hit the conflict emitted "merge main and resolve it" as a ticket, and with
     * no Burn on screen the only way forward was Iterate.
     */
    it('still offers to burn the fix tickets a conflict-resolution agent emitted', () => {
      const ns = nextStep(reviewFull({ ticketStatuses: ['done', 'pending'] }), {
        driving: false,
        conflict,
      })
      const burn = ns.secondary.find((a) => a.kind === 'burn')
      expect(burn?.label).toBe('Burn 1 ticket')
      // The merge aborted, so the feature branch is intact and the burn can run.
      expect(burn?.disabled).toBeUndefined()
    })

    it('offers no burn when there is nothing pending to burn', () => {
      const ns = nextStep(reviewFull({ ticketStatuses: ['done'] }), { driving: false, conflict })
      expect(ns.secondary.find((a) => a.kind === 'burn')).toBeUndefined()
    })

    it('keeps the test drive and Iterate available (a way out of the state)', () => {
      const ns = nextStep(reviewFull({}), { driving: false, conflict })
      expect(labels(ns.secondary)).toContain('Start test drive')
      expect(labels(ns.secondary)).toContain('Iterate')
    })

    /**
     * Ticket 5 / decisions #10 — the resolve primary used to be DROPPED whenever
     * any session was live (one terminal per feature), so the button read as
     * randomly not existing until the human ended their chat. It never hides
     * now: with a session live it performs the compound and says what that
     * costs.
     */
    it('never drops the resolve affordance — live, it becomes the compound', () => {
      const ns = nextStep(reviewFull({ sessionLive: true }), { driving: false, conflict })
      expect(ns.primary).toEqual({ label: 'End session & resolve', kind: 'resolveConflict' })
      expect(ns.warning).toContain('One terminal per feature')
      expect(ns.warning).toContain('will be closed')
    })

    it('says the plain thing when nothing is live', () => {
      const ns = nextStep(reviewFull({}), { driving: false, conflict })
      expect(ns.primary).toEqual({ label: 'Resolve the merge conflict', kind: 'resolveConflict' })
      expect(ns.warning).toBeUndefined()
    })

    // A caveat about a drive the human has not asked for must not displace the
    // explanation of the button they are about to press.
    it('lets the compound’s explanation outrank the unproven-drive caveat', () => {
      const ns = nextStep(reviewFull({ sessionLive: true }), {
        driving: false,
        conflict,
        unverifiedDriveKeys: ['devCommand'],
      })
      expect(ns.warning).toContain('One terminal per feature')
      expect(ns.warning).not.toContain('dry run')
    })

    it('goes back to the ordinary merge bar once the conflict clears', () => {
      const ns = nextStep(reviewFull({}), { driving: false, conflict: null })
      expect(ns.primary).toEqual({ label: 'Merge & ship', kind: 'merge' })
    })
  })

  /**
   * Ticket 3 / decision 7 — drives are best-effort and happen on every review, so
   * the doubt about an unproven drive key is said inline where the eye already is
   * before the click, and never gates it. A preparation dry run is the one thing
   * that does block, because it is holding the same singleton drive slot.
   */
  describe('with unverified drive keys', () => {
    const start = (ns: ReturnType<typeof nextStep>) =>
      ns.secondary.find((a) => a.kind === 'testDriveStart')

    it('names exactly the unverified keys and points at preparation', () => {
      const ns = nextStep(reviewFull({}), {
        driving: false,
        unverifiedDriveKeys: ['driveSetupCommand', 'driveStopCommand'],
      })
      expect(ns.warning).toContain('Test drive setup')
      expect(ns.warning).toContain('Test drive teardown')
      expect(ns.warning).not.toContain('Dev command')
      expect(ns.warning).toContain('never proven by a dry run')
      expect(ns.warning).toContain('preparation')
    })

    it('never disables the drive — one click still starts it, warning and all', () => {
      const ns = nextStep(reviewFull({}), { driving: false, unverifiedDriveKeys: ['devCommand'] })
      expect(ns.warning).toBeTruthy()
      expect(start(ns)).toEqual({ label: 'Start test drive', kind: 'testDriveStart' })
    })

    it('stays silent when every participating key is stamped, and when none exist', () => {
      expect(nextStep(reviewFull({}), { driving: false, unverifiedDriveKeys: [] }).warning)
        .toBeUndefined()
      expect(nextStep(reviewFull({}), { driving: false }).warning).toBeUndefined()
    })

    it('warns beside the fix-ticket burn and the merge conflict too', () => {
      const ctx = { driving: false, unverifiedDriveKeys: ['devCommand'] }
      const standing = { base: 'main', files: ['a.ts'], at: 1_000 }
      expect(nextStep(reviewFull({ ticketStatuses: ['pending'] }), ctx).warning).toBeTruthy()
      expect(nextStep(reviewFull({}), { ...ctx, conflict: standing }).warning).toBeTruthy()
    })

    // The warning is about the click that starts a drive; mid-drive the offer is
    // Stop, and repeating the doubt there is noise the human cannot act on.
    it('goes quiet once the drive is running', () => {
      const ns = nextStep(reviewFull({}), { driving: true, unverifiedDriveKeys: ['devCommand'] })
      expect(ns.warning).toBeUndefined()
    })

    it('disables the start with the dry-run reason while one is up', () => {
      const ns = nextStep(reviewFull({}), { driving: false, dryRunActive: true })
      expect(start(ns)).toEqual({
        label: 'Start test drive',
        kind: 'testDriveStart',
        disabled: 'A preparation dry-run is in progress — stop it first',
      })
    })

    // A refusal outranks a caveat: the drive cannot start at all, so the reason
    // it cannot is the only thing worth saying.
    it('drops the warning for the refusal when both apply', () => {
      const ns = nextStep(reviewFull({}), {
        driving: false,
        dryRunActive: true,
        unverifiedDriveKeys: ['devCommand'],
      })
      expect(ns.warning).toBeUndefined()
      expect(start(ns)?.disabled).toBe('A preparation dry-run is in progress — stop it first')
    })
  })

  /**
   * Ticket 4 / decisions.md #11 — triage moved out of the notes panel (which was
   * making the human mint tickets one click at a time) into ONE bar action that
   * offers the fork: batch-promote the quick fixes, or start the lap session.
   */
  describe('with open notes to address', () => {
    const ADDRESS: NextAction = { label: 'Address notes', kind: 'addressNotes' }

    it('offers Address notes when open notes stand', () => {
      const ns = nextStep(reviewFull({}), { driving: false, openNotes: 3 })
      expect(labels(ns.secondary)).toEqual(['Start test drive', 'Address notes', 'Iterate'])
      expect(ns.secondary).toContainEqual(ADDRESS)
    })

    it('says nothing when every note is handled', () => {
      for (const openNotes of [0, undefined]) {
        const ns = nextStep(reviewFull({}), { driving: false, openNotes })
        expect(labels(ns.secondary)).not.toContain('Address notes')
      }
    })

    // The two fixes the fork leads to are both still reachable from a bar that is
    // already saying something else — a burn to run, a conflict to resolve.
    it('rides along on the fix-ticket and conflict bars too', () => {
      const burning = nextStep(reviewFull({ ticketStatuses: ['pending'] }), {
        driving: false,
        openNotes: 1,
      })
      expect(burning.primary?.kind).toBe('burn')
      expect(burning.secondary).toContainEqual(ADDRESS)

      const conflicted = nextStep(reviewFull({}), {
        driving: false,
        openNotes: 1,
        conflict: { base: 'main', files: ['a.ts'], at: 1 },
      })
      expect(conflicted.primary?.kind).toBe('resolveConflict')
      expect(conflicted.secondary).toContainEqual(ADDRESS)
    })

    // Promoting notes writes ticket rows; it neither opens a terminal nor wants
    // the branch, so neither a live session nor a drive can take it away. The
    // fork's OTHER road (Iterate) is what those states constrain, in the dialog.
    it('stays offered while a session is live and while the drive holds the branch', () => {
      expect(
        nextStep(reviewFull({ sessionLive: true }), { driving: false, openNotes: 2 }).secondary,
      ).toContainEqual(ADDRESS)
      expect(nextStep(reviewFull({}), { driving: true, openNotes: 2 }).secondary).toContainEqual(
        ADDRESS,
      )
    })
  })

  /**
   * Ticket 5 / decisions #7 — the real failure story: the human finished burning,
   * reached review, and shipped via the main button because nothing on the review
   * page knew a lap 2 was planned. The main button steered wrong, so the main
   * button is what changes — with "lap 1 is enough" still one click away, because
   * that call is the human's.
   */
  describe('with scope the spec deferred to a later lap', () => {
    const laterLaps = '- the conversation inspector'

    it('flips the primary to starting the next lap, demoting Merge & ship', () => {
      const ns = nextStep(reviewFull({}), { driving: false, laterLaps })
      expect(ns.primary).toEqual({ label: 'Start lap 2', kind: 'rethink' })
      expect(ns.secondary).toContainEqual({ label: 'Merge & ship', kind: 'merge' })
      expect(labels(ns.secondary)).toEqual(['Merge & ship', 'Start test drive'])
    })

    it('counts the next lap off the feature’s own lap', () => {
      expect(nextStep(reviewFull({ lap: 3 }), { driving: false, laterLaps }).primary?.label).toBe(
        'Start lap 4',
      )
    })

    it('says what is deferred and that shipping is still the human’s call', () => {
      const ns = nextStep(reviewFull({}), { driving: false, laterLaps })
      expect(ns.title).toContain('lap 2')
      expect(ns.desc).toContain('deferred')
      expect(ns.desc).toContain('ship')
    })

    it('behaves exactly as today when the spec defers nothing', () => {
      for (const later of [null, undefined, '']) {
        const ns = nextStep(reviewFull({}), { driving: false, laterLaps: later })
        expect(ns.primary).toEqual({ label: 'Merge & ship', kind: 'merge' })
        expect(labels(ns.secondary)).toEqual(['Start test drive', 'Iterate'])
      }
    })

    // The lap's session is one launch like any other: it cannot start while the
    // drive holds the branch, and the primary carries that reason rather than
    // vanishing — the same rule Iterate has always followed.
    it('keeps the flip while driving, carrying Iterate’s own reason', () => {
      const ns = nextStep(reviewFull({}), { driving: true, laterLaps })
      expect(ns.primary).toEqual({
        label: 'Start lap 2',
        kind: 'rethink',
        disabled: 'Stop the test drive first — the branch is checked out',
      })
      expect(labels(ns.secondary)).toEqual(['Merge & ship', 'Stop test drive'])
    })

    it('leaves the bar alone while a session is live — there is nothing to launch', () => {
      const ns = nextStep(reviewFull({ sessionLive: true }), { driving: false, laterLaps })
      expect(ns.primary).toEqual({ label: 'Merge & ship', kind: 'merge' })
    })

    it('never outranks fix tickets still waiting to burn', () => {
      const ns = nextStep(reviewFull({ ticketStatuses: ['pending'] }), { driving: false, laterLaps })
      expect(ns.primary).toEqual({ label: 'Burn 1 ticket', kind: 'burn' })
    })

    it('never outranks a standing merge conflict', () => {
      const ns = nextStep(reviewFull({}), {
        driving: false,
        laterLaps,
        conflict: { base: 'main', files: [], at: 1 },
      })
      expect(ns.primary?.kind).toBe('resolveConflict')
    })

    it('keeps the notes triage alongside it', () => {
      const ns = nextStep(reviewFull({}), { driving: false, laterLaps, openNotes: 2 })
      expect(ns.secondary).toContainEqual({ label: 'Address notes', kind: 'addressNotes' })
    })
  })

  /**
   * Review findings are fixed in-run, decisions #7 — the human's decision on
   * arrival at review must be one line read and one click, never "what do I do
   * now". Defects the run could not close (over the auto-fix cap, or a fix
   * ticket that failed) take the primary; Merge & ship stays one click away and
   * is never nagged about.
   */
  describe('with defects the review left open', () => {
    it('makes fixing them the primary and drops Merge & ship to a secondary', () => {
      const ns = nextStep(reviewFull({}), { driving: false, openDefects: 3 })
      expect(ns.primary).toEqual({ label: 'Fix 3 open defects', kind: 'fixDefects' })
      expect(labels(ns.secondary)).toEqual(['Merge & ship', 'Start test drive', 'Iterate'])
      // Information, never a block: the demoted merge carries no warning of its own.
      expect(ns.warning).toBeUndefined()
    })

    it('says one defect in the singular', () => {
      const ns = nextStep(reviewFull({}), { driving: false, openDefects: 1 })
      expect(ns.primary?.label).toBe('Fix 1 open defect')
      expect(ns.desc).toContain('1 defect')
    })

    it('behaves exactly as today with nothing open', () => {
      for (const openDefects of [0, undefined]) {
        const ns = nextStep(reviewFull({}), { driving: false, openDefects })
        expect(ns.primary).toEqual({ label: 'Merge & ship', kind: 'merge' })
      }
    })

    it('outranks the deferred-scope flip — this lap is not done yet', () => {
      const ns = nextStep(reviewFull({}), {
        driving: false,
        openDefects: 2,
        laterLaps: '- the conversation inspector',
      })
      expect(ns.primary?.kind).toBe('fixDefects')
    })

    // The one rule that outranks everything review says (findings F8).
    it('never outranks a standing merge conflict', () => {
      const ns = nextStep(reviewFull({}), {
        driving: false,
        openDefects: 2,
        conflict: { base: 'main', files: ['a.ts'], at: 1 },
      })
      expect(ns.primary?.kind).toBe('resolveConflict')
      expect(ns.secondary.map((a) => a.kind)).not.toContain('fixDefects')
    })

    // A burn already queued must not lose its button to the one that queues more.
    it('keeps Burn reachable when fix tickets are already waiting', () => {
      const ns = nextStep(reviewFull({ ticketStatuses: ['pending'] }), {
        driving: false,
        openDefects: 1,
      })
      expect(ns.primary?.kind).toBe('fixDefects')
      expect(ns.secondary).toContainEqual({ label: 'Burn 1 ticket', kind: 'burn' })
    })

    it('keeps the drive toggle and the notes triage alongside it', () => {
      const ns = nextStep(reviewFull({}), { driving: true, openDefects: 2, openNotes: 1 })
      expect(labels(ns.secondary)).toEqual([
        'Merge & ship',
        'Stop test drive',
        'Address notes',
        'Iterate',
      ])
    })
  })
})

/**
 * Review findings are fixed in-run, decisions #7 and #4 — what the review card
 * says in one line, why a defect is still open, and the headline/detail split
 * that stops every list on the page being a wall of prose.
 */
describe('finding rendering', () => {
  it('reads out found, fixed, open and observations in that order', () => {
    expect(findingCountsLine({ found: 9, fixed: 8, open: 1, observations: 3 })).toBe(
      '9 defects found · 8 fixed automatically · 1 still open · 3 observations',
    )
  })

  it('drops every clause whose count is zero', () => {
    expect(findingCountsLine({ found: 0, fixed: 0, open: 0, observations: 1 })).toBe(
      'no defects found · 1 observation',
    )
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
 * Ticket 4 / decisions.md #6 — lap is the organizing spine of feature history, so
 * the ledger and the notes inbox both group their rows under it.
 */
describe('groupByLap', () => {
  const row = (lap: number, id: string) => ({ lap, id })

  it('groups ascending, keeping each lap`s own row order', () => {
    const rows = [row(2, 'c'), row(1, 'a'), row(2, 'd'), row(1, 'b')]
    expect(groupByLap(rows, 2)).toEqual([
      { lap: 1, rows: [row(1, 'a'), row(1, 'b')], current: false },
      { lap: 2, rows: [row(2, 'c'), row(2, 'd')], current: true },
    ])
  })

  it('has nothing to group when there are no rows', () => {
    expect(groupByLap([], 1)).toEqual([])
  })

  it('marks the single lap of a lap-1 feature current', () => {
    expect(groupByLap([row(1, 'a')], 1)).toEqual([
      { lap: 1, rows: [row(1, 'a')], current: true },
    ])
  })

  /**
   * A lap always starts with nothing in it. Marking only `feature.lap` current
   * would collapse every group on the screen the moment Iterate landed, so the
   * last lap that HAS rows is expanded instead — the panel never reads as empty
   * over rows it is holding.
   */
  it('expands the last lap with rows when the current lap has none yet', () => {
    expect(groupByLap([row(1, 'a')], 2)).toEqual([
      { lap: 1, rows: [row(1, 'a')], current: true },
    ])
  })
})

/**
 * Ticket 4 / decisions.md #6 — from lap 2 on, the workspace says which lap this
 * is, what kicked it off and what the lap before it landed. Lap 1 stays quiet: no
 * iteration ceremony on a feature that merges first try.
 */
describe('lapBanner', () => {
  const ev = (id: number, type: string, message: string): EventRow =>
    ({ id, projectId: 'p', ts: id, type, message }) as EventRow
  const started = (id: number, lap: number) => ev(id, 'lap.started', `rethink — lap ${lap}`)
  const full = (lap: number, ticketLaps: { lap: number; status: TicketStatus }[] = []) =>
    ({
      feature: { id: 'f1', lap },
      tickets: ticketLaps.map((t, i) => ({ id: `t${i}`, ...t })),
    }) as unknown as FeatureFull

  it('says nothing on lap 1', () => {
    expect(lapBanner(full(1), [started(1, 1)])).toBeNull()
  })

  it('names the lap, when it started and what the lap before it landed', () => {
    const banner = lapBanner(
      full(2, [
        { lap: 1, status: 'done' },
        { lap: 1, status: 'done' },
        { lap: 1, status: 'failed' },
        { lap: 2, status: 'pending' },
      ]),
      [ev(1, 'burn.started', 'burning'), started(2, 2)],
    )
    expect(banner).toEqual({ lap: 2, startedAt: 2, landed: 'Lap 1 landed 2 tickets' })
  })

  it('dates the lap from the LATEST lap start', () => {
    expect(lapBanner(full(3), [started(1, 2), started(2, 3)])?.startedAt).toBe(2)
  })

  // A lap whose terminal could not be opened is rolled back to the previous lap
  // and phase (`lap.aborted`), so its start no longer dates where we are.
  it('drops a start a later abort took back', () => {
    const events = [started(1, 2), ev(2, 'lap.aborted', 'lap 3 aborted — back at review')]
    expect(lapBanner(full(2), events)?.startedAt).toBeNull()
  })

  it('has no date to show when the feed does not reach back that far', () => {
    expect(lapBanner(full(2), [])?.startedAt).toBeNull()
  })

  it('says the previous lap landed nothing rather than counting zero', () => {
    expect(lapBanner(full(2, [{ lap: 2, status: 'pending' }]), [])?.landed).toBe(
      'Lap 1 landed no tickets',
    )
    expect(lapBanner(full(2, [{ lap: 1, status: 'done' }]), [])?.landed).toBe(
      'Lap 1 landed 1 ticket',
    )
  })
})

/**
 * Ticket 2 / findings F4 — from lap 2 on, the ideation bar points at the lap's
 * own session and never at a bare promote: lap 1's decisions.md is still on disk,
 * so promoting there skips the whole lap and dead-ends at `tickets` with nothing
 * to burn. (The lap-scoped G1/G2 refuse it server-side; this is the copy.)
 */
describe('nextStep at ideation on a later lap', () => {
  const lapFull = (opts: {
    lap: number
    satisfied?: boolean
    sessions?: unknown[]
  }): FeatureFull =>
    ({
      feature: { id: 'f1', phase: 'ideation', mapped: false, status: 'active', lap: opts.lap },
      tickets: [],
      sessions: opts.sessions ?? [],
      runs: [],
      gate: { next: { id: 'G1' }, satisfied: opts.satisfied ?? true, reason: null },
    }) as unknown as FeatureFull

  it('points at the lap session instead of promoting, even with G1 satisfied', () => {
    const ns = nextStep(lapFull({ lap: 2 }), { driving: false })
    expect(ns.primary).toEqual({ label: 'Start lap 2 session', kind: 'revisit' })
    expect(ns.secondary).toEqual([])
    expect(ns.title).toBe('Work lap 2')
    expect(ns.desc).toContain('Promoting is refused')
  })

  it('says Resume once the lap has a conversation on disk', () => {
    const ns = nextStep(
      lapFull({ lap: 3, sessions: [{ id: 's1', status: 'ended', kind: 'revisit', ccSessionId: 'cc-1' }] }),
      { driving: false },
    )
    expect(ns.primary).toEqual({ label: 'Resume lap 3 session', kind: 'revisit' })
  })

  it('shows the live lap session status-only, as the lap`s work', () => {
    const ns = nextStep(
      lapFull({ lap: 2, sessions: [{ id: 's1', status: 'live', kind: 'revisit' }] }),
      { driving: false },
    )
    expect(ns.title).toBe('Lap 2 in progress')
    expect(ns.primary).toBeUndefined()
    expect(ns.secondary).toEqual([])
  })

  it('leaves lap 1 exactly as it was — a satisfied G1 still offers the promotion', () => {
    const ns = nextStep(lapFull({ lap: 1 }), { driving: false })
    expect(ns.primary?.kind).toBe('startGrill')
    expect(ns.secondary.map((a) => a.kind)).toContain('advance')
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
 * Findings F24 — a gate override advanced the phase with no way back. Undo is
 * offered only while the override is still the feature's latest transition, and
 * that window is derived from the event feed so it survives a reload.
 */
describe('undoableOverride', () => {
  const ev = (id: number, type: string, data?: unknown): EventRow =>
    ({ id, projectId: 'p', ts: id, type, message: type, data }) as EventRow
  const forced = (id: number, gate: string) => ev(id, 'gate.overridden', { gate, reason: 'why' })
  const advanced = (id: number, from: string, to: string) => ev(id, 'phase.advanced', { from, to })

  it('returns null with no overrides in the feed', () => {
    expect(undoableOverride([advanced(1, 'ideation', 'spec')])).toBeNull()
  })

  it('names the gate and both phases of the advance the override forced', () => {
    const events = [forced(1, 'G4'), advanced(2, 'implementation', 'review')]
    expect(undoableOverride(events)).toEqual({
      gate: 'G4',
      from: 'implementation',
      to: 'review',
    })
  })

  it('closes the window once any later phase transition lands', () => {
    const events = [
      forced(1, 'G4'),
      advanced(2, 'implementation', 'review'),
      ev(3, 'feature.shipped', { from: 'review', to: 'shipped' }),
    ]
    expect(undoableOverride(events)).toBeNull()
  })

  it('closes the window once the override is undone', () => {
    const events = [
      forced(1, 'G4'),
      advanced(2, 'implementation', 'review'),
      ev(3, 'gate.override.undone', { from: 'review', to: 'implementation' }),
    ]
    expect(undoableOverride(events)).toBeNull()
  })

  it('offers the latest override when a feature was overridden twice', () => {
    const events = [
      forced(1, 'G2'),
      advanced(2, 'spec', 'tickets'),
      forced(3, 'G3'),
      advanced(4, 'tickets', 'implementation'),
    ]
    expect(undoableOverride(events)).toEqual({ gate: 'G3', from: 'tickets', to: 'implementation' })
  })

  it('ignores a status change — its from/to are statuses, not phases', () => {
    const events = [
      forced(1, 'G4'),
      advanced(2, 'implementation', 'review'),
      ev(3, 'feature.status', { from: 'active', to: 'archived' }),
    ]
    expect(undoableOverride(events)?.gate).toBe('G4')
  })

  it('ignores an override whose advance never happened (last phase, nothing moved)', () => {
    expect(undoableOverride([forced(1, 'G5')])).toBeNull()
  })
})

/**
 * Ticket 4 / findings F21 — a test drive is something that either happened on
 * this feature or did not, and the merge confirmation has to say which.
 */
describe('testDriveTaken', () => {
  const ev = (id: number, type: string): EventRow =>
    ({ id, projectId: 'p', ts: id, type, message: type }) as EventRow

  it('is false for a feature that was never driven', () => {
    expect(testDriveTaken([ev(1, 'burn.started'), ev(2, 'run.finished')])).toBe(false)
  })

  it('is true once a drive has started', () => {
    expect(testDriveTaken([ev(1, 'testdrive.started')])).toBe(true)
  })

  it('stays true after the drive stops — it still happened', () => {
    expect(testDriveTaken([ev(1, 'testdrive.started'), ev(2, 'testdrive.stopped')])).toBe(true)
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
 * Ticket 4 / findings F23 — the review SUMMARY card is the one surface meant to
 * inform the merge decision, and it painted missing data green. These are the
 * colour decisions: nothing absent is ever `ok`, and "cannot tell" is never `0`.
 */
describe('reviewChecks', () => {
  const row = (rows: CheckRow[], key: string) => rows.find((r) => r.key === key)
  const checks = (over: Parameters<typeof reviewChecks>[0] = {}) => reviewChecks(over)

  it('greys 0/0 tickets — nothing was ticketed, so nothing is all-clear', () => {
    const t = row(checks({ tickets: [] }), 'tickets')
    expect(t).toEqual({ key: 'tickets', value: '0/0 done', tone: 'idle' })
  })

  it('ambers 0-done tickets and never greens them', () => {
    const t = row(checks({ tickets: [{ status: 'pending' }, { status: 'pending' }] }), 'tickets')
    expect(t?.value).toBe('0/2 done')
    expect(t?.tone).toBe('warn')
  })

  it('ambers a partly-done set', () => {
    expect(row(checks({ tickets: [{ status: 'done' }, { status: 'pending' }] }), 'tickets')?.tone)
      .toBe('warn')
  })

  it('greens tickets only when every one of them is done', () => {
    const t = row(checks({ tickets: [{ status: 'done' }, { status: 'done' }] }), 'tickets')
    expect(t).toEqual({ key: 'tickets', value: '2/2 done', tone: 'ok' })
  })

  it('reds a set with a failed ticket, naming the count', () => {
    const t = row(checks({ tickets: [{ status: 'done' }, { status: 'failed' }] }), 'tickets')
    expect(t?.tone).toBe('danger')
    expect(t?.value).toBe('1/2 done · 1 failed')
  })

  it('greys a missing run and never greens it', () => {
    expect(row(checks({}), 'run')).toEqual({ key: 'run', value: 'no run recorded', tone: 'idle' })
  })

  it('greens a succeeded run, appending its summary', () => {
    const r = row(checks({ run: { status: 'succeeded', summary: '3 tickets landed' } }), 'run')
    expect(r).toEqual({ key: 'run', value: 'succeeded · 3 tickets landed', tone: 'ok' })
  })

  it('reds a failed run and ambers one that neither failed nor succeeded', () => {
    expect(row(checks({ run: { status: 'failed' } }), 'run')?.tone).toBe('danger')
    expect(row(checks({ run: { status: 'cancelled' } }), 'run')?.tone).toBe('warn')
    expect(row(checks({ run: { status: 'running' } }), 'run')?.tone).toBe('warn')
  })

  it('greens the commit count only when git found commits', () => {
    expect(row(checks({ commitCount: 3 }), 'changes')).toEqual({
      key: 'changes',
      value: '3 commits',
      tone: 'ok',
    })
    expect(row(checks({ commitCount: 1 }), 'changes')?.value).toBe('1 commit')
  })

  it('ambers an empty branch — a review with no commits has nothing to merge', () => {
    expect(row(checks({ commitCount: 0 }), 'changes')).toEqual({
      key: 'changes',
      value: '0 commits',
      tone: 'warn',
    })
  })

  it('greys an unknown commit count rather than reporting it as zero', () => {
    const c = row(checks({}), 'changes')
    expect(c?.tone).toBe('idle')
    expect(c?.value).not.toContain('0')
  })

  it('keeps the card in one order: review agent, tickets, run, changes', () => {
    expect(checks({}).map((r) => r.key)).toEqual(['review agent', 'tickets', 'run', 'changes'])
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

describe('driveWheel', () => {
  const human = driveWheel({ purpose: 'human' })

  it('names the review agent when the drive is its own', () => {
    const wheel = driveWheel({ purpose: 'review' })
    expect(wheel.label).toBe('review agent driving')
    expect(wheel.copy).toContain('review agent')
  })

  it('leaves the human’s wording exactly as it was', () => {
    expect(human.label).toBe('driving now')
    expect(human.copy).toBe(
      'Click through the feature. When it feels right, merge — or stop the drive and send feedback back through tickets.',
    )
  })

  it('reads a drive with no purpose as the human’s — every drive predating the wire was', () => {
    expect(driveWheel({})).toEqual(human)
    expect(driveWheel()).toEqual(human)
    expect(driveWheel(null)).toEqual(human)
  })
})

describe('reviewChecks — the review agent row', () => {
  const row = (over: Parameters<typeof reviewChecks>[0]) =>
    reviewChecks(over).find((r) => r.key === 'review agent')
  const reviewTicket = (over: { status: string; error?: string }) => [{ kind: 'review' as const, ...over }]

  /**
   * Ticket 5 / decisions #9 — the card used to OMIT this row when no review
   * ticket ran, which is how "this lap was never reviewed" stayed invisible
   * (only the merge dialog ever mentioned it). A review is a constant of the
   * pipeline now, so its absence is a state, not a silence.
   */
  it('says outright that no review ran this lap, rather than omitting the row', () => {
    const expected = { key: 'review agent', value: 'no review ran this lap', tone: 'warn' }
    expect(row({ tickets: [{ kind: 'implementation', status: 'done' }] })).toEqual(expected)
    expect(row({ tickets: [] })).toEqual(expected)
    expect(row({})).toEqual(expected)
  })

  it('leads the card with the agent’s report, so it cannot be missed', () => {
    const keys = reviewChecks({ tickets: reviewTicket({ status: 'done' }), findings: 0 }).map(
      (r) => r.key,
    )
    expect(keys).toEqual(['review agent', 'tickets', 'run', 'changes'])
  })

  it('greens a review that found nothing — a clean pass is a positive signal', () => {
    expect(row({ tickets: reviewTicket({ status: 'done' }), findings: 0 })).toEqual({
      key: 'review agent',
      value: 'no findings',
      tone: 'ok',
    })
  })

  it('ambers findings and pluralises them, without calling them a failure', () => {
    expect(row({ tickets: reviewTicket({ status: 'done' }), findings: 1 })).toEqual({
      key: 'review agent',
      value: '1 finding',
      tone: 'warn',
    })
    expect(row({ tickets: reviewTicket({ status: 'done' }), findings: 2 })?.value).toBe(
      '2 findings',
    )
  })

  it('says a review could not run, and why', () => {
    expect(row({ tickets: reviewTicket({ status: 'failed', error: 'app never booted' }) })).toEqual(
      { key: 'review agent', value: 'could not run · app never booted', tone: 'warn' },
    )
  })

  it('still says it could not run when the ticket recorded no reason', () => {
    expect(row({ tickets: reviewTicket({ status: 'failed' }) })?.value).toBe('could not run')
  })

  it('greys an uncounted findings tally rather than reporting a clean pass', () => {
    const r = row({ tickets: reviewTicket({ status: 'done' }) })
    expect(r?.tone).toBe('idle')
    expect(r?.value).not.toContain('no findings')
  })
})

/**
 * Ticket 4 / findings F21 — the most irreversible action in the pipeline had less
 * friction than deleting a throwaway feature. The confirmation summarises what is
 * about to merge and warns, in words, about everything missing from that summary.
 */
describe('mergeSummary', () => {
  const all = { commitCount: 2, run: { status: 'succeeded' as const }, driveTaken: true }

  it('summarises commits, run and test drive, with nothing to warn about', () => {
    const s = mergeSummary(all)
    expect(s.rows.map((r) => r.key)).toEqual(['changes', 'run', 'test drive'])
    expect(s.rows.every((r) => r.tone === 'ok')).toBe(true)
    expect(s.warnings).toEqual([])
  })

  it('warns when the branch carries no commits', () => {
    const s = mergeSummary({ ...all, commitCount: 0 })
    expect(s.warnings.join(' ')).toContain('no commits')
  })

  it('warns when the commit count is unknown, rather than vouching for it', () => {
    const s = mergeSummary({ ...all, commitCount: undefined })
    expect(s.warnings.join(' ')).toContain('unknown')
    expect(s.rows.find((r) => r.key === 'changes')?.tone).toBe('idle')
  })

  it('warns when no run was ever recorded', () => {
    const s = mergeSummary({ ...all, run: undefined })
    expect(s.warnings.join(' ')).toContain('No run')
    expect(s.rows.find((r) => r.key === 'run')?.tone).toBe('idle')
  })

  it('warns when the last run did not succeed', () => {
    expect(mergeSummary({ ...all, run: { status: 'failed' } }).warnings).toHaveLength(1)
  })

  it('warns when the branch was never test-driven, and ambers the row', () => {
    const s = mergeSummary({ ...all, driveTaken: false })
    expect(s.warnings.join(' ')).toContain('never test-driven')
    expect(s.rows.find((r) => r.key === 'test drive')).toEqual({
      key: 'test drive',
      value: 'never test-driven',
      tone: 'warn',
    })
  })

  it('warns about each missing thing at once — the whole picture, not the first fault', () => {
    const s = mergeSummary({ commitCount: 0, run: undefined, driveTaken: false })
    expect(s.warnings).toHaveLength(3)
  })

  // Test-drive notes (decisions #7): shipping over logged-but-unhandled findings
  // is the dangerous moment, and this is exactly where it is caught. It informs;
  // it never blocks, and it never becomes a row — the notes live on the review
  // screen, this dialog only counts them.
  it('warns about open test-drive notes, pluralised', () => {
    expect(mergeSummary({ ...all, openNotes: 3 }).warnings).toEqual([
      '3 open test-drive notes.',
    ])
    expect(mergeSummary({ ...all, openNotes: 1 }).warnings).toEqual(['1 open test-drive note.'])
  })

  it('says nothing when no notes are open, or when notes are unknown', () => {
    expect(mergeSummary({ ...all, openNotes: 0 }).warnings).toEqual([])
    expect(mergeSummary(all).warnings).toEqual([])
  })

  it('keeps open notes out of the rows — they are informational, and never block', () => {
    const s = mergeSummary({ ...all, openNotes: 2 })
    expect(s.rows.map((r) => r.key)).toEqual(['changes', 'run', 'test drive'])
  })

  // The review agent's status line (decisions #7). Unlike the review card this
  // dialog reports an ABSENT review too, because reporting every gap in the
  // picture is the whole job of this summary.
  it('reports the review agent last, after what actually lands', () => {
    const s = mergeSummary({ ...all, review: { state: 'ran', findings: 2 } })
    expect(s.rows.map((r) => r.key)).toEqual(['changes', 'run', 'test drive', 'review agent'])
    expect(s.rows.at(-1)).toEqual({ key: 'review agent', value: '2 findings', tone: 'warn' })
  })

  it('says outright that no review ticket ran, rather than staying quiet', () => {
    const s = mergeSummary({ ...all, review: { state: 'none' } })
    expect(s.rows.at(-1)).toEqual({
      key: 'review agent',
      value: 'no review ticket',
      tone: 'idle',
    })
  })

  it('never warns about an absent review — most branches never asked for one', () => {
    expect(mergeSummary({ ...all, review: { state: 'none' } }).warnings).toEqual([])
  })

  it('warns when the review could not run, naming the reason', () => {
    const s = mergeSummary({ ...all, review: { state: 'failed', reason: 'drive slot held' } })
    expect(s.warnings).toEqual(['The review agent could not run: drive slot held.'])
    expect(s.rows.at(-1)?.tone).toBe('warn')
  })

  it('warns about a reasonless failed review as a bare sentence', () => {
    expect(mergeSummary({ ...all, review: { state: 'failed' } }).warnings).toEqual([
      'The review agent could not run.',
    ])
  })

  it('never warns about findings — the open-notes line already counts them', () => {
    expect(mergeSummary({ ...all, review: { state: 'ran', findings: 4 } }).warnings).toEqual([])
  })

  it('omits the row entirely when the caller knows nothing of any review', () => {
    expect(mergeSummary(all).rows.map((r) => r.key)).toEqual(['changes', 'run', 'test drive'])
  })

  /**
   * Ticket 5 / decisions #7 — the last catch. The bar has already stopped
   * recommending this merge; anyone who reached this dialog is deliberately
   * shipping over scope the spec deferred, and the scope itself is the thing
   * they have to weigh.
   */
  describe('with scope deferred to a later lap', () => {
    it('warns with the deferred scope quoted', () => {
      const s = mergeSummary({ ...all, laterLaps: 'The conversation list gets an inspector.' })
      expect(s.warnings).toEqual([
        'The spec still lists deferred scope: The conversation list gets an inspector.',
      ])
    })

    it('flattens the section’s markdown onto one line', () => {
      const s = mergeSummary({ ...all, laterLaps: '- inspector\n- diff viewer\n' })
      expect(s.warnings).toEqual(['The spec still lists deferred scope: - inspector - diff viewer'])
    })

    it('cuts a long section rather than burying the dialog in it', () => {
      const s = mergeSummary({ ...all, laterLaps: 'x'.repeat(400) })
      expect(s.warnings[0]).toHaveLength('The spec still lists deferred scope: '.length + 181)
      expect(s.warnings[0].endsWith('…')).toBe(true)
    })

    it('says nothing when the spec defers nothing', () => {
      expect(mergeSummary({ ...all, laterLaps: null }).warnings).toEqual([])
      expect(mergeSummary(all).warnings).toEqual([])
    })

    it('rides alongside every other gap, never in place of it', () => {
      const s = mergeSummary({ commitCount: 0, run: undefined, driveTaken: false, laterLaps: 'more' })
      expect(s.warnings).toHaveLength(4)
    })
  })
})

/**
 * Ticket 5 / decisions #8 — the review page leads with what the lap delivered, in
 * prose. The review agent ran last, holds the spec plus every implementation
 * digest and actually saw the result working, so its own digest IS the summary;
 * the burners' accounts are the fallback, and the card labels them as such.
 */
describe('lapAccount', () => {
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
    expect(lapAccount([impl(1, 'built the thing'), review('This lap made laps legible.')])).toEqual({
      source: 'review',
      prose: 'This lap made laps legible.',
    })
  })

  it('reads the LAST review ticket, exactly as the summary row does', () => {
    expect(lapAccount([review('lap 1'), review('lap 2')])).toEqual({
      source: 'review',
      prose: 'lap 2',
    })
  })

  it('falls back to the burners’ own accounts when no review digest exists', () => {
    expect(lapAccount([impl(1, 'ledger grouping'), impl(2, 'lap banner'), review()])).toEqual({
      source: 'tickets',
      entries: [
        { seq: 1, title: 'ticket 1', digest: 'ledger grouping' },
        { seq: 2, title: 'ticket 2', digest: 'lap banner' },
      ],
    })
  })

  it('treats a whitespace-only review digest as no summary at all', () => {
    expect(lapAccount([impl(1, 'did a thing'), review('  \n ')])?.source).toBe('tickets')
  })

  it('drops tickets that wrote no digest — a done ticket without one is still done', () => {
    const account = lapAccount([impl(1), impl(2, 'the only account')])
    expect(account).toEqual({
      source: 'tickets',
      entries: [{ seq: 2, title: 'ticket 2', digest: 'the only account' }],
    })
  })

  it('is null when nobody wrote anything — there is no summary to lead with', () => {
    expect(lapAccount([impl(1), review()])).toBeNull()
    expect(lapAccount([])).toBeNull()
    expect(lapAccount()).toBeNull()
  })

  /**
   * Ticket 11 — the account is of ONE lap. Picking the last review ticket across
   * the whole batch is indistinguishable from correct on lap 1; on lap 2 it puts
   * lap 1's summary under a heading that reads "What landed this lap".
   */
  describe('scoped to the lap under review', () => {
    const on = <T,>(lap: number, t: T) => ({ ...t, lap })

    it('never presents the previous lap’s review as this lap’s account', () => {
      expect(
        lapAccount(
          [on(1, impl(1, 'built lap 1')), on(1, review('Lap 1 made laps legible.')), on(2, impl(2))],
          2,
        ),
      ).toBeNull()
    })

    it('falls back to THIS lap’s burner accounts, never the previous lap’s', () => {
      expect(
        lapAccount(
          [on(1, impl(1, 'built lap 1')), on(1, review('Lap 1 summary.')), on(2, impl(2, 'fixed the ledger'))],
          2,
        ),
      ).toEqual({
        source: 'tickets',
        entries: [{ seq: 2, title: 'ticket 2', digest: 'fixed the ledger' }],
      })
    })

    it('leads with this lap’s own review once it has run', () => {
      expect(
        lapAccount(
          [on(1, review('Lap 1 summary.')), on(2, impl(2, 'fixed the ledger')), on(2, review('Lap 2 summary.', 10))],
          2,
        ),
      ).toEqual({ source: 'review', prose: 'Lap 2 summary.' })
    })

    it('leaves lap 1 exactly as it was', () => {
      expect(lapAccount([on(1, impl(1, 'built the thing')), on(1, review('Lap 1 summary.'))], 1)).toEqual({
        source: 'review',
        prose: 'Lap 1 summary.',
      })
    })
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
 * The session strip's "this terminal was never briefed" banner. A terminal that
 * opened, resumed a conversation and was never told why is exactly the failure
 * the kickoff-confirmation loop exists to catch — so it has to be visible, and
 * it has to clear itself the moment a send succeeds.
 */
describe('kickoffTrouble', () => {
  const ev = (id: number, type: string, sessionId?: string): EventRow =>
    ({ id, projectId: 'p', ts: id, type, message: type, data: { sessionId } }) as EventRow

  it('is quiet for a session whose kickoff was typed and never questioned', () => {
    expect(kickoffTrouble([ev(1, 'session.started', 's1'), ev(2, 'session.kickoff', 's1')], 's1')).toBeNull()
  })

  it('flags a briefing that was never acknowledged', () => {
    const events = [ev(1, 'session.kickoff', 's1'), ev(2, 'session.kickoff_undelivered', 's1')]
    expect(kickoffTrouble(events, 's1')).toBe('undelivered')
  })

  it('flags a terminal that never reported ready', () => {
    expect(kickoffTrouble([ev(1, 'session.not_ready', 's1')], 's1')).toBe('not-ready')
  })

  it('clears once a later kickoff lands (the automatic retry, or a manual send)', () => {
    const events = [
      ev(1, 'session.kickoff_undelivered', 's1'),
      ev(2, 'session.kickoff', 's1'),
    ]
    expect(kickoffTrouble(events, 's1')).toBeNull()
  })

  it('is scoped to one session — another terminal’s trouble is not this one’s', () => {
    const events = [ev(1, 'session.kickoff_undelivered', 's2'), ev(2, 'session.kickoff', 's1')]
    expect(kickoffTrouble(events, 's1')).toBeNull()
    expect(kickoffTrouble(events, 's2')).toBe('undelivered')
  })

  it('does not carry a dead session’s trouble forward', () => {
    const events = [ev(1, 'session.kickoff_undelivered', 's1'), ev(2, 'session.ended', 's1')]
    expect(kickoffTrouble(events, 's1')).toBeNull()
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
    liveSession: over.liveSession ?? null,
    lastActivityAt: over.lastActivityAt ?? 0,
  } as FeatureListItem
}

/** A feature whose terminal is open, with its agent mid-turn or waiting. */
function withSession(
  awaitingInput: boolean,
  over: Partial<FeatureListItem> = {},
): FeatureListItem {
  return listItem({ liveSession: { status: 'live', awaitingInput }, ...over })
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
 * draft-features ticket 3 — a parked draft is not in the pipeline (decision 9).
 * Every derivation below reads its STATUS over its phase: drafts are created at
 * `ideation`, which is also the phase that claims the loudest needs-me dot, so a
 * phase-first reading would have the rail begging to grill a feature with no
 * branch behind it.
 */
describe('draft derivations', () => {
  const NOW = 1_000_000_000_000
  const draft = (over: Partial<FeatureListItem> = {}) =>
    listItem({ status: 'draft', phase: 'ideation', ...over })

  it('needsMe is null for a draft, whatever its phase would claim', () => {
    expect(needsMe(draft())).toBeNull()
    expect(needsMe(listItem({ phase: 'ideation' }))?.kind).toBe('grill')
  })

  it('chips a draft as "Draft" instead of its age', () => {
    const chip = rowChip(draft({ lastActivityAt: NOW - 600_000 }), NOW)
    expect(chip.kind).toBe('draft')
    expect(chip.text).toBe('Draft')
  })

  it('wears the ◌ glyph rather than a phase glyph', () => {
    expect(DRAFT_GLYPH).toBe('◌')
    expect(DRAFT_GLYPH).not.toBe(phaseGlyph('ideation'))
  })

  it('sorts drafts below active work and above shipped', () => {
    const sorted = sortForSidebar([
      listItem({ id: 'shipped', status: 'shipped', phase: 'shipped' }),
      draft({ id: 'draft' }),
      listItem({ id: 'active', phase: 'spec' }),
      listItem({ id: 'needsMe', phase: 'ideation' }),
    ])
    expect(sorted.map((f) => f.id)).toEqual(['needsMe', 'active', 'draft', 'shipped'])
  })

  it('gives drafts their own rail band between In progress and Shipped', () => {
    expect(triageOf(draft())).toBe('drafts')
    const groups = triage([
      listItem({ id: 'shipped', status: 'shipped', phase: 'shipped' }),
      draft({ id: 'draft' }),
      listItem({ id: 'active', phase: 'spec' }),
    ])
    expect(groups.map((g) => g.key)).toEqual(['inProgress', 'drafts', 'shipped'])
    expect(groups.find((g) => g.key === 'drafts')?.label).toBe('Drafts')
  })

  it('nextStep offers Start as a draft’s one action', () => {
    const ns = nextStep(full({ status: 'draft', phase: 'ideation' }), { driving: false })
    expect(ns.primary).toEqual({ label: 'Start', kind: 'startDraft' })
    expect(ns.secondary).toEqual([])
  })

  it('disables Start until the branch list resolves the base it would send', () => {
    const ns = nextStep(full({ status: 'draft', phase: 'ideation' }), {
      driving: false,
      draftBaseMissing: 'loading',
    })
    expect(ns.primary?.kind).toBe('startDraft')
    expect(ns.primary?.disabled).toBe('Loading the branch list…')
  })

  // The list arrived and the checkout is not a selectable base (decision 8), so
  // there is nothing left to wait for — the block is a question for the human,
  // and "Loading…" over a loaded list would send them nowhere.
  it('sends the human to the picker when the checkout offers no base at all', () => {
    const ns = nextStep(full({ status: 'draft', phase: 'ideation' }), {
      driving: false,
      draftBaseMissing: 'unpicked',
    })
    expect(ns.primary?.disabled).toBe('pick a branch first')
  })
})

/**
 * Feature-grouping ticket 2 — the quick-change door (decision 21) lands a
 * feature at `implementation` that has never run, which is the state the build
 * phase's next-step bar had no wording for: it offered "Resume the burn" for a
 * burn that never started. A run that died still resumes.
 */
describe('nextStep at implementation', () => {
  const buildFull = (opts: {
    runs?: { id: string; status: string; startedAt: number }[]
    ticketStatuses?: TicketStatus[]
    sessionLive?: boolean
  }): FeatureFull =>
    ({
      feature: { id: 'f1', phase: 'implementation', mapped: false, lap: 1, status: 'active' },
      tickets: (opts.ticketStatuses ?? ['pending']).map((status, i) => ({
        id: `t${i}`,
        status,
        commits: [],
      })),
      sessions: opts.sessionLive ? [{ id: 's1', status: 'live', kind: 'revisit' }] : [],
      runs: opts.runs ?? [],
      gate: { next: null, satisfied: false, reason: null },
    }) as unknown as FeatureFull

  it('offers a plain first Burn — never "resume" — when no run has ever started', () => {
    const ns = nextStep(buildFull({}), { driving: false })
    expect(ns.title).toBe('Review & burn the ticket')
    expect(ns.primary).toEqual({ label: 'Burn 1 ticket', kind: 'burn' })
    expect(ns.desc).not.toContain('resume')
    expect(ns.busy).toBe(false)
  })

  it('pluralizes the first Burn across several never-run tickets', () => {
    const ns = nextStep(buildFull({ ticketStatuses: ['pending', 'pending'] }), { driving: false })
    expect(ns.title).toBe('Review & burn the tickets')
    expect(ns.primary?.label).toBe('Burn 2 tickets')
  })

  it('still resumes a burn whose run died, naming why', () => {
    const cancelled = nextStep(
      buildFull({ runs: [{ id: 'r1', status: 'cancelled', startedAt: 1 }] }),
      { driving: false },
    )
    expect(cancelled.title).toBe('Resume the burn')
    expect(cancelled.primary).toEqual({ label: 'Resume burn', kind: 'burn' })
    expect(cancelled.desc).toContain('cancelled')

    const failed = nextStep(buildFull({ runs: [{ id: 'r1', status: 'failed', startedAt: 1 }] }), {
      driving: false,
    })
    expect(failed.desc).toContain('failed')
  })

  it('shows the cancel action while a run is live, whatever came before', () => {
    const ns = nextStep(buildFull({ runs: [{ id: 'r1', status: 'running', startedAt: 1 }] }), {
      driving: false,
    })
    expect(ns.primary).toEqual({ label: 'Cancel run', kind: 'cancelRun', danger: true })
    expect(ns.busy).toBe(true)
  })

  it('hides Revisit while a session is live (one terminal per feature)', () => {
    const ns = nextStep(buildFull({ sessionLive: true }), { driving: false })
    expect(ns.secondary).toEqual([])
    expect(nextStep(buildFull({}), { driving: false }).secondary).toEqual([
      { label: 'Revisit', kind: 'revisit' },
    ])
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

/** A waypoint row as the wire sends it, for the two rail derivations below. */
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

/**
 * Improve-map-workflow ticket 6 — the next-step bar owns convergence. For a
 * mapped feature at ideation the bar's primary IS Converge once G1 is satisfied;
 * while waypoints are open it carries the blocking reason and the
 * override-with-reason affordance instead. Remaining fog rides along as a
 * warning that never gates the button, and the scroll-to-terminal action is gone.
 */
describe('nextStep — mapped ideation owns Converge', () => {
  function mappedIdeation(
    opts: { satisfied?: boolean; reason?: string | null; live?: boolean } = {},
  ): FeatureFull {
    const satisfied = opts.satisfied ?? false
    return {
      feature: { id: 'f1', phase: 'ideation', mapped: true, status: 'active' },
      tickets: [],
      sessions: opts.live ? [{ id: 's1', status: 'live', kind: 'waypoint' }] : [],
      runs: [],
      docs: [],
      gate: {
        next: { id: 'G1' },
        satisfied,
        reason: opts.reason === undefined ? '2 waypoints still open' : opts.reason,
      },
      waypoints: [],
      frontierIds: [],
    } as unknown as FeatureFull
  }

  const MAP_WITH_FOG = [
    '## Destination',
    'Ship the rail.',
    '',
    '## Not yet specified',
    'the keyboard shortcut for “work next waypoint”',
  ].join('\n')

  it('makes Converge the primary action once every waypoint is terminal', () => {
    const ns = nextStep(mappedIdeation({ satisfied: true }), { driving: false })
    expect(ns.primary).toEqual({ label: 'Converge', kind: 'converge' })
    expect(ns.secondary).toEqual([])
    expect(ns.title).toBe('Converge the map')
  })

  it('exposes the override affordance and the blocking reason while waypoints are open', () => {
    const ns = nextStep(
      mappedIdeation({ reason: '2 waypoints still open — resolve or drop them' }),
      { driving: false },
    )
    expect(ns.primary).toBeUndefined()
    expect(ns.desc).toBe('2 waypoints still open — resolve or drop them')
    expect(ns.secondary).toEqual([
      {
        label: 'Override & converge…',
        kind: 'convergeOverride',
        reason: {
          placeholder: 'reason to converge past open waypoints',
          submitLabel: 'Converge anyway',
        },
      },
    ])
  })

  it('falls back to a plain instruction when the gate gives no reason', () => {
    const ns = nextStep(mappedIdeation({ reason: null }), { driving: false })
    expect(ns.desc).toBe('Resolve the open waypoints; converge once the frontier clears.')
  })

  it('surfaces the map’s remaining fog without gating Converge', () => {
    const ns = nextStep(mappedIdeation({ satisfied: true }), {
      driving: false,
      mapContent: MAP_WITH_FOG,
    })
    expect(ns.fog).toBe('the keyboard shortcut for “work next waypoint”')
    // Shown, never enforced: the primary is still Converge, and nothing about it
    // changes because fog remains.
    expect(ns.primary).toEqual({ label: 'Converge', kind: 'converge' })
  })

  it('shows the same fog while the gate is still blocking', () => {
    const ns = nextStep(mappedIdeation(), { driving: false, mapContent: MAP_WITH_FOG })
    expect(ns.fog).toBe('the keyboard shortcut for “work next waypoint”')
  })

  it('carries no fog when the map has none, or has not loaded yet', () => {
    const clear = '## Destination\nShip the rail.\n\n## Not yet specified\n\n'
    expect(nextStep(mappedIdeation(), { driving: false, mapContent: clear }).fog).toBeUndefined()
    expect(nextStep(mappedIdeation(), { driving: false }).fog).toBeUndefined()
  })

  it('never offers the scroll-to-terminal action, live session or not', () => {
    for (const satisfied of [true, false]) {
      const ns = nextStep(mappedIdeation({ satisfied, live: true }), { driving: false })
      const kinds = [ns.primary, ...ns.secondary].map((a) => a?.kind)
      expect(kinds).not.toContain('openGrill')
    }
  })
})

/**
 * Improve-map-workflow ticket 3 — the rail's grouping, ordering, lineage and
 * default-expanded state as a pure derivation, because this repo has no DOM
 * test environment and the rail component is kept thin over it.
 */
describe('waypointGroups', () => {
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

/**
 * Improve-map-workflow ticket 5 — the session strip's done state. A waypoint
 * session finds its own waypoint through `lastSessionId` (resolving clears the
 * claim but leaves that pointer), and the strip then says one of three things —
 * or nothing at all, while the work is still live. Pure derivation: this repo
 * has no DOM environment, so the strip is kept thin over it.
 */
describe('sessionDoneState', () => {
  const session = { id: 'sess_1', kind: 'waypoint', status: 'live' }

  function mappedFull(waypoints: Waypoint[], frontierIds: string[]): FeatureFull {
    return {
      feature: { id: 'feat_1', phase: 'ideation', mapped: true, status: 'active' },
      tickets: [],
      sessions: [session],
      runs: [],
      docs: [],
      gate: { next: { id: 'G1' }, satisfied: false, reason: null },
      waypoints,
      frontierIds,
    } as unknown as FeatureFull
  }

  const mine = (over: Partial<Waypoint> = {}) =>
    wp({ id: 'w1', seq: 1, title: 'mine', lastSessionId: session.id, ...over })

  it('is not done while this session’s waypoint is still claimed', () => {
    const ws = [mine({ status: 'claimed', claimedBy: session.id })]
    expect(sessionDoneState(mappedFull(ws, []), session)).toEqual({ kind: 'notDone' })
  })

  it('is not done when no waypoint points at the session (it never went live)', () => {
    // `lastSessionId` is only promoted once the session-start hook fires, so a
    // session that died before going live owns no waypoint at all.
    const ws = [wp({ id: 'w1', seq: 1, title: 'someone else’s', status: 'resolved' })]
    expect(sessionDoneState(mappedFull(ws, []), session)).toEqual({ kind: 'notDone' })
  })

  it('is not done on an unmapped feature, which has no waypoints', () => {
    expect(sessionDoneState(mappedFull([], []), session)).toEqual({ kind: 'notDone' })
  })

  it('offers the lowest-seq frontier waypoint once its own waypoint resolved', () => {
    const ws = [
      mine({ status: 'resolved', summary: 'shipped the rail' }),
      wp({ id: 'w5', seq: 5, title: 'fifth' }),
      wp({ id: 'w2', seq: 2, title: 'second' }),
    ]
    const state = sessionDoneState(mappedFull(ws, ['w5', 'w2']), session)
    expect(state.kind).toBe('workNext')
    if (state.kind !== 'workNext') return
    expect(state.waypoint.summary).toBe('shipped the rail')
    expect(state.next.title).toBe('second')
  })

  it('ignores a lower-seq waypoint that is not on the frontier', () => {
    const ws = [
      mine({ status: 'resolved' }),
      wp({ id: 'w2', seq: 2, title: 'blocked', blockedBy: [3] }),
      wp({ id: 'w3', seq: 3, title: 'open one' }),
    ]
    const state = sessionDoneState(mappedFull(ws, ['w3']), session)
    expect(state.kind === 'workNext' && state.next.title).toBe('open one')
  })

  it('treats a dropped waypoint as done too', () => {
    const ws = [mine({ status: 'dropped' }), wp({ id: 'w2', seq: 2, title: 'second' })]
    expect(sessionDoneState(mappedFull(ws, ['w2']), session).kind).toBe('workNext')
  })

  it('reports the research runs still in flight when the frontier is empty', () => {
    const ws = [
      mine({ status: 'resolved' }),
      wp({ id: 'w2', seq: 2, title: 'researching', status: 'claimed', claimedBy: 'run_1' }),
      wp({ id: 'w3', seq: 3, title: 'also researching', status: 'claimed', claimedBy: 'run_2' }),
      wp({ id: 'w4', seq: 4, title: 'waits on both', blockedBy: [2, 3] }),
    ]
    const state = sessionDoneState(mappedFull(ws, []), session)
    expect(state).toEqual({ kind: 'awaitingResearch', waypoint: ws[0], claimed: 2 })
  })

  it('reports the map complete once every waypoint is terminal', () => {
    const ws = [
      mine({ status: 'resolved' }),
      wp({ id: 'w2', seq: 2, title: 'second', status: 'resolved' }),
      wp({ id: 'w3', seq: 3, title: 'third', status: 'dropped' }),
    ]
    expect(sessionDoneState(mappedFull(ws, []), session)).toEqual({
      kind: 'mapComplete',
      waypoint: ws[0],
    })
  })
})

/**
 * Improve-map-workflow ticket 4 — a refused Work click becomes an inline confirm
 * on the card instead of a toast, and the confirm has to name what it would end.
 * This is the derivation behind that sentence.
 */
describe('liveSessionBlocker', () => {
  const sessions = (rows: unknown[]) => rows as FeatureFull['sessions']

  it('names the still-open waypoint the live session is working', () => {
    const ws = [
      wp({ id: 'w1', seq: 1, title: 'Session handoff', status: 'claimed', claimedBy: 'sess_1' }),
      wp({ id: 'w2', seq: 2, title: 'next up' }),
    ]
    expect(
      liveSessionBlocker(sessions([{ id: 'sess_1', status: 'live', kind: 'waypoint' }]), ws),
    ).toEqual({ sessionId: 'sess_1', kind: 'waypoint', waypointTitle: 'Session handoff' })
  })

  it('finds nothing when no session is live or launching', () => {
    const ws = [wp({ id: 'w1', seq: 1, title: 'only one' })]
    expect(liveSessionBlocker(sessions([{ id: 'sess_1', status: 'ended', kind: 'waypoint' }]), ws))
      .toBeUndefined()
    expect(liveSessionBlocker(sessions([]), ws)).toBeUndefined()
  })

  it('counts a launching session — its terminal is already on the way', () => {
    expect(
      liveSessionBlocker(sessions([{ id: 'sess_2', status: 'launching', kind: 'waypoint' }]), []),
    ).toEqual({ sessionId: 'sess_2', kind: 'waypoint', waypointTitle: undefined })
  })

  it('reports no waypoint for a live session holding none (the ideation grill)', () => {
    const ws = [wp({ id: 'w1', seq: 1, title: 'charted by the grill' })]
    expect(
      liveSessionBlocker(sessions([{ id: 'sess_1', status: 'live', kind: 'ideation' }]), ws),
    ).toEqual({ sessionId: 'sess_1', kind: 'ideation', waypointTitle: undefined })
  })

  it('ignores a resolved waypoint that merely remembers the session', () => {
    // resolveWaypoint clears claimedBy but keeps lastSessionId — that session is
    // finished, and the server ends it without ever asking the human.
    const ws = [
      wp({ id: 'w1', seq: 1, title: 'already answered', status: 'resolved', lastSessionId: 'sess_1' }),
    ]
    expect(
      liveSessionBlocker(sessions([{ id: 'sess_1', status: 'live', kind: 'waypoint' }]), ws)
        ?.waypointTitle,
    ).toBeUndefined()
  })

  it('ignores a waypoint claimed by a parallel research RUN, not by the session', () => {
    const ws = [wp({ id: 'w1', seq: 1, title: 'researching', status: 'claimed', claimedBy: 'run_9' })]
    expect(
      liveSessionBlocker(sessions([{ id: 'sess_1', status: 'live', kind: 'waypoint' }]), ws)
        ?.waypointTitle,
    ).toBeUndefined()
  })
})

/**
 * "Ask a question" lives on the shipped bar, so the terminal it opens has to
 * appear in the shipped body — but only the Q&A conversation, and only when there
 * is one worth showing: a shipped feature is full of ended pipeline sessions, and
 * a quiet one must stay the plain hero. This is the derivation the body renders
 * through.
 */
describe('shippedQaSessions', () => {
  const sessions = (rows: unknown[]) => rows as FeatureFull['sessions']

  it('shows a live qa session', () => {
    const rows = sessions([{ id: 's1', status: 'live', kind: 'qa', ccSessionId: null }])
    expect(shippedQaSessions(rows)).toEqual(rows)
  })

  it('shows an ended qa session whose conversation is still on disk', () => {
    const rows = sessions([{ id: 's1', status: 'ended', kind: 'qa', ccSessionId: 'cc-qa' }])
    expect(shippedQaSessions(rows)).toEqual(rows)
  })

  it('shows nothing for an ended qa session that never reached live (no cc id)', () => {
    const rows = sessions([{ id: 's1', status: 'ended', kind: 'qa', ccSessionId: null }])
    expect(shippedQaSessions(rows)).toEqual([])
  })

  it('shows nothing on a shipped feature that was never asked a question', () => {
    // Every pipeline session is ended and resumable by the time a feature ships —
    // those belong to the phase bodies that own them, not to the shipped hero.
    const rows = sessions([
      { id: 's1', status: 'ended', kind: 'ideation', ccSessionId: 'cc-1' },
      { id: 's2', status: 'ended', kind: 'revisit', ccSessionId: 'cc-2' },
    ])
    expect(shippedQaSessions(rows)).toEqual([])
    expect(shippedQaSessions(sessions([]))).toEqual([])
  })

  it('keeps only the qa rows when the feature also has other sessions', () => {
    const qa = { id: 's2', status: 'live', kind: 'qa', ccSessionId: null }
    const rows = sessions([{ id: 's1', status: 'ended', kind: 'ideation', ccSessionId: 'cc-1' }, qa])
    expect(shippedQaSessions(rows)).toEqual([qa])
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

  it('shows Needs you, carrying the specific reason as its title', () => {
    const chip = rowChip(listItem({ phase: 'ideation' }), NOW)
    expect(chip.kind).toBe('needsMe')
    expect(chip.text).toBe('Needs you')
    expect(chip.title).toBe('needs grilling')
    expect(chip.needs).toBe('grill')
  })

  it('colours a failed run’s chip by its own flavour, not the generic amber', () => {
    const counts = { total: 2, pending: 0, burning: 0, done: 1, failed: 1, cancelled: 0 }
    const chip = rowChip(listItem({ phase: 'implementation', ticketCounts: counts }), NOW)
    expect(chip.kind).toBe('needsMe')
    expect(chip.needs).toBe('attention')
  })

  it('shows Working while a run is active, outranking the age stamp', () => {
    const chip = rowChip(listItem({ activeRun: true, lastActivityAt: NOW - 600_000 }), NOW)
    expect(chip.kind).toBe('working')
    expect(chip.text).toBe('Working')
  })

  it('shows the shipped check — glyph alone, no text', () => {
    const chip = rowChip(listItem({ status: 'shipped', phase: 'shipped' }), NOW)
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
    const chip = rowChip(withSession(false, { phase: 'ideation' }), NOW)
    expect(chip.kind).toBe('working')
    expect(chip.text).toBe('Working')
  })

  it('shows Needs you the moment that agent stops and waits', () => {
    const chip = rowChip(withSession(true, { phase: 'ideation' }), NOW)
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
  it('keeps a mid-turn grill out of Needs you, where the phase alone would put it', () => {
    const f = withSession(false, { phase: 'ideation' })
    expect(needsMe(f)).toBeNull()
    expect(triageOf(f)).toBe('agentWorking')
  })

  it('moves it to Needs you once the agent stops and waits for an answer', () => {
    const f = withSession(true, { phase: 'ideation' })
    expect(needsMe(f)?.kind).toBe('grill')
    expect(triageOf(f)).toBe('needsYou')
  })

  it('reads a terminal that is still launching as working, not waiting', () => {
    const f = listItem({ liveSession: { status: 'launching', awaitingInput: false } })
    expect(needsMe(f)).toBeNull()
    expect(triageOf(f)).toBe('agentWorking')
  })

  // The lane is the honest reading of a session that has stopped talking,
  // whatever phase the feature is on — not just the ones with a phase-derived
  // needs-me of their own.
  it('claims attention for a waiting session at a phase that never asks for it', () => {
    const f = withSession(true, { phase: 'spec' })
    expect(needsMe(f)).not.toBeNull()
    expect(triageOf(f)).toBe('needsYou')
  })

  it('holds a working session out of Needs you at a phase that would ask for it', () => {
    const counts = { total: 2, pending: 2, burning: 0, done: 0, failed: 0, cancelled: 0 }
    const f = withSession(false, { phase: 'tickets', ticketCounts: counts })
    expect(needsMe(f)).toBeNull()
    expect(triageOf(f)).toBe('agentWorking')
  })

  it('leaves a feature with no live session exactly as it was', () => {
    const counts = { total: 2, pending: 2, burning: 0, done: 0, failed: 0, cancelled: 0 }
    expect(needsMe(listItem({ phase: 'ideation' }))?.kind).toBe('grill')
    expect(needsMe(listItem({ phase: 'tickets', ticketCounts: counts }))?.kind).toBe('burn')
    expect(needsMe(listItem({ phase: 'review' }))?.kind).toBe('ship')
    expect(needsMe(listItem({ phase: 'spec' }))).toBeNull()
    expect(triageOf(listItem({ phase: 'ideation' }))).toBe('needsYou')
    expect(triageOf(listItem({ phase: 'spec' }))).toBe('inProgress')
  })

  it('leaves shipped and archived features out of the lanes either way', () => {
    expect(needsMe(withSession(true, { status: 'shipped', phase: 'shipped' }))).toBeNull()
    expect(triageOf(withSession(true, { status: 'shipped', phase: 'shipped' }))).toBe('shipped')
    expect(needsMe(withSession(true, { status: 'archived' }))).toBeNull()
    expect(triageOf(withSession(true, { status: 'archived' }))).toBe('archived')
  })

  it('lets an active run outrank the session — the burn is the louder fact', () => {
    const f = withSession(true, { activeRun: true })
    expect(needsMe(f)).toBeNull()
    expect(triageOf(f)).toBe('agentWorking')
  })

  it('sorts a waiting session to the top of the rail and a working one below it', () => {
    const sorted = sortForSidebar([
      listItem({ id: 'quiet', phase: 'spec' }),
      withSession(false, { id: 'working', phase: 'ideation' }),
      withSession(true, { id: 'waiting', phase: 'spec' }),
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
  it('reads done over total', () => {
    const counts = { total: 5, pending: 2, burning: 0, done: 3, failed: 0, cancelled: 0 }
    expect(ticketProgress(listItem({ ticketCounts: counts }))).toBe('3/5 done')
  })

  it('is null when the feature has no tickets', () => {
    expect(ticketProgress(listItem())).toBeNull()
  })
})

/**
 * improve-features-section ticket 3 — only the Shipped lane is capped
 * (decisions §2). The lanes the rail exists to surface are never hidden; the
 * one that grows without bound collapses to its newest few behind an expander.
 */
describe('capLane', () => {
  const lane = (key: TriageKey, n: number): TriageGroup => ({
    key,
    label: key,
    features: Array.from({ length: n }, (_, i) => listItem({ id: `f${i}` })),
  })
  const ids = (features: FeatureListItem[]) => features.map((f) => f.id)

  it('shows the newest 5 shipped rows when collapsed', () => {
    const capped = capLane(lane('shipped', 8), false)
    expect(ids(capped.visible)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4'])
  })

  it('offers Show all with the lane’s true total while collapsed', () => {
    expect(capLane(lane('shipped', 12), false).expanderLabel).toBe('Show all (12)')
  })

  it('shows every row and offers Show fewer once expanded', () => {
    const capped = capLane(lane('shipped', 8), true)
    expect(capped.visible).toHaveLength(8)
    expect(capped.expanderLabel).toBe('Show fewer')
  })

  it('offers no expander when the shipped lane fits', () => {
    const capped = capLane(lane('shipped', 5), false)
    expect(capped.visible).toHaveLength(5)
    expect(capped.expanderLabel).toBeNull()
  })

  it('never caps the other lanes', () => {
    for (const key of ['needsYou', 'agentWorking', 'inProgress', 'archived'] as TriageKey[]) {
      const capped = capLane(lane(key, 12), false)
      expect(capped.visible).toHaveLength(12)
      expect(capped.expanderLabel).toBeNull()
    }
  })
})

describe('ticketModelChip — what a card says about its burn model', () => {
  const roster = modelRoster({ models: [{ id: 'my-proxy', runtime: 'codex', note: 'bulk edits' }] })

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

/**
 * The next-step bar names whoever the human is actually about to talk to
 * (decision 11). It has one honest source for that — the live session's own
 * runtime — and where there is no session it must say "the agent" rather than
 * print the historical default at a Codex-only human.
 */
describe('nextStep — naming the runtime in the copy', () => {
  const ideation = (sessions: unknown[]) =>
    ({
      feature: { id: 'f1', phase: 'ideation', mapped: false, status: 'active' },
      tickets: [],
      sessions,
      runs: [],
      gate: { next: { id: 'G1' }, satisfied: false, reason: 'no decisions yet' },
    }) as unknown as FeatureFull

  const liveGrill = (runtime: string | null) => [
    { id: 's1', status: 'live', kind: 'ideation', runtime },
  ]

  it('names the runtime the live grill session is running on', () => {
    expect(nextStep(ideation(liveGrill('codex')), { driving: false }).desc).toContain(
      'Shape the idea with Codex',
    )
    expect(nextStep(ideation(liveGrill('claude-code')), { driving: false }).desc).toContain(
      'Shape the idea with Claude',
    )
  })

  // Sessions launched before the column existed carry no runtime; the historical
  // default is the right READ there (the db schema says so), and it is what the
  // human was in fact talking to.
  it('reads a session with no recorded runtime as the historical default', () => {
    expect(nextStep(ideation(liveGrill(null)), { driving: false }).desc).toContain(
      'Shape the idea with Claude',
    )
  })

  it('says "the agent" when no session has resolved a runtime yet', () => {
    const ns = nextStep(ideation([]), { driving: false })
    expect(ns.title).toBe('Shape the idea with the agent')
    expect(ns.title).not.toMatch(/Claude|Codex/)
  })

  // Tickets can each carry their own model (decision 4), so a batch may span
  // both runtimes — there is no single one to name.
  it('does not name a runtime for a ticket batch that may span both', () => {
    const full = {
      feature: { id: 'f1', phase: 'tickets', mapped: false, status: 'active' },
      tickets: [{ id: 't1', seq: 1, status: 'todo' }],
      sessions: [],
      runs: [],
      gate: { next: { id: 'G3' }, satisfied: false, reason: 'not burned' },
    } as unknown as FeatureFull
    const ns = nextStep(full, { driving: false })
    expect(ns.desc).toContain('one atomic task the agent will implement')
    expect(ns.desc).not.toMatch(/Claude|Codex/)
  })
})
