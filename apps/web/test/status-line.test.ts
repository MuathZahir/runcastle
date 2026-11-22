import { describe, expect, it } from 'vitest'
import type { NextStep } from '../src/lib/feature-ui'
import {
  featureStatus,
  headerActions,
  leadActions,
  type FeatureStatus,
  type FeatureStatusInput,
} from '../src/lib/feature-ui/status-line'
import { need } from './fixtures'

/**
 * The feature's one status line (needs-you-is-the-agent-s-call decision 15):
 * "Needs you · <the agent's line>", "Working", "Idle" or "Merged", an archived
 * feature its shelf. Needs you beats Working (decision 18).
 */
const input = (over: Partial<Omit<FeatureStatusInput, 'feature'>> & { feature?: Partial<FeatureStatusInput['feature']> } = {}): FeatureStatusInput => ({
  need: null,
  working: false,
  agentWorking: false,
  workersWorking: 0,
  driving: false,
  selfPlanning: false,
  declared: false,
  ...over,
  feature: { status: 'active', ...over.feature },
})

describe('featureStatus', () => {
  it('reads Idle with nothing running and nothing asked, and offers no button', () => {
    expect(featureStatus(input())).toEqual({ kind: 'idle', label: 'Idle' })
  })

  it('reads Needs you with the agent’s line and the chat it waits in', () => {
    expect(featureStatus(input({ need: need('Which database?', { threadId: 'worker_1' }) }))).toEqual({
      kind: 'needsYou',
      label: 'Needs you',
      why: 'Which database?',
      threadId: 'worker_1',
    })
  })

  it('reads Working off the server’s answer, the main chat, workers at work or a self-planning run', () => {
    for (const over of [{ working: true }, { agentWorking: true }, { workersWorking: 1 }, { selfPlanning: true }]) {
      expect(featureStatus(input(over))).toMatchObject({ kind: 'working', label: 'Working' })
    }
  })

  it('lets Needs you beat Working (decision 18)', () => {
    const status = featureStatus(input({ need: need('Plan ready for your yes'), working: true, workersWorking: 2 }))
    expect(status).toMatchObject({ kind: 'needsYou', why: 'Plan ready for your yes', primary: 'stop' })
  })

  it('reads Merged once shipped and Archived on the shelf, with no button', () => {
    expect(featureStatus(input({ feature: { status: 'shipped' }, need: need('x'), workersWorking: 1 }))).toEqual({ kind: 'merged', label: 'Merged' })
    expect(featureStatus(input({ feature: { status: 'archived' }, working: true }))).toEqual({ kind: 'shelf', label: 'Archived' })
  })

  it('picks Stop drive while driving, then Start test drive once declared, then Stop for workers or a self-plan', () => {
    expect(featureStatus(input({ driving: true, declared: true, workersWorking: 1 })).primary).toBe('testDriveStop')
    expect(featureStatus(input({ declared: true }))).toMatchObject({ primary: 'testDriveStart' })
    expect(featureStatus(input({ declared: true, workersWorking: 1 }))).toMatchObject({ primary: 'testDriveStart', stop: 'stop' })
    expect(featureStatus(input({ workersWorking: 2 })).primary).toBe('stop')
    expect(featureStatus(input({ selfPlanning: true })).primary).toBe('stopSelfPlan')
  })
})

describe('the action row beside the status line', () => {
  const ns = (over: Partial<NextStep>): NextStep => ({ kick: '', secondary: [], busy: false, ...over })
  const status = (over: Partial<FeatureStatus> = {}): FeatureStatus => ({ kind: 'working', label: 'W', ...over })

  it('offers each primary as the one button', () => {
    expect(leadActions(ns({}), status({ primary: 'testDriveStart' })).primary).toEqual({ label: 'Start test drive', kind: 'testDriveStart' })
    expect(leadActions(ns({}), status({ primary: 'testDriveStop' })).primary).toEqual({ label: 'Stop drive', kind: 'testDriveStop' })
    expect(leadActions(ns({}), status({ primary: 'stop' })).primary).toEqual({ label: 'Stop', kind: 'stopAgent', danger: true })
  })

  it('keeps the resolver’s refusal on the primary it chose', () => {
    const out = leadActions(
      ns({ primary: { label: 'Start test drive', kind: 'testDriveStart', disabled: 'another drive holds the slot' } }),
      status({ primary: 'testDriveStart' }),
    )
    expect(out.primary).toEqual({ label: 'Start test drive', kind: 'testDriveStart', disabled: 'another drive holds the slot' })
  })

  it('keeps Merge & ship as the first secondary in every state but merged, never the chat', () => {
    const out = leadActions(
      ns({ secondary: [{ label: 'Chat', kind: 'chat' }, { label: 'Fix the drive', kind: 'fixDrive' }] }),
      status({ kind: 'idle' }),
    )
    expect(out.primary).toBeUndefined()
    expect(out.secondary).toEqual([
      { label: 'Merge & ship', kind: 'merge' },
      { label: 'Fix the drive', kind: 'fixDrive' },
    ])
    expect(leadActions(ns({}), status({ kind: 'merged' })).secondary).toEqual([])
  })

  it('offers the self-planning run’s Stop as the primary', () => {
    const out = leadActions(ns({ primary: { label: 'Stop', kind: 'stopSelfPlan' } }), featureStatus(input({ selfPlanning: true })))
    expect(out.primary).toEqual({ label: 'Stop', kind: 'stopSelfPlan', danger: true })
  })
})

/** you-always-know-what-s-waiting decision 6: the primary, Merge & ship beside it, the rest in "⋯". */
describe('the header’s share of the row', () => {
  const ns = (over: Partial<NextStep> = {}): NextStep => ({ kick: '', secondary: [], busy: false, ...over })
  const MERGE = { label: 'Merge & ship', kind: 'merge' } as const
  const header = (over: Parameters<typeof input>[0], step: NextStep = ns()) => headerActions(step, featureStatus(input(over)))

  it('has only Merge & ship while idle or needing you', () => {
    expect(header({})).toEqual({ merge: MERGE, overflow: [] })
    expect(header({ need: need('Which database?') })).toEqual({ merge: MERGE, overflow: [] })
  })

  it('keeps Stop as the button while workers work, with Merge & ship beside it', () => {
    expect(header({ workersWorking: 2 })).toEqual({
      action: { label: 'Stop', kind: 'stopAgent', danger: true },
      merge: MERGE,
      overflow: [],
    })
  })

  it('puts Start test drive first once declared, with the workers’ Stop in "⋯"', () => {
    expect(header({ declared: true, workersWorking: 1 })).toEqual({
      action: { label: 'Start test drive', kind: 'testDriveStart' },
      merge: MERGE,
      overflow: [{ label: 'Stop', kind: 'stopAgent', danger: true }],
    })
  })

  it('puts every other action the resolver offered in "⋯"', () => {
    const out = header({}, ns({ primary: { label: 'Move to backlog', kind: 'moveToBacklog' } }))
    expect(out.overflow).toEqual([{ label: 'Move to backlog', kind: 'moveToBacklog' }])
  })

  it('has no button and nothing in "⋯" once merged', () => {
    expect(header({ feature: { status: 'shipped' } }, ns({ secondary: [MERGE] }))).toEqual({ overflow: [] })
  })
})
