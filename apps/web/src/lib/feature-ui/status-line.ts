import {
  LEAD_WAKE_FAILED,
  LeadWakeFailedData,
  type EventRow,
  type Feature,
  type FeatureNeed,
  type NeedKind,
  type RoundSummary,
  type ThreadEntry,
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
 * The one primary button the status line's row carries: Stop drive while
 * driving, Stop while a round runs, Stop while the feature plans itself, and
 * otherwise the button of what the feature needs (you-always-know-what-s-waiting
 * decision 1) — none while nothing is needed.
 */
export type StatusPrimary =
  | 'testDriveStart'
  | 'testDriveStop'
  | 'stop'
  | 'stopSelfPlan'
  | 'chat'
  | 'reply'
  | 'openPlan'
  | 'openDesign'
  | 'showRequest'
  | 'resolveConflict'
  | 'merge'

export interface FeatureStatus {
  kind: FeatureStatusKind
  /** The words before any reason: "Working · Round 3", "Plan to approve", "Needs your answer". */
  label: string
  /** The words after the label: why the agent waits, the call it asks for, the drive. */
  why?: string
  /** The round in flight, or the last one the agent is checking. */
  round?: number
  /** The drive the agent asked for. */
  scenario?: string
  /** The need its orchestrator is handling ("With the orchestrator · …"): a quiet dot, not a warning. */
  held?: boolean
  /** The row's one primary; absent when this state has none. */
  primary?: StatusPrimary
}

export interface FeatureStatusInput {
  feature: Pick<Feature, 'status'>
  /** What the feature needs from the human, as the server worked it out (`feature.get`'s `need`). */
  need: FeatureNeed | null
  /** The feature's rounds in order, as `feature.rounds` returns them. */
  rounds: readonly Pick<RoundSummary, 'round' | 'status' | 'startedAt'>[]
  /** The agent's session is mid-turn — working on something it was sent. */
  agentWorking: boolean
  /**
   * `agentWorking` is the main chat's own thread state, as the thread list and
   * the sidebar read it. It is then the whole truth: a wake starts that chat,
   * so its log already says whether it works, and a wake earns no grace.
   */
  agentStateKnown?: boolean
  /** A drive of this feature holds the drive slot right now. */
  driving: boolean
  /**
   * The feature's live session is a self-planning run (an unattended chat, purpose
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
  /** When the newest message for the lead was queued. */
  pendingSince?: number
  /** The newest `lead.wake_failed`: when, and the process's exit code (null when unknown). */
  failed?: { at: number; exitCode: number | null }
}

/**
 * How long a message for the lead counts as the agent about to work: long
 * enough for the chat to start and take it, short enough that a wake
 * that silently went nowhere stops reading as Working within a minute.
 */
export const LEAD_WAKE_GRACE_MS = 60_000

/**
 * {@link FeatureStatusInput.agentWorking}: the main chat's own thread state,
 * which every `thread` live signal refreshes, so a turn's end (a lead wake's
 * too) leaves Working at once; the session row's turn bit only until the
 * thread list holds the main chat.
 */
export function mainChatWorking(
  mainState: ThreadEntry['state'] | undefined,
  session: { awaitingInput: boolean } | undefined,
): boolean {
  return mainState !== undefined ? mainState === 'working' : !!session && !session.awaitingInput
}

/** Read the lead's latest wake and wake failure off a feature's event log, oldest first. */
export function leadWakeOf(events: readonly Pick<EventRow, 'type' | 'ts' | 'data'>[]): LeadWake {
  const wake: LeadWake = {}
  for (const e of events) {
    // `lead.message_queued` puts a message on its way to the lead (`services/lead-delivery.ts`).
    if (e.type === 'lead.message_queued') {
      wake.pendingSince = e.ts
    } else if (e.type === LEAD_WAKE_FAILED) {
      const data = LeadWakeFailedData.safeParse(e.data)
      wake.failed = { at: e.ts, exitCode: data.success ? data.data.exitCode : null }
    }
  }
  return wake
}

/** The waiting reasons and wake-failure words are core's (one answer, worked out on the server). */
export { PLANNING_STOPPED, STOPPED, wakeFailedWhy } from '@runcastle/core'

/** The line for a feature with nothing running and nothing asked. */
export const TALKING = 'Talking with you'

/** Each need's button (decision 1): the primary beside the status line when nothing runs. */
const NEED_PRIMARY: Record<NeedKind, StatusPrimary> = {
  permission: 'showRequest',
  conflict: 'resolveConflict',
  answer: 'reply',
  plan: 'openPlan',
  design: 'openDesign',
  stopped: 'chat',
  test: 'testDriveStart',
  merge: 'merge',
}

/** Needs that halt the agent where it stands, so they show even while it works. */
const SHOWN_WHILE_WORKING: ReadonlySet<NeedKind> = new Set(['permission', 'conflict'])

/**
 * The status line of a need: its words split at the first "·" into the label
 * and the reason after it, so "Needs permission · Bash: git push" and "With the
 * orchestrator · Plan to approve" read the same as on the sidebar row.
 */
function needStatus(need: FeatureNeed): FeatureStatus {
  const cut = need.words.indexOf(' · ')
  const label = cut < 0 ? need.words : need.words.slice(0, cut)
  const why = cut < 0 ? undefined : need.words.slice(cut + ' · '.length)
  return {
    kind: need.kind === 'test' || need.kind === 'merge' ? 'ready' : 'waiting',
    label,
    ...(why ? { why } : {}),
    ...(need.scenario ? { scenario: need.scenario } : {}),
    ...(need.held ? { held: true } : {}),
    primary: NEED_PRIMARY[need.kind],
  }
}

/**
 * Derive the line, and the one primary its row carries. Precedence, highest first:
 *
 * - Merged — shipped is final.
 * - Working · Round N — a round is running; nothing else is true until it returns.
 * - Planning by itself — a self-planning run is live.
 * - The need (you-always-know-what-s-waiting decisions 1, 17, 18) — the
 *   server's `need`, in the sidebar row's own words: "Plan to approve", "Needs
 *   permission · Bash: git push", "Ready to test · <scenario>", "With the
 *   orchestrator · Ready to merge". Test and merge read as ready, the rest as
 *   waiting. While the main chat is mid-turn only a permission prompt or a
 *   merge conflict shows: the rest are the server's view before the turn began.
 * - Working · Round N — only on evidence: the agent's session is mid-turn, or a
 *   message for it went out less than {@link LEAD_WAKE_GRACE_MS} ago.
 * - Talking with you — otherwise: nothing running and nothing asked.
 *
 * The primary follows the state: Stop drive while this feature is driven, Stop
 * while a round runs, Stop the run while the feature plans itself, and the
 * need's own button otherwise.
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
  return undefined
}

function statusOf(input: FeatureStatusInput): FeatureStatus {
  const { feature, rounds, need, agentWorking } = input
  if (feature.status === 'shipped') return { kind: 'merged', label: 'Merged' }

  const latest = rounds.at(-1)
  // Before any round, an agent at work is just working: there is no round to name.
  const working = (): FeatureStatus =>
    latest ? { kind: 'working', label: `Working · Round ${latest.round}`, round: latest.round } : { kind: 'working', label: 'Working' }
  if (latest?.status === 'running') return working()

  if (input.selfPlanning) return { kind: 'working', label: 'Planning by itself' }

  if (need && (!agentWorking || SHOWN_WHILE_WORKING.has(need.kind))) return needStatus(need)

  // Working needs evidence: the agent mid-turn, or a message on its way to it
  // that has not had time to wake it yet. A wake that went nowhere must not
  // read as Working forever, and one that already failed is not on its way:
  // it ends the grace at once.
  const pendingSince = input.leadWake?.pendingSince
  const failed = input.leadWake?.failed
  const failedSinceWake = !!failed && failed.at >= (pendingSince ?? -Infinity)
  const waking =
    !input.agentStateKnown &&
    pendingSince !== undefined &&
    !failedSinceWake &&
    input.now - pendingSince < LEAD_WAKE_GRACE_MS
  if (agentWorking || waking) return working()

  // Nothing runs and nothing is asked: the sidebar files this under In progress.
  return { kind: 'talking', label: TALKING }
}

const MERGE: NextAction = { label: 'Merge & ship', kind: 'merge' }
const TEST_DRIVE: NextAction = { label: 'Start test drive', kind: 'testDriveStart' }

/** What each primary reads as, and the dispatcher kind it fires. */
const PRIMARY_ACTION: Record<StatusPrimary, NextAction> = {
  testDriveStart: TEST_DRIVE,
  testDriveStop: { label: 'Stop drive', kind: 'testDriveStop' },
  stop: { label: 'Stop', kind: 'stopAgent', danger: true },
  stopSelfPlan: { label: 'Stop', kind: 'stopSelfPlan', danger: true },
  chat: CHAT_ACTION,
  reply: { label: 'Reply', kind: 'reply' },
  openPlan: { label: 'Open plan', kind: 'openPlan' },
  openDesign: { label: 'Open design', kind: 'openDesign' },
  showRequest: { label: 'Show request', kind: 'showRequest' },
  resolveConflict: { label: 'Resolve conflict', kind: 'resolveConflict' },
  merge: MERGE,
}

/**
 * Kinds the row never offers beside the status line: the agent is the chat,
 * not a button in the header (decision 24) — save as the primary of a stopped
 * feature, which resumes the agent.
 */
const NEVER_OFFERED: readonly ActionKind[] = ['chat']

/**
 * The action row beside the status line: exactly the status's one primary,
 * Merge & ship always as the secondary (you-always-know-what-s-waiting decision
 * 6) unless it is the primary itself, and every other action the resolver chose
 * after it — {@link headerActions} spreads it over the page's one header row.
 * Ready to merge puts Start test drive after Merge, for "⋯". The resolver's own
 * action of the primary's kind is kept when it has one, so a refusal it carries
 * (another feature holds the drive slot) still disables the button and says why.
 */
export function leadActions(ns: NextStep, status: FeatureStatus): NextStep {
  const offered = [...(ns.primary ? [ns.primary] : []), ...ns.secondary]
  const own = (kind: ActionKind) => offered.find((a) => a.kind === kind)
  const choice = status.primary ? PRIMARY_ACTION[status.primary] : undefined
  const primary = choice ? { ...own(choice.kind), ...choice } : undefined
  const merge = status.kind === 'merged' || primary?.kind === 'merge' ? [] : [own('merge') ?? MERGE]
  const drive = primary?.kind === 'merge' && !own(TEST_DRIVE.kind) ? [TEST_DRIVE] : []
  const rest = offered.filter(
    (a) => a.kind !== 'merge' && a.kind !== primary?.kind && !NEVER_OFFERED.includes(a.kind),
  )
  const { primary: _was, ...base } = ns
  return { ...base, ...(primary ? { primary } : {}), secondary: [...merge, ...drive, ...rest] }
}

/** Where {@link leadActions}' row goes on the feature page's one header (design-mode decision 12). */
export interface HeaderActions {
  /** The header's main button: the status's primary, if any. */
  action?: NextAction
  /** Merge & ship, quiet beside it — absent once merged, or when it is {@link action} itself. */
  merge?: NextAction
  /** Everything else the row offered, for the header's "⋯" menu. */
  overflow: NextAction[]
}

/**
 * Split {@link leadActions}' row over the one header row (you-always-know-what-
 * s-waiting decision 6): the status's primary takes the main button, Merge &
 * ship always sits beside it on an unshipped feature, and every other action
 * waits in "⋯".
 */
export function headerActions(ns: NextStep, status: FeatureStatus): HeaderActions {
  const row = leadActions(ns, status)
  const merge = row.secondary.find((a) => a.kind === 'merge')
  return {
    ...(row.primary ? { action: row.primary } : {}),
    ...(merge ? { merge } : {}),
    overflow: row.secondary.filter((a) => a !== merge),
  }
}

/**
 * The header's button for the need, for the chat's waiting line (decision 4):
 * the header's primary when it is the need's own (not Stop while something
 * runs), and none for an answer, whose message box is right below the line.
 */
export function needButton(need: FeatureNeed, header: HeaderActions): NextAction | undefined {
  if (need.kind === 'answer') return undefined
  const own = PRIMARY_ACTION[NEED_PRIMARY[need.kind]].kind
  return header.action?.kind === own ? header.action : undefined
}
