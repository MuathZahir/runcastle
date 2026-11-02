import { describe, expect, it } from 'vitest'
import type { FeatureNeed } from '@runcastle/core'
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
 * derived from facts — the feature row's status, the need the server worked out
 * (you-always-know-what-s-waiting decision 14), its rounds and the agent's
 * session — never from a phase (tickets-and-review-are-tools-not-phases
 * decisions 2, 7).
 */
const input = (over: {
  feature?: Partial<FeatureStatusInput['feature']>
  need?: FeatureNeed | null
  rounds?: FeatureStatusInput['rounds']
  agentWorking?: boolean
  agentStateKnown?: boolean
  driving?: boolean
  selfPlanning?: boolean
  leadWake?: FeatureStatusInput['leadWake']
  now?: number
}): FeatureStatusInput => ({
  feature: { status: 'active', ...over.feature },
  need: over.need ?? null,
  rounds: over.rounds ?? [],
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

/** A need as `feature.get` carries it. */
const need = (kind: FeatureNeed['kind'], words: string, over: Partial<FeatureNeed> = {}): FeatureNeed => ({
  kind,
  words,
  held: false,
  since: 1,
  ...over,
})

describe('featureStatus', () => {
  it('reads Talking with you with nothing running and nothing asked, and offers no button', () => {
    expect(featureStatus(input({}))).toEqual({ kind: 'talking', label: 'Talking with you' })
  })

  it('reads each need in the sidebar row’s words, split at the first “·”, with its button', () => {
    const cases: Array<[FeatureNeed, Partial<FeatureStatus>]> = [
      [
        need('permission', 'Needs permission · Bash: git push', { why: 'Bash: git push', threadId: 't' }),
        { kind: 'waiting', label: 'Needs permission', why: 'Bash: git push', primary: 'showRequest' },
      ],
      [need('conflict', 'Merge conflict'), { kind: 'waiting', label: 'Merge conflict', primary: 'resolveConflict' }],
      [
        need('answer', 'Needs your answer · which model for approvals?'),
        { kind: 'waiting', label: 'Needs your answer', why: 'which model for approvals?', primary: 'reply' },
      ],
      [need('plan', 'Plan to approve'), { kind: 'waiting', label: 'Plan to approve', primary: 'openPlan' }],
      [need('design', 'Design to approve'), { kind: 'waiting', label: 'Design to approve', primary: 'openDesign' }],
      [need('stopped', 'Stopped · you stopped it'), { kind: 'waiting', label: 'Stopped', why: 'you stopped it', primary: 'chat' }],
      [
        need('test', 'Ready to test · Checkout', { scenario: 'Checkout' }),
        { kind: 'ready', label: 'Ready to test', why: 'Checkout', scenario: 'Checkout', primary: 'testDriveStart' },
      ],
      [need('merge', 'Ready to merge'), { kind: 'ready', label: 'Ready to merge', primary: 'merge' }],
    ]
    for (const [n, expected] of cases) expect(featureStatus(input({ need: n }))).toEqual(expected)
  })

  it('reads a held need “With the orchestrator · …”, marked held for its quiet dot', () => {
    expect(
      featureStatus(input({ need: need('plan', 'With the orchestrator · Plan to approve', { held: true }) })),
    ).toEqual({ kind: 'waiting', label: 'With the orchestrator', why: 'Plan to approve', held: true, primary: 'openPlan' })
  })

  it('reads Working, not the need, while a round runs or a self-planning run is live — but keeps Stop', () => {
    const plan = need('plan', 'Plan to approve')
    expect(featureStatus(input({ need: plan, rounds: [round(2, 'running', 10)] }))).toEqual({
      kind: 'working',
      label: 'Working · Round 2',
      round: 2,
      primary: 'stop',
    })
    expect(featureStatus(input({ need: plan, selfPlanning: true }))).toEqual({
      kind: 'working',
      label: 'Planning by itself',
      primary: 'stopSelfPlan',
    })
  })

  it('while the main chat is mid-turn, shows only a permission prompt or a merge conflict', () => {
    expect(featureStatus(input({ need: need('answer', 'Needs your answer'), agentWorking: true })).kind).toBe('working')
    expect(
      featureStatus(input({ need: need('permission', 'Needs permission · Bash: ls'), agentWorking: true })).label,
    ).toBe('Needs permission')
    expect(featureStatus(input({ need: need('conflict', 'Merge conflict'), agentWorking: true })).label).toBe(
      'Merge conflict',
    )
  })

  it('keeps the need’s words while this feature is driven, with Stop drive as the button', () => {
    expect(
      featureStatus(input({ need: need('test', 'Ready to test · Checkout', { scenario: 'Checkout' }), driving: true })),
    ).toMatchObject({ label: 'Ready to test', primary: 'testDriveStop' })
  })

  it('reads Planning by itself while a self-planning run is live, with its Stop', () => {
    expect(featureStatus(input({ selfPlanning: true }))).toEqual({
      kind: 'working',
      label: 'Planning by itself',
      primary: 'stopSelfPlan',
    })
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

  it('a wake that already failed ends its grace at once', () => {
    expect(
      featureStatus(input({ leadWake: { pendingSince: 1_000, failed: { at: 5_000, exitCode: null } }, now: 6_000 })).kind,
    ).toBe('talking')
    expect(featureStatus(input({ leadWake: { pendingSince: 40, failed: { at: 30, exitCode: 1 } }, now: 50 })).kind).toBe(
      'working',
    )
  })

  it('an idle agent after any round, with nothing asked, reads Talking with you, as the sidebar files it In progress', () => {
    for (const status of ['cancelled', 'failed', 'succeeded'] as const) {
      expect(featureStatus(input({ rounds: [round(2, status, 20)] }))).toEqual({
        kind: 'talking',
        label: 'Talking with you',
      })
    }
  })

  it('reads Merged once shipped', () => {
    expect(
      featureStatus(input({ feature: { status: 'shipped' }, need: need('merge', 'Ready to merge'), rounds: [round(1, 'running', 10)] })),
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

describe('the action row beside the status line', () => {
  const ns = (over: Partial<NextStep>): NextStep => ({ kick: '', secondary: [], busy: false, ...over })
  const status = (over: Partial<FeatureStatus> = {}): FeatureStatus => ({ kind: 'working', label: 'W', ...over })

  it('offers each need’s button as the one primary', () => {
    const labels = {
      reply: 'Reply',
      openPlan: 'Open plan',
      openDesign: 'Open design',
      showRequest: 'Show request',
      resolveConflict: 'Resolve conflict',
      testDriveStart: 'Start test drive',
      chat: 'Chat',
    } as const
    for (const [primary, label] of Object.entries(labels)) {
      expect(leadActions(ns({}), status({ kind: 'waiting', primary: primary as keyof typeof labels })).primary).toEqual({
        label,
        kind: primary,
      })
    }
  })

  it('offers Stop drive and Stop as the one primary for their states', () => {
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

  it('keeps Merge & ship as the first secondary in every state but merged, never the chat', () => {
    const out = leadActions(
      ns({ secondary: [{ label: 'Chat', kind: 'chat' }, { label: 'Fix the drive', kind: 'fixDrive' }] }),
      status({ kind: 'talking' }),
    )
    expect(out.primary).toBeUndefined()
    expect(out.secondary).toEqual([
      { label: 'Merge & ship', kind: 'merge' },
      { label: 'Fix the drive', kind: 'fixDrive' },
    ])
    expect(leadActions(ns({}), status({ kind: 'merged' })).secondary).toEqual([])
  })

  it('offers the self-planning run’s Stop as the primary', () => {
    const out = leadActions(
      ns({ primary: { label: 'Stop', kind: 'stopSelfPlan' } }),
      featureStatus(input({ selfPlanning: true })),
    )
    expect(out.primary).toEqual({ label: 'Stop', kind: 'stopSelfPlan', danger: true })
  })
})

/** you-always-know-what-s-waiting decision 6: the need's button, Merge & ship beside it, the rest in "⋯". */
describe('the header’s share of the row', () => {
  const ns = (over: Partial<NextStep> = {}): NextStep => ({ kick: '', secondary: [], busy: false, ...over })
  const MERGE = { label: 'Merge & ship', kind: 'merge' } as const
  const DRIVE = { label: 'Start test drive', kind: 'testDriveStart' } as const
  const header = (over: Parameters<typeof input>[0], step: NextStep = ns()) => headerActions(step, featureStatus(input(over)))

  it('has only Merge & ship while talking', () => {
    expect(header({})).toEqual({ merge: MERGE, overflow: [] })
  })

  it('puts the need’s button first and Merge & ship beside it', () => {
    expect(header({ need: need('plan', 'Plan to approve') })).toEqual({
      action: { label: 'Open plan', kind: 'openPlan' },
      merge: MERGE,
      overflow: [],
    })
  })

  it('lets a permission prompt outrank a running round: Show request leads, Stop waits in the menu', () => {
    const permission = need('permission', 'Needs permission · Bash: git push', { why: 'Bash: git push', threadId: 't' })
    expect(featureStatus(input({ need: permission, rounds: [round(1, 'running', 1)] })).label).toBe('Needs permission')
    expect(header({ need: permission, rounds: [round(1, 'running', 1)] })).toEqual({
      action: { label: 'Show request', kind: 'showRequest' },
      merge: MERGE,
      overflow: [{ label: 'Stop', kind: 'stopAgent', danger: true }],
    })
  })

  it('lets a permission prompt outrank planning by itself, its Stop kept in the menu', () => {
    const permission = need('permission', 'Needs permission · Bash: ls', { why: 'Bash: ls', threadId: 't' })
    const stopSelfPlan = { label: 'Stop', kind: 'stopSelfPlan' } as const
    expect(header({ need: permission, selfPlanning: true }, ns({ primary: stopSelfPlan }))).toEqual({
      action: { label: 'Show request', kind: 'showRequest' },
      merge: MERGE,
      overflow: [stopSelfPlan],
    })
  })

  it('keeps Stop as the button while a round runs, with Merge & ship beside it', () => {
    expect(header({ need: need('plan', 'Plan to approve'), rounds: [round(1, 'running', 1)] })).toEqual({
      action: { label: 'Stop', kind: 'stopAgent', danger: true },
      merge: MERGE,
      overflow: [],
    })
  })

  it('shows Merge & ship once, as the button, when the feature is ready to merge — Start test drive goes to "⋯"', () => {
    expect(header({ need: need('merge', 'Ready to merge') })).toEqual({ action: MERGE, overflow: [DRIVE] })
  })

  it('puts every other action the resolver offered in "⋯"', () => {
    const out = header({}, ns({ primary: { label: 'Plan it yourself', kind: 'selfPlan' } }))
    expect(out.overflow).toEqual([{ label: 'Plan it yourself', kind: 'selfPlan' }])
  })

  it('has no button and nothing in "⋯" once merged', () => {
    expect(header({ feature: { status: 'shipped' } }, ns({ secondary: [MERGE] }))).toEqual({ overflow: [] })
  })
})
