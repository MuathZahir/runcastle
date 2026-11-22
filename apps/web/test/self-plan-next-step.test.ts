import { describe, expect, it } from 'vitest'
import type { FeatureFull } from '../src/lib/api'
import { nextStep } from '../src/lib/feature-ui'
import { full } from './fixtures'

/**
 * features-plan-themselves ticket 2 — the bar around a self-planning run
 * (decisions 5, 10, 11, 12): a working bar with Stop and no chat, and a
 * stopped-short bar whose way on is the chat. A draft has one Start, which
 * launches the lead as its level says, so there is no second way in beside it.
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

describe('one Start on a draft, worded by its level', () => {
  const at = (involvement: FeatureFull['feature']['involvement']): FeatureFull => {
    const base = full({ status: 'draft' })
    return { ...base, feature: { ...base.feature, involvement } } as FeatureFull
  }

  it('offers Start alone, with no second way in', () => {
    const ns = nextStep(full({ status: 'draft' }), {})

    expect(ns.primary).toEqual({ label: 'Start', kind: 'startDraft' })
    expect(ns.secondary).toEqual([])
    expect(ns.desc).not.toContain('Plan automatically')
  })

  it('says the lead asks first at Everything, and plans and builds by itself below it', () => {
    expect(nextStep(at('everything'), {}).desc).toContain('asks you first')
    for (const level of ['designsAndResult', 'resultOnly', 'nothing'] as const) {
      expect(nextStep(at(level), {}).desc).toContain('plans and builds it, stopping only where your level says')
    }
  })

  it('disables Start with its reason while the draft has no base branch', () => {
    const ns = nextStep(full({ status: 'draft' }), { draftBaseMissing: 'unpicked' })

    expect(ns.primary?.disabled).toBe('pick a branch first')
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
  it('says the feature is planning automatically, spins, and offers Stop with no chat', () => {
    const ns = nextStep(started([selfPlan({ status: 'live' })]), {})

    expect(ns.kick).toBe('PLANNING AUTOMATICALLY')
    expect(ns.title).toBe('Planning automatically')
    expect(ns.desc).toContain('open the chat to watch')
    expect(ns.busy).toBe(true)
    expect(ns.primary).toEqual({ label: 'Stop', kind: 'stopSelfPlan' })
    expect([ns.primary, ...ns.secondary].map((a) => a?.kind)).not.toContain('chat')
  })

  it('offers no Stop for any other live chat — only a self-planning run has one', () => {
    for (const purpose of ['lead-wake', 'relay', 'start-lap'] as const) {
      const ns = nextStep(started([session({ id: 'sess_other', status: 'live', purpose })]), {})

      expect(ns.title).not.toBe('Planning automatically')
      expect([ns.primary, ...ns.secondary].map((a) => a?.kind)).not.toContain('stopSelfPlan')
    }
  })
})
