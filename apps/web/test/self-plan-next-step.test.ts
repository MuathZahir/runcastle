import { describe, expect, it } from 'vitest'
import type { FeatureFull } from '../src/lib/api'
import { nextStep, SELF_PLAN_ACTION } from '../src/lib/feature-ui'
import { full } from './fixtures'

/**
 * features-plan-themselves ticket 2 — the bar around a self-planning run
 * (decisions 5, 10, 11, 12): a second way in beside a draft's Start, a working
 * bar with Stop and no chat, and a stopped-short bar whose way on is the chat.
 * With no phase (tickets-and-review-are-tools-not-phases decision 12) every
 * other started feature's step is plain: the status line picks the one primary.
 */

type Session = FeatureFull['sessions'][number]

const session = (over: Partial<Session> = {}): Session =>
  ({
    id: 'sess_1',
    featureId: 'feat_1',
    kind: 'chat',
    status: 'ended',
    awaitingInput: false,
    worktreePath: '/tmp/talk',
    lap: 1,
    createdAt: 0,
    ...over,
  }) as Session

const selfPlan = (over: Partial<Session> = {}): Session =>
  session({ purpose: 'self-plan', ccSessionId: 'cc-1', ...over })

const started = (sessions: Session[] = []): FeatureFull => {
  const base = full({ status: 'active' })
  return { ...base, feature: { ...base.feature, lap: 1 }, sessions } as unknown as FeatureFull
}

describe('Plan it yourself beside Start', () => {
  it('keeps Start as a draft’s primary and puts Plan it yourself beside it', () => {
    const ns = nextStep(full({ status: 'draft' }), {})

    expect(ns.primary).toEqual({ label: 'Start', kind: 'startDraft' })
    expect(ns.secondary).toEqual([{ label: 'Plan it yourself', kind: 'selfPlan' }])
    expect(ns.desc).toContain('Start')
    expect(ns.desc).toContain('Plan it yourself')
  })

  it('disables both with the same reason while the draft has no base branch', () => {
    const ns = nextStep(full({ status: 'draft' }), { draftBaseMissing: 'unpicked' })

    expect(ns.primary?.disabled).toBe('pick a branch first')
    expect(ns.secondary[0]).toEqual({ ...SELF_PLAN_ACTION, disabled: 'pick a branch first' })
  })

  it('disables both with the same reason while the draft waits on a dependency', () => {
    const waiting = {
      ...full({ status: 'draft' }),
      dependsOn: [{ id: 'f2', slug: 'other', title: 'Other', status: 'active', merged: false }],
    } as unknown as FeatureFull
    const ns = nextStep(waiting, {})

    expect(ns.primary?.disabled).toBeTruthy()
    expect(ns.secondary[0]?.disabled).toBe(ns.primary?.disabled)
  })
})

describe('a started feature’s step', () => {
  it('is plain, with no per-phase action: no Go, no burn, no run cancel', () => {
    for (const sessions of [[], [session({ ccSessionId: 'cc-1' })], [selfPlan()]]) {
      const ns = nextStep(started(sessions), {})
      expect(ns.primary).toBeUndefined()
      expect(ns.secondary).toEqual([])
      expect(ns.busy).toBe(false)
    }
  })

  it('keeps the archived feature’s Unarchive', () => {
    expect(nextStep(full({ status: 'archived' }), {}).primary).toEqual({ label: 'Unarchive', kind: 'unarchive' })
  })
})

describe('a self-planning run on the bar', () => {
  it('says the feature is planning itself, spins, and offers Stop with no chat', () => {
    const ns = nextStep(started([selfPlan({ status: 'live' })]), {})

    expect(ns.kick).toBe('PLANNING ITSELF')
    expect(ns.title).toBe('Planning itself')
    expect(ns.desc).toContain('No terminal to watch')
    expect(ns.busy).toBe(true)
    expect(ns.primary).toEqual({ label: 'Stop', kind: 'stopHeadlessRun' })
    expect([ns.primary, ...ns.secondary].map((a) => a?.kind)).not.toContain('chat')
  })
})

/**
 * whole-cuts-plan-themselves ticket 2 — the orchestrator's headless runs read as
 * working with Stop, each in its own words, and as stopped short after one the
 * server said did not finish.
 */
describe('the orchestrator’s headless runs on the bar', () => {
  const relay = (over: Partial<Session> = {}): Session =>
    session({ id: 'sess_relay', purpose: 'relay', headless: true, ccSessionId: 'cc-1', ...over })
  const lapRun = (over: Partial<Session> = {}): Session =>
    session({ id: 'sess_lap', purpose: 'start-lap', headless: true, ccSessionId: 'cc-1', ...over })

  it('says a relay is working on the orchestrator’s change, with Stop only', () => {
    const ns = nextStep(started([relay({ status: 'live' })]), {})

    expect(ns.title).toBe('Working on a change the orchestrator sent back')
    expect(ns.busy).toBe(true)
    expect(ns.primary).toEqual({ label: 'Stop', kind: 'stopHeadlessRun' })
    expect(ns.secondary).toEqual([])
  })

  it('says more work is being planned, with Stop only', () => {
    const ns = nextStep(started([lapRun({ status: 'launching' })]), {})

    expect(ns.title).toBe('Planning more work itself')
    expect(ns.primary).toEqual({ label: 'Stop', kind: 'stopHeadlessRun' })
    expect(ns.secondary).toEqual([])
  })

  it('offers no Stop for a lead woken headless — the status row’s Stop halts the lead', () => {
    const wake = session({ id: 'sess_wake', status: 'live', purpose: 'lead-wake', headless: true })
    const ns = nextStep(started([wake]), {})

    expect(ns.title).not.toBe('Planning itself')
    expect([ns.primary, ...ns.secondary].map((a) => a?.kind)).not.toContain('stopHeadlessRun')
  })

  it('leaves an interactive start-lap chat to the plain step', () => {
    const ns = nextStep(started([lapRun({ status: 'live', headless: false })]), {})

    expect(ns.primary?.kind).not.toBe('stopHeadlessRun')
  })

  it('says a relay stopped short when the server said it did not finish', () => {
    const sessions = [relay()]
    const stopped = nextStep(started(sessions), { unfinishedRuns: ['sess_relay'] })

    expect(stopped.kick).toBe('STOPPED')
    expect(stopped.title).toBe('The orchestrator’s change stopped before it was finished')
    expect(stopped.primary).toEqual({ label: 'Resume session', kind: 'chat' })

    const finished = nextStep(started(sessions), { unfinishedRuns: [] })
    expect(finished.kick).not.toBe('STOPPED')
  })

  it('says planning stopped short, until a newer chat of the lap exists', () => {
    const stopped = nextStep(started([lapRun()]), { unfinishedRuns: ['sess_lap'] })
    expect(stopped.title).toBe('Planning stopped before its tickets were ready')

    const later = nextStep(started([lapRun(), session({ id: 'sess_2', ccSessionId: 'cc-2' })]), {
      unfinishedRuns: ['sess_lap'],
    })
    expect(later.kick).not.toBe('STOPPED')
  })
})
