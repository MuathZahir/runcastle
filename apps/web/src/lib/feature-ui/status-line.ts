import type { Feature, Need, ThreadEntry } from '@runcastle/core'
import { CHAT_ACTION } from './next-step/chat'
import type { ActionKind, NextAction, NextStep } from './next-step/types'

/**
 * The feature's one status line (needs-you-is-the-agent-s-call decision 15):
 * "Needs you · <the agent's line>", "Working", "Idle" or "Merged"; an archived
 * feature reads its shelf. No phase words, no need kinds.
 */
export type FeatureStatusKind = 'needsYou' | 'working' | 'idle' | 'merged' | 'shelf'

/**
 * The one primary button the status line's row carries: Stop drive while
 * driving, Start test drive once the agent declared ready, Stop while workers
 * work, Stop while the feature plans itself; none otherwise.
 */
export type StatusPrimary = 'testDriveStart' | 'testDriveStop' | 'stop' | 'stopSelfPlan'

export interface FeatureStatus {
  kind: FeatureStatusKind
  /** "Needs you", "Working", "Idle", "Merged", "Archived". */
  label: string
  /** Needs you only: the agent's line (decision 3). */
  why?: string
  /** Needs you only: the chat the question waits in, which a click opens (decision 12). */
  threadId?: string
  /** The row's one primary; absent when this state has none. */
  primary?: StatusPrimary
  /** The Stop that Start test drive pushed off the primary: it waits in "⋯", still one click away. */
  stop?: 'stop' | 'stopSelfPlan'
}

export interface FeatureStatusInput {
  feature: Pick<Feature, 'status'>
  /** What the feature needs from the human (`feature.get`'s `need`). */
  need: Need | null
  /** The server's answer: the lead mid-turn, its background work, or a worker's turn running. */
  working: boolean
  /** The main chat's own thread state, fresher than the server's answer between polls. */
  agentWorking: boolean
  /** How many of the feature's workers are working or queued (`worker.list`): Stop cancels their turns. */
  workersWorking: number
  /** A drive of this feature holds the drive slot right now. */
  driving: boolean
  /** A self-planning run is live, or Plan it yourself was just clicked. */
  selfPlanning: boolean
  /** The agent declared the feature ready to test (`declare_ready`): Start test drive leads. */
  declared: boolean
}

/**
 * The main chat's own thread state, which every `thread` live signal refreshes;
 * the session row's turn bit only until the thread list holds the main chat.
 */
export function mainChatWorking(
  mainState: ThreadEntry['state'] | undefined,
  session: { awaitingInput: boolean } | undefined,
): boolean {
  return mainState !== undefined ? mainState === 'working' : !!session && !session.awaitingInput
}

/** Needs you beats Working (decision 18); Merged and a shelf are final. */
function statusOf(input: FeatureStatusInput): FeatureStatus {
  const { feature, need } = input
  if (feature.status === 'shipped') return { kind: 'merged', label: 'Merged' }
  if (feature.status === 'archived') return { kind: 'shelf', label: 'Archived' }
  if (need) return { kind: 'needsYou', label: 'Needs you', why: need.why, threadId: need.threadId }
  const working = input.working || input.agentWorking || input.workersWorking > 0 || input.selfPlanning
  return working ? { kind: 'working', label: 'Working' } : { kind: 'idle', label: 'Idle' }
}

/** Derive the line, and the one primary its row carries. */
export function featureStatus(input: FeatureStatusInput): FeatureStatus {
  const status = statusOf(input)
  if (status.kind === 'merged' || status.kind === 'shelf') return status
  const stop = input.workersWorking > 0 ? 'stop' : input.selfPlanning ? 'stopSelfPlan' : undefined
  if (input.driving) return { ...status, primary: 'testDriveStop' }
  if (input.declared) return { ...status, primary: 'testDriveStart', ...(stop ? { stop } : {}) }
  return stop ? { ...status, primary: stop } : status
}

const MERGE: NextAction = { label: 'Merge & ship', kind: 'merge' }

/** What each primary reads as, and the dispatcher kind it fires. */
const PRIMARY_ACTION: Record<StatusPrimary, NextAction> = {
  testDriveStart: { label: 'Start test drive', kind: 'testDriveStart' },
  testDriveStop: { label: 'Stop drive', kind: 'testDriveStop' },
  stop: { label: 'Stop', kind: 'stopAgent', danger: true },
  stopSelfPlan: { label: 'Stop', kind: 'stopSelfPlan', danger: true },
}

/** Kinds the row never offers beside the status line: the agent is the chat, not a button in the header. */
const NEVER_OFFERED: readonly ActionKind[] = [CHAT_ACTION.kind]

/**
 * The action row beside the status line: exactly the status's one primary,
 * Merge & ship always as the secondary (you-always-know-what-s-waiting decision
 * 6), and every other action the resolver chose after it — {@link headerActions}
 * spreads it over the page's one header row. The resolver's own action of the
 * primary's kind is kept when it has one, so a refusal it carries (another
 * feature holds the drive slot) still disables the button and says why.
 */
export function leadActions(ns: NextStep, status: FeatureStatus): NextStep {
  const offered = [...(ns.primary ? [ns.primary] : []), ...ns.secondary]
  const own = (kind: ActionKind) => offered.find((a) => a.kind === kind)
  const choice = status.primary ? PRIMARY_ACTION[status.primary] : undefined
  const primary = choice ? { ...own(choice.kind), ...choice } : undefined
  const merge = status.kind === 'merged' ? [] : [own('merge') ?? MERGE]
  const pushed = status.stop ? PRIMARY_ACTION[status.stop] : undefined
  const stop = pushed && !own(pushed.kind) ? [pushed] : []
  const rest = offered.filter(
    (a) => a.kind !== 'merge' && a.kind !== primary?.kind && !NEVER_OFFERED.includes(a.kind),
  )
  const { primary: _was, ...base } = ns
  return { ...base, ...(primary ? { primary } : {}), secondary: [...merge, ...stop, ...rest] }
}

/** Where {@link leadActions}' row goes on the feature page's one header (design-mode decision 12). */
export interface HeaderActions {
  /** The header's main button: the status's primary, if any. */
  action?: NextAction
  /** Merge & ship, quiet beside it — absent once merged. */
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
