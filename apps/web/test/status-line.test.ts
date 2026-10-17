import { describe, expect, it } from 'vitest'
import { featureStatus, type FeatureStatusInput } from '../src/lib/feature-ui/status-line'

/**
 * The feature's one status line (`the-feature-lead-runs-rounds` decision 21),
 * derived from the feature row, its rounds and its ready declarations.
 */
const input = (over: {
  feature?: Partial<FeatureStatusInput['feature']>
  rounds?: FeatureStatusInput['rounds']
  declarations?: FeatureStatusInput['declarations']
  agentWorking?: boolean
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
    })
  })

  it('waits for Go once this lap’s plan is complete', () => {
    expect(featureStatus(input({ feature: { phase: 'planning', lap: 2, ticketsReadyLap: 2 } }))).toEqual({
      kind: 'waiting',
      label: 'Waiting for you',
      why: 'plan ready for Go',
    })
  })

  it('does not call an earlier lap’s plan ready', () => {
    expect(featureStatus(input({ feature: { phase: 'planning', lap: 2, ticketsReadyLap: 1 } })).kind).toBe(
      'planning',
    )
  })

  it('reads Working · Round N while a round runs', () => {
    expect(
      featureStatus(input({ rounds: [round(1, 'succeeded', 10), round(2, 'succeeded', 20), round(3, 'running', 30)] })),
    ).toEqual({ kind: 'working', label: 'Working · Round 3', round: 3 })
  })

  it('reads Working between rounds, on the last round the agent is checking', () => {
    expect(featureStatus(input({ rounds: [round(1, 'succeeded', 10)], agentWorking: true }))).toEqual({
      kind: 'working',
      label: 'Working · Round 1',
      round: 1,
    })
  })

  it('reads Working · Round 1 right after Go, before the first round is out', () => {
    expect(featureStatus(input({}))).toMatchObject({ kind: 'working', label: 'Working · Round 1' })
  })

  it('reads Waiting for you with the agent’s reason', () => {
    for (const why of ['round 4 proposed', 'stuck: migration fails', 'provider limit']) {
      expect(featureStatus(input({ feature: { waitingReason: why }, rounds: [round(3, 'failed', 30)] }))).toEqual({
        kind: 'waiting',
        label: 'Waiting for you',
        why,
      })
    }
  })

  it('a running round outranks a standing reason', () => {
    expect(
      featureStatus(input({ feature: { waitingReason: 'round 2 proposed' }, rounds: [round(2, 'running', 20)] })).kind,
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
    })
  })

  it('a round dispatched after the declaration takes the line back to Working', () => {
    expect(
      featureStatus(
        input({
          feature: { phase: 'review' },
          rounds: [round(2, 'succeeded', 20), round(3, 'succeeded', 30)],
          declarations: [declaration('Apply a coupon', 25)],
        }),
      ).kind,
    ).toBe('working')
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
