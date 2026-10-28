import { describe, expect, it } from 'vitest'
import type { NextStep } from '../src/lib/feature-ui'
import {
  featureStatus,
  headerActions,
  leadActions,
  leadWakeOf,
  type FeatureStatus,
  type FeatureStatusInput,
} from '../src/lib/feature-ui/status-line'

/**
 * The feature's one status line (`the-feature-lead-runs-rounds` decision 21),
 * derived from facts — the feature row's status and waiting reason, its rounds,
 * its ready declarations and the agent's session — never from a phase
 * (tickets-and-review-are-tools-not-phases decisions 2, 7).
 */
const input = (over: {
  feature?: Partial<FeatureStatusInput['feature']>
  rounds?: FeatureStatusInput['rounds']
  declarations?: FeatureStatusInput['declarations']
  agentWorking?: boolean
  agentStateKnown?: boolean
  driving?: boolean
  selfPlanning?: boolean
  leadWake?: FeatureStatusInput['leadWake']
  now?: number
}): FeatureStatusInput => ({
  feature: { status: 'active', waitingReason: null, ...over.feature },
  rounds: over.rounds ?? [],
  declarations: over.declarations ?? [],
  agentWorking: over.agentWorking ?? false,
  ...(over.agentStateKnown ? { agentStateKnown: true } : {}),
  driving: over.driving ?? false,
  selfPlanning: over.selfPlanning ?? false,
  ...(over.leadWake ? { leadWake: over.leadWake } : {}),
  now: over.now ?? 0,
})

const round = (n: number, status: 'running' | 'succeeded' | 'failed' | 'cancelled', startedAt: number) => ({
  round: n,
  status,
  startedAt,
})

const declaration = (scenario: string, createdAt: number) => ({ scenario, createdAt })

describe('featureStatus', () => {
  it('reads Talking with you with nothing running and nothing asked, and offers no button', () => {
    expect(featureStatus(input({}))).toEqual({ kind: 'talking', label: 'Talking with you' })
  })

  it('reads Planning by itself while a self-planning run is live, with its Stop', () => {
    expect(featureStatus(input({ selfPlanning: true }))).toEqual({
      kind: 'working',
      label: 'Planning by itself',
      primary: 'stopSelfPlan',
    })
  })

  it('returns to Talking with you once the self-planning run ends', () => {
    expect(featureStatus(input({ selfPlanning: false })).kind).toBe('talking')
  })

  it('a running round, a drive and Merged outrank planning by itself', () => {
    expect(featureStatus(input({ selfPlanning: true, rounds: [round(1, 'running', 10)] }))).toEqual({
      kind: 'working',
      label: 'Working · Round 1',
      round: 1,
      primary: 'stop',
    })
    expect(featureStatus(input({ selfPlanning: true, driving: true }))).toMatchObject({
      label: 'Planning by itself',
      primary: 'testDriveStop',
    })
    expect(featureStatus(input({ feature: { status: 'shipped' }, selfPlanning: true }))).toEqual({
      kind: 'merged',
      label: 'Merged',
    })
  })

  it('reads Working · Round N while a round runs', () => {
    expect(
      featureStatus(input({ rounds: [round(1, 'succeeded', 10), round(2, 'succeeded', 20), round(3, 'running', 30)] })),
    ).toEqual({ kind: 'working', label: 'Working · Round 3', round: 3, primary: 'stop' })
  })

  it('reads Working between rounds, on the last round the agent is checking', () => {
    expect(featureStatus(input({ rounds: [round(1, 'succeeded', 10)], agentWorking: true }))).toEqual({
      kind: 'working',
      label: 'Working · Round 1',
      round: 1,
    })
  })

  it('reads Working, with no round to name, while a message for the agent is inside its grace', () => {
    expect(featureStatus(input({ leadWake: { pendingSince: 1_000 }, now: 1_000 + 59_000 }))).toEqual({
      kind: 'working',
      label: 'Working',
    })
  })

  it('a wake pending past its grace reads Talking with you', () => {
    expect(featureStatus(input({ leadWake: { pendingSince: 1_000 }, now: 1_000 + 60_000 }))).toEqual({
      kind: 'talking',
      label: 'Talking with you',
    })
  })

  it('a wake inside its grace reads what the main chat’s own thread state says, once the thread list holds it', () => {
    const woken = { leadWake: { pendingSince: 1_000 }, now: 1_000 + 5_000, agentStateKnown: true }
    expect(featureStatus(input({ ...woken, agentWorking: false })).kind).toBe('talking')
    expect(featureStatus(input({ ...woken, agentWorking: true })).kind).toBe('working')
  })

  it('the agent mid-turn reads Working with no round and no wake at all', () => {
    expect(featureStatus(input({ agentWorking: true }))).toEqual({ kind: 'working', label: 'Working' })
  })

  it('a wake failure newer than the last round and wake reads the failure, with its exit code and the Chat door', () => {
    expect(
      featureStatus(
        input({
          rounds: [round(1, 'succeeded', 10)],
          leadWake: { pendingSince: 20, failed: { at: 30, exitCode: 1 } },
          now: 100_000,
        }),
      ),
    ).toEqual({ kind: 'waiting', label: 'Waiting for you', why: 'the agent’s run failed (exit 1)', primary: 'chat' })
    expect(featureStatus(input({ leadWake: { failed: { at: 30, exitCode: null } } })).why).toBe(
      'the agent’s run failed',
    )
  })

  it('a self-planning run stopped short reads planning stopped, with the Chat door to pick it up with the lead', () => {
    expect(featureStatus(input({ feature: { waitingReason: 'planning stopped' } }))).toEqual({
      kind: 'waiting',
      label: 'Waiting for you',
      why: 'planning stopped',
      primary: 'chat',
    })
  })

  it('a wake that already failed ends its grace at once: the failure shows, not Working', () => {
    expect(
      featureStatus(input({ leadWake: { pendingSince: 1_000, failed: { at: 5_000, exitCode: null } }, now: 6_000 })),
    ).toEqual({ kind: 'waiting', label: 'Waiting for you', why: 'the agent’s run failed', primary: 'chat' })
  })

  it('a wake failure older than the last round or a newer wake does not read as the failure', () => {
    const failed = { at: 30, exitCode: 1 }
    expect(featureStatus(input({ rounds: [round(2, 'succeeded', 40)], leadWake: { failed }, now: 100_000 })).kind).toBe(
      'talking',
    )
    expect(featureStatus(input({ leadWake: { pendingSince: 40, failed }, now: 100_000 })).kind).toBe('talking')
    expect(featureStatus(input({ leadWake: { pendingSince: 40, failed }, now: 50 })).kind).toBe('working')
  })

  it('reads Waiting for you · <why> with the agent’s reason, round or no round', () => {
    for (const why of ['which coupon rule wins?', 'start round 1?', 'provider limit', 'stopped']) {
      expect(featureStatus(input({ feature: { waitingReason: why } }))).toEqual({
        kind: 'waiting',
        label: 'Waiting for you',
        why,
      })
      expect(featureStatus(input({ feature: { waitingReason: why }, rounds: [round(3, 'failed', 30)] })).why).toBe(why)
    }
  })

  it('an idle agent after any round, with nothing asked, reads Talking with you, as the sidebar files it In progress', () => {
    for (const status of ['cancelled', 'failed', 'succeeded'] as const) {
      expect(featureStatus(input({ rounds: [round(2, status, 20)] }))).toEqual({
        kind: 'talking',
        label: 'Talking with you',
      })
    }
  })

  it('reads Working while the agent is mid-turn after a stopped or failed round', () => {
    for (const status of ['cancelled', 'failed'] as const) {
      expect(featureStatus(input({ rounds: [round(2, status, 20)], agentWorking: true }))).toEqual({
        kind: 'working',
        label: 'Working · Round 2',
        round: 2,
      })
    }
  })

  it('a running round outranks a standing reason', () => {
    expect(
      featureStatus(input({ feature: { waitingReason: 'a question for you' }, rounds: [round(2, 'running', 20)] })).kind,
    ).toBe('working')
  })

  it('reads Ready for you · Test drive ▸ <scenario> after a declaration newer than the last round', () => {
    expect(
      featureStatus(
        input({
          rounds: [round(1, 'succeeded', 10), round(2, 'succeeded', 20)],
          declarations: [declaration('Old drive', 15), declaration('Apply a coupon at checkout', 25)],
        }),
      ),
    ).toEqual({
      kind: 'ready',
      label: 'Ready for you',
      why: 'Test drive ▸ Apply a coupon at checkout',
      scenario: 'Apply a coupon at checkout',
      primary: 'testDriveStart',
    })
  })

  it('reads Ready, not Waiting, while declare_ready’s own waiting reason stands', () => {
    expect(
      featureStatus(
        input({
          feature: { waitingReason: 'ready to test' },
          rounds: [round(1, 'succeeded', 10)],
          declarations: [declaration('Apply a coupon', 25)],
        }),
      ),
    ).toEqual({
      kind: 'ready',
      label: 'Ready for you',
      why: 'Test drive ▸ Apply a coupon',
      scenario: 'Apply a coupon',
      primary: 'testDriveStart',
    })
  })

  it('reads Ready on a declaration made before any round', () => {
    expect(featureStatus(input({ declarations: [declaration('Look around', 5)] })).kind).toBe('ready')
  })

  it('a round dispatched after the declaration takes the line off Ready', () => {
    const after = (agentWorking: boolean) =>
      featureStatus(
        input({
          rounds: [round(2, 'succeeded', 20), round(3, 'succeeded', 30)],
          declarations: [declaration('Apply a coupon', 25)],
          agentWorking,
        }),
      )
    expect(after(true).kind).toBe('working')
    expect(after(false)).toEqual({ kind: 'talking', label: 'Talking with you' })
  })

  it('the agent at work on the human’s drive notes is Working, not Ready', () => {
    expect(
      featureStatus(
        input({
          rounds: [round(2, 'succeeded', 20)],
          declarations: [declaration('Apply a coupon', 25)],
          agentWorking: true,
        }),
      ),
    ).toMatchObject({ kind: 'working', label: 'Working · Round 2' })
  })

  it('reads Merged once shipped', () => {
    expect(
      featureStatus(
        input({
          feature: { status: 'shipped', waitingReason: 'stale' },
          rounds: [round(1, 'running', 10)],
          declarations: [declaration('Apply a coupon', 25)],
        }),
      ),
    ).toEqual({ kind: 'merged', label: 'Merged' })
  })
})

describe('leadWakeOf', () => {
  it('reads the newest wake and the newest wake failure off the event log', () => {
    expect(
      leadWakeOf([
        { type: 'lead.message_queued', ts: 10, data: {} },
        { type: 'lead.wake_failed', ts: 12, data: { exitCode: null, tail: 'refused', messages: 1 } },
        { type: 'lead.message_queued', ts: 20, data: {} },
        { type: 'lead.wake_failed', ts: 25, data: { sessionId: 's', exitCode: 1, tail: 'boom', messages: 1 } },
        { type: 'session.ended', ts: 30, data: {} },
      ]),
    ).toEqual({ pendingSince: 20, failed: { at: 25, exitCode: 1 } })
    expect(leadWakeOf([{ type: 'lead.message_queued', ts: 7, data: {} }])).toEqual({ pendingSince: 7 })
    expect(leadWakeOf([])).toEqual({})
  })
})

describe('the status line’s one primary (decision 24)', () => {
  const primary = (over: Parameters<typeof input>[0]) => featureStatus(input(over)).primary

  it('is Stop while a round runs', () => {
    expect(primary({ rounds: [round(1, 'running', 10)] })).toBe('stop')
  })

  it('is Start test drive when ready', () => {
    expect(primary({ rounds: [round(1, 'succeeded', 10)], declarations: [declaration('S', 15)] })).toBe(
      'testDriveStart',
    )
  })

  it('is Stop drive while this feature is driven, over every other state', () => {
    expect(
      primary({ rounds: [round(1, 'succeeded', 10)], declarations: [declaration('S', 15)], driving: true }),
    ).toBe('testDriveStop')
  })

  it('is none while talking, waiting on the human, between rounds, or merged', () => {
    expect(primary({})).toBeUndefined()
    expect(primary({ feature: { waitingReason: 'stopped' } })).toBeUndefined()
    expect(primary({ rounds: [round(1, 'succeeded', 10)], agentWorking: true })).toBeUndefined()
    expect(primary({ feature: { status: 'shipped' }, driving: true })).toBeUndefined()
  })
})

describe('the action row beside the status line', () => {
  const ns = (over: Partial<NextStep>): NextStep => ({ kick: '', secondary: [], busy: false, ...over })
  const status = (over: Partial<FeatureStatus> = {}): FeatureStatus => ({ kind: 'working', label: 'W', ...over })

  it('offers Start test drive, Stop drive and Stop as the one primary for their states', () => {
    expect(leadActions(ns({}), status({ kind: 'ready', primary: 'testDriveStart' })).primary).toEqual({
      label: 'Start test drive',
      kind: 'testDriveStart',
    })
    expect(leadActions(ns({}), status({ primary: 'testDriveStop' })).primary).toEqual({
      label: 'Stop drive',
      kind: 'testDriveStop',
    })
    expect(leadActions(ns({}), status({ primary: 'stop' })).primary).toEqual({
      label: 'Stop',
      kind: 'stopAgent',
      danger: true,
    })
  })

  it('keeps the resolver’s refusal on the primary it chose', () => {
    const out = leadActions(
      ns({ primary: { label: 'Start test drive', kind: 'testDriveStart', disabled: 'another drive holds the slot' } }),
      status({ kind: 'ready', primary: 'testDriveStart' }),
    )
    expect(out.primary).toEqual({ label: 'Start test drive', kind: 'testDriveStart', disabled: 'another drive holds the slot' })
  })

  it('keeps Merge & ship as the one secondary in every state but merged, and the rest after it', () => {
    const out = leadActions(
      ns({
        secondary: [
          { label: 'Chat', kind: 'chat' },
          { label: 'Resolve conflict', kind: 'resolveConflict' },
        ],
      }),
      status({ kind: 'waiting' }),
    )
    expect(out.primary).toBeUndefined()
    expect(out.secondary).toEqual([
      { label: 'Merge & ship', kind: 'merge' },
      { label: 'Resolve conflict', kind: 'resolveConflict' },
    ])
    expect(leadActions(ns({}), status({ kind: 'talking' })).secondary).toEqual([{ label: 'Merge & ship', kind: 'merge' }])
    expect(leadActions(ns({}), status({ kind: 'merged' })).secondary).toEqual([])
  })

  it('offers the self-planning run’s Stop as the primary', () => {
    const out = leadActions(
      ns({ primary: { label: 'Stop', kind: 'stopSelfPlan' } }),
      featureStatus(input({ selfPlanning: true })),
    )
    expect(out.primary).toEqual({ label: 'Stop', kind: 'stopSelfPlan', danger: true })
  })

  it('offers the Chat door as the primary once the agent’s run failed', () => {
    const out = leadActions(
      ns({ secondary: [{ label: 'Chat', kind: 'chat' }] }),
      featureStatus(input({ leadWake: { failed: { at: 30, exitCode: 1 } } })),
    )
    expect(out.primary).toEqual({ label: 'Chat', kind: 'chat' })
    expect(out.secondary).toEqual([{ label: 'Merge & ship', kind: 'merge' }])
  })

  it('does not offer the primary twice', () => {
    const out = leadActions(
      ns({ primary: { label: 'Start test drive', kind: 'testDriveStart' }, secondary: [{ label: 'Merge & ship', kind: 'merge' }] }),
      status({ kind: 'ready', primary: 'testDriveStart' }),
    )
    expect(out.secondary).toEqual([{ label: 'Merge & ship', kind: 'merge' }])
  })
})

/** design-mode decision 12: the row spread over the one header — one button, the rest in "⋯". */
describe('the header’s share of the row', () => {
  const ns = (over: Partial<NextStep>): NextStep => ({ kick: '', secondary: [], busy: false, ...over })
  const status = (over: Partial<FeatureStatus> = {}): FeatureStatus => ({ kind: 'working', label: 'W', ...over })
  const MERGE = { label: 'Merge & ship', kind: 'merge' } as const
  const DRIVE = { label: 'Start test drive', kind: 'testDriveStart' } as const

  it('has no button while talking: Merge & ship waits in "⋯"', () => {
    expect(headerActions(ns({}), status({ kind: 'talking' }))).toEqual({ overflow: [MERGE] })
  })

  it('gives the header’s one button to Merge & ship when the resolver offers it and nothing else leads', () => {
    const out = headerActions(ns({ secondary: [MERGE] }), status({ kind: 'waiting' }))
    expect(out.action).toEqual(MERGE)
    expect(out.overflow).toEqual([])
  })

  it('gives the header’s one button to the status’s primary, Merge & ship going to "⋯"', () => {
    const out = headerActions(ns({ primary: DRIVE, secondary: [MERGE] }), status({ kind: 'ready', primary: 'testDriveStart' }))
    expect(out.action).toEqual(DRIVE)
    expect(out.overflow).toEqual([MERGE])
  })

  it('puts every other action in "⋯", never the chat', () => {
    const out = headerActions(
      ns({
        primary: MERGE,
        secondary: [
          { label: 'Chat', kind: 'chat' },
          { label: 'Fix the drive', kind: 'fixDrive' },
        ],
      }),
      status({ kind: 'waiting' }),
    )
    expect(out.action).toEqual(MERGE)
    expect(out.overflow).toEqual([{ label: 'Fix the drive', kind: 'fixDrive' }])
  })

  it('has no button and nothing in "⋯" once merged', () => {
    expect(headerActions(ns({ secondary: [MERGE] }), status({ kind: 'merged' }))).toEqual({ overflow: [] })
  })
})
