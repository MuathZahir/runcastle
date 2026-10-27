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
    expect(ns.desc).toContain('open the thread to watch')
    expect(ns.busy).toBe(true)
    expect(ns.primary).toEqual({ label: 'Stop', kind: 'stopSelfPlan' })
    expect([ns.primary, ...ns.secondary].map((a) => a?.kind)).not.toContain('chat')
  })

  it('offers no Stop for any other live chat — only a self-planning run has one', () => {
    for (const purpose of ['lead-wake', 'relay', 'start-lap'] as const) {
      const ns = nextStep(started([session({ id: 'sess_other', status: 'live', purpose })]), {})

      expect(ns.title).not.toBe('Planning itself')
      expect([ns.primary, ...ns.secondary].map((a) => a?.kind)).not.toContain('stopSelfPlan')
    }
  })
})
