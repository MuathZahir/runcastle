import { describe, expect, it } from 'vitest'
import type { FeatureFull } from '../src/lib/api'
import { CHAT_ACTION, nextStep, SELF_PLAN_ACTION, type NextAction } from '../src/lib/feature-ui'
import { full } from './fixtures'

/**
 * features-plan-themselves ticket 2 — the bar around a self-planning run
 * (decisions 5, 10, 11, 12): a second way in beside the grill, a working bar
 * with Stop and no chat, the ordinary bar once it finishes, and a stopped-short
 * bar whose way on is the chat.
 */

type Session = FeatureFull['sessions'][number]

const MERGE_ACTION: NextAction = { label: 'Merge & ship', kind: 'merge' }

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

const planning = (
  opts: {
    sessions?: Session[]
    docs?: string[]
    tickets?: unknown[]
    ticketsReadyLap?: number | null
    lap?: number
  } = {},
): FeatureFull => {
  const base = full({ phase: 'planning' })
  return {
    ...base,
    feature: { ...base.feature, lap: opts.lap ?? 1, ticketsReadyLap: opts.ticketsReadyLap ?? null },
    sessions: opts.sessions ?? [],
    docs: (opts.docs ?? []).map((relPath) => ({ relPath })),
    tickets: opts.tickets ?? [],
  } as unknown as FeatureFull
}

const pendingTicket = {
  id: 't1',
  seq: 1,
  status: 'pending',
  lap: 1,
  kind: 'implementation',
  goal: 'Put the shape warnings on the burn card.',
  context:
    'The bar lives in apps/web/src/lib/feature-ui/next-step and the ledger beneath it in ' +
    'components/bodies/tickets. Follow the resolver that is already there rather than adding a ' +
    'second one, and pin the copy in apps/web/test/feature-ui.test.ts as the neighbouring cases ' +
    'do. The warnings themselves belong to core, beside the rules, so the card and the door that ' +
    'stores the tickets cannot word the same problem two ways.',
}

describe('Plan it yourself beside the grill', () => {
  it('keeps Start as a draft’s primary and puts Plan it yourself beside it', () => {
    const ns = nextStep(full({ status: 'draft', phase: 'planning' }), { driving: false })

    expect(ns.primary).toEqual({ label: 'Start', kind: 'startDraft' })
    expect(ns.secondary).toEqual([{ label: 'Plan it yourself', kind: 'selfPlan' }])
    expect(ns.desc).toContain('Start')
    expect(ns.desc).toContain('Plan it yourself')
  })

  it('disables both with the same reason while the draft has no base branch', () => {
    const ns = nextStep(full({ status: 'draft', phase: 'planning' }), {
      driving: false,
      draftBaseMissing: 'unpicked',
    })

    expect(ns.primary?.disabled).toBe('pick a branch first')
    expect(ns.secondary[0]).toEqual({ ...SELF_PLAN_ACTION, disabled: 'pick a branch first' })
  })

  it('disables both with the same reason while the draft waits on a dependency', () => {
    const waiting = {
      ...full({ status: 'draft', phase: 'planning' }),
      dependsOn: [{ id: 'f2', slug: 'other', title: 'Other', status: 'active', merged: false }],
    } as unknown as FeatureFull
    const ns = nextStep(waiting, { driving: false })

    expect(ns.primary?.disabled).toBeTruthy()
    expect(ns.secondary[0]?.disabled).toBe(ns.primary?.disabled)
  })

  it('offers it beside Start session on a started feature with nothing planned', () => {
    const ns = nextStep(planning(), { driving: false })

    expect(ns.primary).toEqual({ label: 'Start session', kind: 'chat' })
    expect(ns.secondary).toEqual([SELF_PLAN_ACTION, MERGE_ACTION])
  })

  it('does not offer it once there is a conversation to resume', () => {
    const ns = nextStep(planning({ sessions: [session({ ccSessionId: 'cc-1' })] }), { driving: false })

    expect(ns.primary).toEqual({ label: 'Resume session', kind: 'chat' })
    expect(ns.secondary).not.toContainEqual(SELF_PLAN_ACTION)
  })
})

describe('a self-planning run on the bar', () => {
  it('says the feature is planning itself, spins, and offers Stop with no chat', () => {
    const ns = nextStep(planning({ sessions: [selfPlan({ status: 'live' })] }), { driving: false })

    expect(ns.kick).toBe('PLANNING ITSELF')
    expect(ns.title).toBe('Planning itself')
    expect(ns.desc).toContain('No terminal to watch')
    expect(ns.busy).toBe(true)
    expect(ns.primary).toEqual({ label: 'Stop', kind: 'stopHeadlessRun' })
    expect([ns.primary, ...ns.secondary].map((a) => a?.kind)).not.toContain('chat')
  })

  it('keeps saying so while the run is finishing its tickets', () => {
    const ns = nextStep(
      planning({
        sessions: [selfPlan({ status: 'live' })],
        docs: ['decisions.md', 'spec.md'],
        tickets: [pendingTicket],
      }),
      { driving: false },
    )

    expect(ns.title).toBe('Planning itself')
  })

  it('is the ordinary ready-to-burn bar once the run completed the tickets', () => {
    const ns = nextStep(
      planning({
        sessions: [selfPlan()],
        docs: ['decisions.md', 'spec.md'],
        tickets: [pendingTicket],
        ticketsReadyLap: 1,
      }),
      { driving: false },
    )

    expect(ns.title).toBe('Review the tickets, then burn')
    expect(ns.primary?.kind).toBe('burn')
  })

  it('says planning stopped short, with the chat as the way on', () => {
    const ns = nextStep(planning({ sessions: [selfPlan()], docs: ['decisions.md'] }), { driving: false })

    expect(ns.kick).toBe('STOPPED')
    expect(ns.title).toBe('Planning stopped before the plan was complete')
    expect(ns.desc).toBe('Chat picks up what it had done.')
    expect(ns.primary).toEqual({ label: 'Resume session', kind: 'chat' })
    expect(ns.secondary).not.toContainEqual(CHAT_ACTION)
  })

  it('says it stopped short even with tickets on the ledger that were never completed', () => {
    const ns = nextStep(
      planning({ sessions: [selfPlan()], docs: ['decisions.md', 'spec.md'], tickets: [pendingTicket] }),
      { driving: false },
    )

    expect(ns.title).toBe('Planning stopped before the plan was complete')
  })

  it('returns to the ordinary bars once a later chat exists', () => {
    const ns = nextStep(
      planning({
        sessions: [selfPlan({ id: 's1' }), session({ id: 's2', ccSessionId: 'cc-1', createdAt: 1 })],
        docs: ['decisions.md'],
      }),
      { driving: false },
    )

    expect(ns.title).toBe('Write the spec')
  })

  it('reads only this lap’s chats', () => {
    const ns = nextStep(
      planning({ lap: 2, sessions: [selfPlan({ lap: 1 })], docs: ['decisions.md'] }),
      { driving: false },
    )

    expect(ns.title).not.toBe('Planning stopped before the plan was complete')
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
  const review = (sessions: Session[]): FeatureFull => {
    const base = full({ phase: 'review' })
    return { ...base, feature: { ...base.feature, lap: 1 }, sessions } as unknown as FeatureFull
  }

  it('says a relay is working on the orchestrator’s change, with Stop only', () => {
    const ns = nextStep(
      planning({ sessions: [relay({ status: 'live' })], docs: ['decisions.md', 'spec.md'] }),
      { driving: false },
    )

    expect(ns.title).toBe('Working on a change the orchestrator sent back')
    expect(ns.busy).toBe(true)
    expect(ns.primary).toEqual({ label: 'Stop', kind: 'stopHeadlessRun' })
    expect(ns.secondary).toEqual([])
  })

  it('says a lap is planning itself at review, with Stop only', () => {
    const ns = nextStep(review([lapRun({ status: 'launching' })]), { driving: false })

    expect(ns.title).toBe('Planning more work itself')
    expect(ns.primary).toEqual({ label: 'Stop', kind: 'stopHeadlessRun' })
    expect(ns.secondary).toEqual([])
  })

  it('leaves an interactive start-lap chat to the ordinary review bar', () => {
    const ns = nextStep(review([lapRun({ status: 'live', headless: false })]), { driving: false })

    expect(ns.primary?.kind).not.toBe('stopHeadlessRun')
  })

  it('says a relay stopped short when the server said it did not finish', () => {
    const sessions = [relay()]
    const docs = ['decisions.md', 'spec.md']
    const stopped = nextStep(planning({ sessions, docs }), {
      driving: false,
      unfinishedRuns: ['sess_relay'],
    })

    expect(stopped.kick).toBe('STOPPED')
    expect(stopped.title).toBe('The orchestrator’s change stopped before it was finished')
    expect(stopped.primary).toEqual({ label: 'Resume session', kind: 'chat' })

    const finished = nextStep(planning({ sessions, docs }), { driving: false, unfinishedRuns: [] })
    expect(finished.kick).not.toBe('STOPPED')
  })

  it('says a lap stopped short at review, until a newer chat of the lap exists', () => {
    const stopped = nextStep(review([lapRun()]), { driving: false, unfinishedRuns: ['sess_lap'] })
    expect(stopped.title).toBe('Planning stopped before its tickets were ready')

    const later = nextStep(review([lapRun(), session({ id: 'sess_2', ccSessionId: 'cc-2' })]), {
      driving: false,
      unfinishedRuns: ['sess_lap'],
    })
    expect(later.kick).not.toBe('STOPPED')
  })
})
