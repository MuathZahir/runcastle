import type { Feature, ReadyDeclaration, RoundSummary } from '@runcastle/core'
import type { NextAction, NextStep } from './next-step/types'

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

/** The reason an idle agent waits on after the human stopped its round. */
export const STOPPED = 'stopped'

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
 * - Waiting for you · stopped / round N failed — the last round was stopped or
 *   failed and the agent's turn is over: nothing is running and nothing will
 *   be dispatched until the human replies.
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
  // A stopped or failed round wakes nobody to finish it: Stop flips the
  // feature to Ask, and a provider-limit halt is not woken (decision 15). Once
  // the agent's turn is over, nothing moves until the human replies.
  if (!agentWorking && latest && latest.status !== 'succeeded') {
    const why = latest.status === 'cancelled' ? STOPPED : `round ${latest.round} failed`
    return { kind: 'waiting', label: 'Waiting for you', why }
  }
  return working()
}

/**
 * The feature's token total (decision 3): its rounds' workers plus its own
 * sessions — the agent among them. Null while nothing has been counted, so the
 * header says nothing rather than "0 tokens".
 */
export function featureTokens(
  rounds: readonly Pick<RoundSummary, 'tokens'>[],
  sessions: readonly { tokens?: number | null }[],
): number | null {
  const counted = [...rounds.map((r) => r.tokens), ...sessions.map((s) => s.tokens)].filter(
    (n): n is number => typeof n === 'number',
  )
  return counted.length > 0 ? counted.reduce((sum, n) => sum + n, 0) : null
}

/** "1.8M tokens", "940k tokens", "512 tokens" — tokens only, never cost. */
export function tokensText(n: number): string {
  if (n >= 1_000_000) return `${trimZero((n / 1_000_000).toFixed(1))}M tokens`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k tokens`
  return `${n} tokens`
}

function trimZero(fixed: string): string {
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed
}

/**
 * The next-step row's actions once the status line tells the state (decision
 * 8): the human never burns — the plan's Burn is Go, and past planning the
 * agent dispatches every round, so no burn action is offered at all. Stop sits
 * beside the status line and is the one move that halts the agent (decision
 * 15), so the bar's own run cancel goes too. The chat door reads "Agent".
 */
export function leadActions(ns: NextStep, phase: Feature['phase']): NextStep {
  const keep = (action: NextAction): NextAction | null => {
    if (action.kind === 'cancelRun') return null
    // The feature's chat is "the agent" to the human (decision 20).
    if (action.kind === 'chat' && action.label === 'Chat') return { ...action, label: 'Agent' }
    if (action.kind !== 'burn') return action
    return phase === 'planning' ? { ...action, label: 'Go' } : null
  }
  const { primary: was, ...rest } = ns
  const primary = was ? keep(was) : null
  return {
    ...rest,
    ...(primary ? { primary } : {}),
    secondary: ns.secondary.flatMap((a) => keep(a) ?? []),
  }
}
