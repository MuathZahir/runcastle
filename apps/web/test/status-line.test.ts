import { describe, expect, it } from 'vitest'
import type { NextStep } from '../src/lib/feature-ui'
import {
  featureStatus,
  leadActions,
  leadWakeOf,
  OVERFLOW_KINDS,
  type FeatureStatus,
  type FeatureStatusInput,
} from '../src/lib/feature-ui/status-line'

/**
 * The feature's one status line (`the-feature-lead-runs-rounds` decision 21),
 * derived from the feature row, its rounds and its ready declarations.
 */
const input = (over: {
  feature?: Partial<FeatureStatusInput['feature']>
  rounds?: FeatureStatusInput['rounds']
  declarations?: FeatureStatusInput['declarations']
  agentWorking?: boolean
  driving?: boolean
  selfPlanning?: boolean
  leadWake?: FeatureStatusInput['leadWake']
  now?: number
}): FeatureStatusInput => ({
  feature: {
    phase: 'building',
    status: 'active',
    lap: 1,
    ticketsReadyLap: null,
    waitingReason: null,
    ...over.feature,
  },
  rounds: over.rounds ?? [],
  declarations: over.declarations ?? [],
  agentWorking: over.agentWorking ?? false,
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

const declaration = (scenario: string, createdAt: number) => ({
  scenario,
  whatToTest: `What to test in ${scenario}.`,
  createdAt,
})

describe('featureStatus', () => {
  it('reads Planning with you before Go', () => {
    expect(featureStatus(input({ feature: { phase: 'planning' } }))).toEqual({
      kind: 'planning',
      label: 'Planning with you',
      primary: 'go',
    })
  })

  it('waits for Go once this lap’s plan is complete', () => {
    expect(featureStatus(input({ feature: { phase: 'planning', lap: 2, ticketsReadyLap: 2 } }))).toEqual({
      kind: 'waiting',
      label: 'Waiting for you',
      why: 'plan ready for Go',
      primary: 'go',
    })
  })

  it('does not call an earlier lap’s plan ready', () => {
    expect(featureStatus(input({ feature: { phase: 'planning', lap: 2, ticketsReadyLap: 1 } })).kind).toBe(
      'planning',
    )
  })

  it('reads Planning by itself while a self-planning run is live, with its Stop', () => {
    for (const ticketsReadyLap of [null, 1]) {
      expect(featureStatus(input({ feature: { phase: 'planning', ticketsReadyLap }, selfPlanning: true }))).toEqual({
        kind: 'working',
        label: 'Planning by itself',
        primary: 'stopSelfPlan',
      })
    }
  })

  it('returns to Planning with you, or plan ready for Go, once the self-planning run ends', () => {
    expect(featureStatus(input({ feature: { phase: 'planning' }, selfPlanning: false }))).toEqual({
      kind: 'planning',
      label: 'Planning with you',
      primary: 'go',
    })
    expect(featureStatus(input({ feature: { phase: 'planning', ticketsReadyLap: 1 }, selfPlanning: false }))).toEqual({
      kind: 'waiting',
      label: 'Waiting for you',
      why: 'plan ready for Go',
      primary: 'go',
    })
  })

  it('a running round, a drive and Merged outrank planning by itself', () => {
    const planning = { phase: 'planning' as const }
    expect(featureStatus(input({ feature: planning, selfPlanning: true, rounds: [round(1, 'running', 10)] }))).toEqual({
      kind: 'working',
      label: 'Working · Round 1',
      round: 1,
      primary: 'stop',
    })
    expect(featureStatus(input({ feature: planning, selfPlanning: true, driving: true }))).toMatchObject({
      label: 'Planning by itself',
      primary: 'testDriveStop',
    })
    expect(
      featureStatus(input({ feature: { phase: 'shipped', status: 'shipped' }, selfPlanning: true })),
    ).toEqual({ kind: 'merged', label: 'Merged' })
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

  it('reads Working · Round 1 right after Go, while the wake is inside its grace', () => {
    expect(featureStatus(input({ leadWake: { pendingSince: 1_000 }, now: 1_000 + 59_000 }))).toEqual({
      kind: 'working',
      label: 'Working · Round 1',
      round: 1,
    })
  })

  it('Go given, no round, no live lead: reads Waiting for you · the agent stopped, with the Chat door', () => {
    expect(featureStatus(input({}))).toEqual({
      kind: 'waiting',
      label: 'Waiting for you',
      why: 'the agent stopped',
      primary: 'chat',
    })
  })

  it('a wake pending past its grace reads the agent stopped', () => {
    expect(featureStatus(input({ leadWake: { pendingSince: 1_000 }, now: 1_000 + 60_000 }))).toMatchObject({
      kind: 'waiting',
      why: 'the agent stopped',
      primary: 'chat',
    })
  })

  it('a running round or the agent mid-turn still reads Working with no wake at all', () => {
    expect(featureStatus(input({ rounds: [round(1, 'running', 10)] })).kind).toBe('working')
    expect(featureStatus(input({ agentWorking: true }))).toEqual({
      kind: 'working',
      label: 'Working · Round 1',
      round: 1,
    })
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

  it('a wake failure older than the last round or a newer wake does not read as the failure', () => {
    const failed = { at: 30, exitCode: 1 }
    expect(featureStatus(input({ rounds: [round(2, 'succeeded', 40)], leadWake: { failed }, now: 100_000 })).why).toBe(
      'round 2 done',
    )
    expect(featureStatus(input({ leadWake: { pendingSince: 40, failed }, now: 100_000 })).why).toBe('the agent stopped')
    expect(featureStatus(input({ leadWake: { pendingSince: 40, failed }, now: 50 })).kind).toBe('working')
  })

  it('reads Waiting for you with the agent’s reason', () => {
    for (const why of ['which coupon rule wins?', 'stuck: migration fails', 'provider limit', 'stopped']) {
      expect(featureStatus(input({ feature: { waitingReason: why }, rounds: [round(3, 'failed', 30)] }))).toEqual({
        kind: 'waiting',
        label: 'Waiting for you',
        why,
      })
    }
  })

  it('waits for the human once a stopped round’s agent is idle, with no Stop to offer', () => {
    expect(featureStatus(input({ feature: { phase: 'review' }, rounds: [round(2, 'cancelled', 20)] }))).toEqual({
      kind: 'waiting',
      label: 'Waiting for you',
      why: 'stopped',
    })
  })

  it('waits for the human once a failed round’s agent is idle', () => {
    expect(featureStatus(input({ rounds: [round(1, 'failed', 10)] }))).toEqual({
      kind: 'waiting',
      label: 'Waiting for you',
      why: 'round 1 failed',
    })
  })

  it('waits for the human once a succeeded round’s agent has ended its turn without declaring ready', () => {
    expect(featureStatus(input({ rounds: [round(1, 'succeeded', 10), round(2, 'succeeded', 20)] }))).toEqual({
      kind: 'waiting',
      label: 'Waiting for you',
      why: 'round 2 done',
    })
    expect(featureStatus(input({ feature: { phase: 'review' }, rounds: [round(1, 'succeeded', 10)] }))).toEqual({
      kind: 'waiting',
      label: 'Waiting for you',
      why: 'round 1 done',
    })
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
          feature: { phase: 'review' },
          rounds: [round(1, 'succeeded', 10), round(2, 'succeeded', 20)],
          declarations: [declaration('Old drive', 15), declaration('Apply a coupon at checkout', 25)],
        }),
      ),
    ).toEqual({
      kind: 'ready',
      label: 'Ready for you',
      why: 'Test drive ▸ Apply a coupon at checkout',
      scenario: 'Apply a coupon at checkout',
      whatToTest: 'What to test in Apply a coupon at checkout.',
      primary: 'testDriveStart',
    })
  })

  it('a round dispatched after the declaration takes the line off Ready', () => {
    const after = (agentWorking: boolean) =>
      featureStatus(
        input({
          feature: { phase: 'review' },
          rounds: [round(2, 'succeeded', 20), round(3, 'succeeded', 30)],
          declarations: [declaration('Apply a coupon', 25)],
          agentWorking,
        }),
      )
    expect(after(true).kind).toBe('working')
    expect(after(false)).toEqual({ kind: 'waiting', label: 'Waiting for you', why: 'round 3 done' })
  })

  it('the agent at work on the human’s drive notes is Working, not Ready', () => {
    expect(
      featureStatus(
        input({
          feature: { phase: 'review' },
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
          feature: { phase: 'shipped', status: 'shipped', waitingReason: 'stale' },
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
        { type: 'feature.go', ts: 5, data: undefined },
        { type: 'lead.message_pending', ts: 10, data: {} },
        { type: 'lead.wake_failed', ts: 12, data: { exitCode: null, tail: 'refused', messages: 1 } },
        { type: 'lead.woken_headless', ts: 20, data: {} },
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

  it('is Go in planning, whether or not the plan is complete yet', () => {
    expect(primary({ feature: { phase: 'planning' } })).toBe('go')
    expect(primary({ feature: { phase: 'planning', ticketsReadyLap: 1 } })).toBe('go')
  })

  it('is Stop while a round runs', () => {
    expect(primary({ rounds: [round(1, 'running', 10)] })).toBe('stop')
  })

  it('is Start test drive when ready', () => {
    expect(
      primary({ feature: { phase: 'review' }, rounds: [round(1, 'succeeded', 10)], declarations: [declaration('S', 15)] }),
    ).toBe('testDriveStart')
  })

  it('is Stop drive while this feature is driven, over every other state', () => {
    expect(
      primary({
        feature: { phase: 'review' },
        rounds: [round(1, 'succeeded', 10)],
        declarations: [declaration('S', 15)],
        driving: true,
      }),
    ).toBe('testDriveStop')
  })

  it('is none while waiting on the human, between rounds, or merged', () => {
    expect(primary({ feature: { waitingReason: 'stopped' } })).toBeUndefined()
    expect(primary({ rounds: [round(1, 'succeeded', 10)], agentWorking: true })).toBeUndefined()
    expect(primary({ feature: { phase: 'shipped', status: 'shipped' }, driving: true })).toBeUndefined()
  })
})

describe('the action row beside the status line', () => {
  const ns = (over: Partial<NextStep>): NextStep => ({ kick: '', secondary: [], busy: false, ...over })
  const status = (over: Partial<FeatureStatus> = {}): FeatureStatus => ({ kind: 'working', label: 'W', ...over })

  it('turns the plan’s Burn into Go, keeping its refusal', () => {
    const out = leadActions(
      ns({ primary: { label: 'Burn 3 tickets', kind: 'burn', disabled: 'busy' } }),
      status({ kind: 'planning', primary: 'go' }),
    )
    expect(out.primary).toEqual({ label: 'Go', kind: 'burn', disabled: 'busy' })
  })

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

  it('keeps Merge & ship as the one secondary in every state but merged, and the rest after it', () => {
    const out = leadActions(
      ns({
        primary: { label: 'Resume burn', kind: 'burn' },
        secondary: [
          { label: 'Burn 1 ticket', kind: 'burn' },
          { label: 'Chat', kind: 'chat' },
          { label: 'Cancel run', kind: 'cancelRun' },
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
    expect(OVERFLOW_KINDS).toContain('resolveConflict')
    expect(OVERFLOW_KINDS).not.toContain('merge')
    expect(leadActions(ns({}), status({ kind: 'merged' })).secondary).toEqual([])
  })

  it('offers the self-planning run’s Stop as the primary, and Go nowhere on the row', () => {
    const out = leadActions(
      ns({
        primary: { label: 'Stop', kind: 'stopHeadlessRun' },
        secondary: [{ label: 'Burn 3 tickets', kind: 'burn' }],
      }),
      featureStatus(input({ feature: { phase: 'planning' }, selfPlanning: true })),
    )
    expect(out.primary).toEqual({ label: 'Stop', kind: 'stopHeadlessRun', danger: true })
    expect([out.primary, ...out.secondary].some((a) => a?.kind === 'burn' || a?.label === 'Go')).toBe(false)
  })

  it('offers the Chat door as the primary once the agent stopped', () => {
    const out = leadActions(
      ns({ secondary: [{ label: 'Chat', kind: 'chat' }, { label: 'Burn 1 ticket', kind: 'burn' }] }),
      featureStatus(input({})),
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
