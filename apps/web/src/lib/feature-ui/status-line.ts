import type { Feature, ReadyDeclaration, RoundSummary } from '@runcastle/core'

/**
 * The feature's one status line (`the-feature-lead-runs-rounds` decision 21):
 * what the human reads at a glance, from a fixed set. The four phases stay
 * underneath as machine states; this is the story told over them.
 */
export type FeatureStatusKind = 'planning' | 'working' | 'waiting' | 'ready' | 'merged'

export interface FeatureStatus {
  kind: FeatureStatusKind
  /** The words before any reason: "Working · Round 3", "Waiting for you". */
  label: string
  /** The words after the label: why the agent waits, or the drive it asks for. */
  why?: string
  /** The round in flight, or the last one the agent is checking. */
  round?: number
  /** The drive the agent asked for, and what to test in it. */
  scenario?: string
  whatToTest?: string
}

export interface FeatureStatusInput {
  feature: Pick<Feature, 'phase' | 'status' | 'lap' | 'ticketsReadyLap' | 'waitingReason'>
  /** The feature's rounds in order, as `feature.rounds` returns them. */
  rounds: readonly Pick<RoundSummary, 'round' | 'status' | 'startedAt'>[]
  /** Every ready declaration, oldest first, as `feature.readyDeclarations` returns them. */
  declarations: readonly Pick<ReadyDeclaration, 'scenario' | 'whatToTest' | 'createdAt'>[]
  /** The agent's session is mid-turn — working on something it was sent. */
  agentWorking: boolean
}

/** The reason Go waits on, when the plan is finished and the preview stands. */
export const PLAN_READY = 'plan ready for Go'

/**
 * Derive the line. Precedence, highest first:
 *
 * - Merged — shipped is final.
 * - Working · Round N — a round is running; nothing else is true until it returns.
 * - Waiting for you · <why> — the agent said it needs the human (a proposed
 *   round, stuck, provider limit). The next human message or dispatch clears it.
 * - Planning with you — before Go; Waiting for you · plan ready for Go once the
 *   tickets step is complete for this lap (the same arming Go's bar reads).
 * - Ready for you · Test drive ▸ <scenario> — the latest declaration is newer
 *   than the latest round, and the agent is not working on something since
 *   (notes the human sent wake it, and it is Working again).
 * - Working · Round N — otherwise: the agent is between rounds.
 */
export function featureStatus(input: FeatureStatusInput): FeatureStatus {
  const { feature, rounds, declarations, agentWorking } = input
  if (feature.status === 'shipped' || feature.phase === 'shipped') return { kind: 'merged', label: 'Merged' }

  const latest = rounds.at(-1)
  const working = (): FeatureStatus => {
    const round = latest?.round ?? 1
    return { kind: 'working', label: `Working · Round ${round}`, round }
  }
  if (latest?.status === 'running') return working()

  if (feature.waitingReason) return { kind: 'waiting', label: 'Waiting for you', why: feature.waitingReason }

  if (feature.phase === 'planning') {
    return feature.ticketsReadyLap === feature.lap
      ? { kind: 'waiting', label: 'Waiting for you', why: PLAN_READY }
      : { kind: 'planning', label: 'Planning with you' }
  }

  const declared = declarations.at(-1)
  if (declared && !agentWorking && (!latest || declared.createdAt > latest.startedAt)) {
    return {
      kind: 'ready',
      label: 'Ready for you',
      why: `Test drive ▸ ${declared.scenario}`,
      scenario: declared.scenario,
      whatToTest: declared.whatToTest,
    }
  }
  return working()
}
