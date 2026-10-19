import type { Feature, ReadyDeclaration, RoundSummary } from '@runcastle/core'
import { ACTION_KINDS, type ActionKind, type NextAction, type NextStep } from './next-step/types'

/**
 * The feature's one status line (`the-feature-lead-runs-rounds` decision 21):
 * what the human reads at a glance, from a fixed set. The four phases stay
 * underneath as machine states; this is the story told over them.
 */
export type FeatureStatusKind = 'planning' | 'working' | 'waiting' | 'ready' | 'merged'

/**
 * The one primary button the status line's row carries (decision 24): Go in
 * planning, Start test drive when ready, Stop drive while driving, Stop while a
 * round runs, Stop while the feature plans itself — and none in any other state.
 */
export type StatusPrimary = 'go' | 'testDriveStart' | 'testDriveStop' | 'stop' | 'stopSelfPlan'

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
  /** The row's one primary; absent when this state has none. */
  primary?: StatusPrimary
}

export interface FeatureStatusInput {
  feature: Pick<Feature, 'phase' | 'status' | 'lap' | 'ticketsReadyLap' | 'waitingReason'>
  /** The feature's rounds in order, as `feature.rounds` returns them. */
  rounds: readonly Pick<RoundSummary, 'round' | 'status' | 'startedAt'>[]
  /** Every ready declaration, oldest first, as `feature.readyDeclarations` returns them. */
  declarations: readonly Pick<ReadyDeclaration, 'scenario' | 'whatToTest' | 'createdAt'>[]
  /** The agent's session is mid-turn — working on something it was sent. */
  agentWorking: boolean
  /** A drive of this feature holds the drive slot right now. */
  driving: boolean
  /** The feature's live session is a self-planning run (headless chat, purpose `self-plan`). */
  selfPlanning: boolean
}

/** The reason Go waits on, when the plan is finished and the preview stands. */
export const PLAN_READY = 'plan ready for Go'

/** The reason an idle agent waits on after the human stopped its round. */
export const STOPPED = 'stopped'

/**
 * Derive the line, and the one primary its row carries. Precedence, highest first:
 *
 * - Merged — shipped is final.
 * - Working · Round N — a round is running; nothing else is true until it returns.
 * - Planning by itself — a planning feature's self-planning run is live; the
 *   plan is being written, so Go would cut it short.
 * - Waiting for you · <why> — the agent said it needs the human (a question,
 *   stuck, stopped, provider limit). The next human message or dispatch clears it.
 * - Planning with you — before Go; Waiting for you · plan ready for Go once the
 *   tickets step is complete for this lap (the same arming Go's bar reads).
 * - Ready for you · Test drive ▸ <scenario> — the latest declaration is newer
 *   than the latest round, and the agent is not working on something since
 *   (notes the human sent wake it, and it is Working again).
 * - Waiting for you · stopped / round N failed / round N done — the last round
 *   returned and the agent's turn is over: nothing is running and nothing will
 *   be dispatched until the human replies.
 * - Working · Round N — otherwise: the agent is between rounds, or Go was just
 *   given and round 1 is not out yet.
 *
 * The primary follows the state: Stop drive while this feature is driven, Stop
 * while a round runs, Stop the run while the feature plans itself, Go in
 * planning, Start test drive when ready.
 */
export function featureStatus(input: FeatureStatusInput): FeatureStatus {
  const status = statusOf(input)
  const primary = primaryOf(input, status)
  return primary ? { ...status, primary } : status
}

function planningItself(input: FeatureStatusInput): boolean {
  return input.selfPlanning && input.feature.phase === 'planning'
}

function primaryOf(input: FeatureStatusInput, status: FeatureStatus): StatusPrimary | undefined {
  if (status.kind === 'merged') return undefined
  if (input.driving) return 'testDriveStop'
  if (input.rounds.at(-1)?.status === 'running') return 'stop'
  if (planningItself(input)) return 'stopSelfPlan'
  if (input.feature.phase === 'planning') return 'go'
  if (status.kind === 'ready') return 'testDriveStart'
  return undefined
}

function statusOf(input: FeatureStatusInput): FeatureStatus {
  const { feature, rounds, declarations, agentWorking } = input
  if (feature.status === 'shipped' || feature.phase === 'shipped') return { kind: 'merged', label: 'Merged' }

  const latest = rounds.at(-1)
  const working = (): FeatureStatus => {
    const round = latest?.round ?? 1
    return { kind: 'working', label: `Working · Round ${round}`, round }
  }
  if (latest?.status === 'running') return working()

  if (planningItself(input)) return { kind: 'working', label: 'Planning by itself' }

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
  // Once a round has returned and the agent's turn is over, nothing runs and
  // nobody works: a stopped or failed round wakes nobody to finish it (Stop
  // marks the feature stopped, a provider-limit halt is not woken — decision
  // 15), and an agent that reported a succeeded round without declaring ready
  // is waiting on the human's reply. Nothing moves until the human replies.
  if (!agentWorking && latest) {
    const why =
      latest.status === 'cancelled'
        ? STOPPED
        : latest.status === 'failed'
          ? `round ${latest.round} failed`
          : `round ${latest.round} done`
    return { kind: 'waiting', label: 'Waiting for you', why }
  }
  return working()
}

/** What each primary reads as, and the dispatcher kind it fires. */
const PRIMARY_ACTION: Record<StatusPrimary, NextAction> = {
  go: { label: 'Go', kind: 'burn' },
  testDriveStart: { label: 'Start test drive', kind: 'testDriveStart' },
  testDriveStop: { label: 'Stop drive', kind: 'testDriveStop' },
  stop: { label: 'Stop', kind: 'stopAgent', danger: true },
  stopSelfPlan: { label: 'Stop', kind: 'stopHeadlessRun', danger: true },
}

const MERGE: NextAction = { label: 'Merge & ship', kind: 'merge' }

/**
 * Kinds the row never offers beside the status line: the human never burns
 * (Go is the one road out of planning, and the agent dispatches every round
 * after — decision 8), Stop is the one move that halts the agent, so the bar's
 * own run cancel goes, and the agent is the top bar's Agent tab, not a button
 * in the header (decision 24).
 */
const NEVER_OFFERED: readonly ActionKind[] = ['burn', 'cancelRun', 'chat']

/**
 * The action row beside the status line (decision 24): exactly the status's one
 * primary, Merge & ship always as the secondary, and every other action the
 * resolver chose after it — the bar puts those in its "⋯" menu (see
 * {@link OVERFLOW_KINDS}). The resolver's own action of the primary's kind is
 * kept when it has one, so a refusal it carries (another feature holds the drive
 * slot) still disables the button and says why.
 */
export function leadActions(ns: NextStep, status: FeatureStatus): NextStep {
  const offered = [...(ns.primary ? [ns.primary] : []), ...ns.secondary]
  const own = (kind: ActionKind) => offered.find((a) => a.kind === kind)
  const choice = status.primary ? PRIMARY_ACTION[status.primary] : undefined
  const primary = choice ? { ...own(choice.kind), ...choice } : undefined
  const merge = status.kind === 'merged' ? [] : [own('merge') ?? MERGE]
  const rest = offered.filter(
    (a) => a.kind !== 'merge' && a.kind !== primary?.kind && !NEVER_OFFERED.includes(a.kind),
  )
  const { primary: _was, ...base } = ns
  return { ...base, ...(primary ? { primary } : {}), secondary: [...merge, ...rest] }
}

/** Everything but Merge & ship goes to the row's "⋯" menu beside the status line. */
export const OVERFLOW_KINDS: readonly ActionKind[] = ACTION_KINDS.filter((k) => k !== 'merge')
