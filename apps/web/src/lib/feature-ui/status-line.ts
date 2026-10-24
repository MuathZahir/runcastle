import {
  LEAD_WAKE_FAILED,
  LeadWakeFailedData,
  type EventRow,
  type Feature,
  type ReadyDeclaration,
  type RoundSummary,
} from '@runcastle/core'
import { CHAT_ACTION } from './next-step/chat'
import type { ActionKind, NextAction, NextStep } from './next-step/types'

/**
 * The feature's one status line (`the-feature-lead-runs-rounds` decision 21):
 * what the human reads at a glance, from a fixed set, read off what is actually
 * happening — there is no phase underneath (tickets-and-review-are-tools-not-phases
 * decisions 2, 7).
 */
export type FeatureStatusKind = 'talking' | 'working' | 'waiting' | 'ready' | 'merged'

/**
 * The one primary button the status line's row carries (decision 24): Start
 * test drive when ready, Stop drive while driving, Stop while a round runs,
 * Stop while the feature plans itself, the Chat door once the agent's run
 * failed — and none in any other state.
 */
export type StatusPrimary = 'testDriveStart' | 'testDriveStop' | 'stop' | 'stopSelfPlan' | 'chat'

export interface FeatureStatus {
  kind: FeatureStatusKind
  /** The words before any reason: "Working · Round 3", "Waiting for you". */
  label: string
  /** The words after the label: why the agent waits, or the drive it asks for. */
  why?: string
  /** The round in flight, or the last one the agent is checking. */
  round?: number
  /** The drive the agent asked for. */
  scenario?: string
  /** The row's one primary; absent when this state has none. */
  primary?: StatusPrimary
}

export interface FeatureStatusInput {
  feature: Pick<Feature, 'status' | 'waitingReason'>
  /** The feature's rounds in order, as `feature.rounds` returns them. */
  rounds: readonly Pick<RoundSummary, 'round' | 'status' | 'startedAt'>[]
  /** Every ready declaration, oldest first, as `feature.readyDeclarations` returns them. */
  declarations: readonly Pick<ReadyDeclaration, 'scenario' | 'createdAt'>[]
  /** The agent's session is mid-turn — working on something it was sent. */
  agentWorking: boolean
  /** A drive of this feature holds the drive slot right now. */
  driving: boolean
  /**
   * The feature's live session is a self-planning run (headless chat, purpose
   * `self-plan`), or Plan it yourself was just clicked and that run is launching.
   */
  selfPlanning: boolean
  /** The lead's latest wake and wake failure, as {@link leadWakeOf} reads them off the event log. */
  leadWake?: LeadWake
  /** The wall clock, passed in so a pending wake's grace is testable. */
  now: number
}

/** The lead's wakes as the event log tells them. */
export interface LeadWake {
  /** When the newest message for the lead was queued, left pending, or woke it headless. */
  pendingSince?: number
  /** The newest `lead.wake_failed`: when, and the process's exit code (null when unknown). */
  failed?: { at: number; exitCode: number | null }
  /** When the session the newest headless wake started ended — the human's End session, or its own exit. */
  endedAt?: number
}

/**
 * How long a message for the lead counts as the agent about to work: long
 * enough for a headless resume to spawn and check in, short enough that a wake
 * that silently went nowhere stops reading as Working within a minute.
 */
export const LEAD_WAKE_GRACE_MS = 60_000

/** The events that put a message on its way to the lead (`services/lead-delivery.ts`). */
const WAKE_EVENTS: ReadonlySet<string> = new Set(['lead.message_queued', 'lead.message_pending', 'lead.woken_headless'])

/** The events that say a session is over: the human ended it, or its process exited. */
const SESSION_END_EVENTS: ReadonlySet<string> = new Set(['session.ended', 'session.pty_exited'])

/** Read the lead's latest wake and wake failure off a feature's event log, oldest first. */
export function leadWakeOf(events: readonly Pick<EventRow, 'type' | 'ts' | 'data'>[]): LeadWake {
  const wake: LeadWake = {}
  let woken: string | undefined
  for (const e of events) {
    const sessionId = (e.data as { sessionId?: unknown } | undefined)?.sessionId
    if (WAKE_EVENTS.has(e.type)) {
      wake.pendingSince = e.ts
      if (e.type === 'lead.woken_headless' && typeof sessionId === 'string') {
        woken = sessionId
        delete wake.endedAt
      }
    } else if (SESSION_END_EVENTS.has(e.type) && woken !== undefined && sessionId === woken) {
      wake.endedAt ??= e.ts
    } else if (e.type === LEAD_WAKE_FAILED) {
      const data = LeadWakeFailedData.safeParse(e.data)
      wake.failed = { at: e.ts, exitCode: data.success ? data.data.exitCode : null }
    }
  }
  return wake
}

/** The reason an idle agent waits on after the human stopped its round. */
export const STOPPED = 'stopped'

/** The line for a feature with nothing running and nothing asked. */
export const TALKING = 'Talking with you'

/** The reason when the lead's latest wake failed to launch or died in its turn. */
export function wakeFailedWhy(exitCode: number | null): string {
  return exitCode === null ? 'the agent’s run failed' : `the agent’s run failed (exit ${exitCode})`
}

/**
 * Derive the line, and the one primary its row carries. Precedence, highest first:
 *
 * - Merged — shipped is final.
 * - Working · Round N — a round is running; nothing else is true until it returns.
 * - Planning by itself — a self-planning run is live.
 * - Ready for you · Test drive ▸ <scenario> — the latest declaration is newer
 *   than the latest round, and the agent is not working on something since
 *   (notes the human sent wake it, and it is Working again). Read before the
 *   waiting reason, because declaring ready sets it ("ready to test").
 * - Waiting for you · <why> — the agent said it needs the human (a question,
 *   stuck, stopped, provider limit). The next human message or dispatch clears it.
 * - Working · Round N — only on evidence: the agent's session is mid-turn, or a
 *   message for it went out less than {@link LEAD_WAKE_GRACE_MS} ago.
 * - Waiting for you · the agent's run failed — the newest `lead.wake_failed` is
 *   newer than the last round and the last wake.
 * - Waiting for you · stopped / round N failed / round N done — the last round
 *   returned and the agent's turn is over: nothing is running and nothing will
 *   be dispatched until the human replies.
 * - Talking with you — otherwise: nothing running and nothing asked.
 *
 * The primary follows the state: Stop drive while this feature is driven, Stop
 * while a round runs, Stop the run while the feature plans itself, Start test
 * drive when ready, and the Chat door to resume an agent whose run failed (set
 * by the status itself).
 */
export function featureStatus(input: FeatureStatusInput): FeatureStatus {
  const status = statusOf(input)
  const primary = primaryOf(input, status)
  return primary ? { ...status, primary } : status
}

function primaryOf(input: FeatureStatusInput, status: FeatureStatus): StatusPrimary | undefined {
  if (status.kind === 'merged') return undefined
  if (input.driving) return 'testDriveStop'
  if (input.rounds.at(-1)?.status === 'running') return 'stop'
  if (input.selfPlanning) return 'stopSelfPlan'
  if (status.kind === 'ready') return 'testDriveStart'
  return undefined
}

function statusOf(input: FeatureStatusInput): FeatureStatus {
  const { feature, rounds, declarations, agentWorking } = input
  if (feature.status === 'shipped') return { kind: 'merged', label: 'Merged' }

  const latest = rounds.at(-1)
  const working = (): FeatureStatus => {
    const round = latest?.round ?? 1
    return { kind: 'working', label: `Working · Round ${round}`, round }
  }
  if (latest?.status === 'running') return working()

  if (input.selfPlanning) return { kind: 'working', label: 'Planning by itself' }

  const declared = declarations.at(-1)
  if (declared && !agentWorking && (!latest || declared.createdAt > latest.startedAt)) {
    return {
      kind: 'ready',
      label: 'Ready for you',
      why: `Test drive ▸ ${declared.scenario}`,
      scenario: declared.scenario,
    }
  }

  if (feature.waitingReason) return { kind: 'waiting', label: 'Waiting for you', why: feature.waitingReason }

  // Working needs evidence: the agent mid-turn, or a message on its way to it
  // that has not had time to wake it yet. A wake that went nowhere must not
  // read as Working forever, and one that already failed, or whose session
  // already ended, is not on its way: either ends the grace at once.
  const pendingSince = input.leadWake?.pendingSince
  const failed = input.leadWake?.failed
  const failedSinceWake = !!failed && failed.at >= (pendingSince ?? -Infinity)
  const endedAt = input.leadWake?.endedAt
  const endedSinceWake = endedAt !== undefined && endedAt >= (pendingSince ?? -Infinity)
  const waking =
    pendingSince !== undefined && !failedSinceWake && !endedSinceWake && input.now - pendingSince < LEAD_WAKE_GRACE_MS
  if (agentWorking || waking) return working()

  if (failed && failedSinceWake && failed.at > (latest?.startedAt ?? -Infinity)) {
    return { kind: 'waiting', label: 'Waiting for you', why: wakeFailedWhy(failed.exitCode), primary: 'chat' }
  }
  // Once a round has returned and the agent's turn is over, nothing runs and
  // nobody works: a stopped or failed round wakes nobody to finish it (Stop
  // marks the feature stopped, a provider-limit halt is not woken — decision
  // 15), and an agent that reported a succeeded round without declaring ready
  // is waiting on the human's reply. Nothing moves until the human replies.
  if (latest) {
    const why =
      latest.status === 'cancelled'
        ? STOPPED
        : latest.status === 'failed'
          ? `round ${latest.round} failed`
          : `round ${latest.round} done`
    return { kind: 'waiting', label: 'Waiting for you', why }
  }
  return { kind: 'talking', label: TALKING }
}

/** What each primary reads as, and the dispatcher kind it fires. */
const PRIMARY_ACTION: Record<StatusPrimary, NextAction> = {
  testDriveStart: { label: 'Start test drive', kind: 'testDriveStart' },
  testDriveStop: { label: 'Stop drive', kind: 'testDriveStop' },
  stop: { label: 'Stop', kind: 'stopAgent', danger: true },
  stopSelfPlan: { label: 'Stop', kind: 'stopHeadlessRun', danger: true },
  chat: CHAT_ACTION,
}

const MERGE: NextAction = { label: 'Merge & ship', kind: 'merge' }

/**
 * Kinds the row never offers beside the status line: Stop is the one move that
 * halts the agent, and the agent is the top bar's Agent tab, not a button in
 * the header (decision 24) — save as the primary that resumes an agent whose
 * run failed.
 */
const NEVER_OFFERED: readonly ActionKind[] = ['chat']

/**
 * The action row beside the status line (decision 24): exactly the status's one
 * primary, Merge & ship always as the secondary, and every other action the
 * resolver chose after it — {@link headerActions} spreads it over the page's
 * one header row. The resolver's own action of the primary's kind is
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

/** Where {@link leadActions}' row goes on the feature page's one header (design-mode decision 12). */
export interface HeaderActions {
  /** The header's one button besides the switcher, if any. */
  action?: NextAction
  /** Everything else the row offered, for the header's "⋯" menu. */
  overflow: NextAction[]
}

/**
 * Split {@link leadActions}' row over the one header row (decision 12): the
 * status's primary takes the header's one button, and with no primary Merge &
 * ship takes it, but only when the resolver `ns` itself offered a merge. Every
 * other action, a Merge the resolver did not offer among them, waits in "⋯".
 */
export function headerActions(ns: NextStep, status: FeatureStatus): HeaderActions {
  const row = leadActions(ns, status)
  const offersMerge = [ns.primary, ...ns.secondary].some((a) => a?.kind === 'merge')
  const action = row.primary ?? (offersMerge ? row.secondary.find((a) => a.kind === 'merge') : undefined)
  return {
    ...(action ? { action } : {}),
    overflow: row.secondary.filter((a) => a !== action),
  }
}
