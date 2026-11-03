import * as z from 'zod'
import type { FeatureStatus } from './schemas'

/**
 * What a feature needs from the human (you-always-know-what-s-waiting decisions
 * 1, 14, 17, 18): one need from a fixed set, worked out once from plain facts so
 * the sidebar, the header, the chat, the palette, the tab title and the pings
 * all read the same answer. Pure: the server gathers {@link NeedFacts}, this
 * module decides.
 */

/** The needs, most pressing first (decision 17): the order {@link featureNeed} picks in. */
export const NEED_KINDS = ['permission', 'conflict', 'answer', 'plan', 'design', 'stopped', 'test', 'merge'] as const
export type NeedKind = (typeof NEED_KINDS)[number]

/**
 * Which kind of wait the lead's `wait_for_you` says it is (decision 2). A reason
 * with no kind is an answer, so agents that predate the kind keep working.
 */
export const WaitingKind = z.enum(['answer', 'plan', 'design', 'stuck'])
export type WaitingKind = z.infer<typeof WaitingKind>

/** How long a need its orchestrator holds stays the orchestrator's before it comes to the human (decision 18). */
export const HELD_NEED_GRACE_MS = 60 * 60_000

/** The waiting reason the human's Stop sets. */
export const STOPPED = 'stopped'

/** The waiting reason a self-planning run that stopped short sets: the chat picks it up with the lead. */
export const PLANNING_STOPPED = 'planning stopped'

/** The waiting reason a round halted by the provider's usage limit sets. */
export const PROVIDER_LIMIT = 'provider limit'

/** The waiting reason `declareReady` sets; the ready declaration speaks for it. */
export const READY_TO_TEST = 'ready to test'

/** The words after "Stopped ·" when the human pressed Stop themselves — the one stop that never pings. */
export const YOU_STOPPED_IT = 'you stopped it'

/** The words before a held need's own words. */
export const HELD_PREFIX = 'With the orchestrator · '

/** The reason when the lead's latest wake failed to launch or died in its turn. */
export function wakeFailedWhy(exitCode: number | null): string {
  return exitCode === null ? 'the agent’s run failed' : `the agent’s run failed (exit ${exitCode})`
}

/** Everything {@link featureNeed} decides from. Every `since`/`at` is ms since the epoch. */
export interface NeedFacts {
  status: FeatureStatus
  /** An orchestrator thread holds the feature. */
  held: boolean
  /** A round runs, or the lead is mid-turn: nothing is waited on but a permission prompt. */
  agentWorking: boolean
  /** The feature's waiting reason, its kind, and when it was set. */
  waiting: { reason: string; kind: WaitingKind | null; since: number } | null
  /** The lead replied, or asks, and the human has not answered; `since` is when its turn ended. */
  leadAwaitsHuman: { since: number } | null
  /** An open ask in one of the feature's threads; an approval is a permission prompt. */
  openAsk: { kind: 'approval' | 'question'; title: string; threadId: string; since: number } | null
  /** When a merge stopped on a conflict that no landing or resolution has cleared since. */
  conflictSince: number | null
  /** The newest ready declaration. */
  declaration: { scenario: string; at: number } | null
  /** When the newest round started. */
  latestRoundStartedAt: number | null
  /** When the newest test drive the human (not a review) ran of this feature ended. */
  humanDriveEndedAt: number | null
  /** When a human message last reached the lead. */
  humanMessageAt: number | null
  /** The project has a test drive set up. */
  driveConfigured: boolean
  /** The newest failed lead wake. */
  wakeFailed: { at: number; exitCode: number | null } | null
  /** When the newest message for the lead was queued. */
  wakeQueuedAt: number | null
  /** How many recorded designs wait for the human (designs-and-the-plan decision 17). */
  designsWaiting: number
  /** When the oldest of them was last shown; null when none waits. */
  oldestDesignWaitingSince: number | null
}

/** The one thing a feature waits on the human for. */
export interface FeatureNeed {
  kind: NeedKind
  /** What the sidebar row, the status line and the ping say: "Plan to approve", "With the orchestrator · Merge conflict". */
  words: string
  /** The words after "·": the reason, the call's title, the scenario. */
  why?: string
  /** Its orchestrator handles it: not Needs you, no ping, until {@link HELD_NEED_GRACE_MS} has passed. */
  held: boolean
  /** When this need began. */
  since: number
  /** The thread an ask waits in, to bring to the front. */
  threadId?: string
  /** The drive to start, for `test`. */
  scenario?: string
  /**
   * An answer the lead only implied by ending its turn: no `wait_for_you`, no
   * ask. It shows and counts like any need, but never pings (decision 20): a
   * back-and-forth in the chat would otherwise buzz the phone on every reply.
   */
  quiet?: true
}

/** The needs an orchestrator can answer itself; a permission prompt and a design need the human's own eyes. */
const HOLDABLE: ReadonlySet<NeedKind> = new Set(['answer', 'plan', 'stopped', 'conflict', 'test', 'merge'])

type Bare = Omit<FeatureNeed, 'words' | 'held'>

/** The words of a bare need, before any held prefix. */
function wordsOf(need: Bare): string {
  switch (need.kind) {
    case 'permission':
      return `Needs permission · ${need.why}`
    case 'conflict':
      return 'Merge conflict'
    case 'answer':
      return need.why ? `Needs your answer · ${need.why}` : 'Needs your answer'
    case 'plan':
      return 'Plan to approve'
    case 'design':
      return 'Design to approve'
    case 'stopped':
      return `Stopped · ${need.why}`
    case 'test':
      return `Ready to test · ${need.why}`
    case 'merge':
      return 'Ready to merge'
  }
}

/** Why a stop reason reads the way it does after "Stopped ·". */
function stoppedWhy(reason: string): string {
  if (reason === STOPPED) return YOU_STOPPED_IT
  if (reason === PROVIDER_LIMIT) return 'the provider’s limit'
  return reason
}

/** A waiting reason that stops the feature rather than asks something. */
function isStopReason(reason: string, kind: WaitingKind | null): boolean {
  return kind === 'stuck' || reason === STOPPED || reason === PROVIDER_LIMIT || reason === PLANNING_STOPPED
}

/** The ready declaration, when it is newer than the newest round. */
function freshDeclaration(facts: NeedFacts): NeedFacts['declaration'] {
  const d = facts.declaration
  return d && d.at > (facts.latestRoundStartedAt ?? -Infinity) ? d : null
}

/** Each need's candidate, in precedence order; the first that applies wins. */
function candidates(facts: NeedFacts): Array<() => Bare | null> {
  const idle = !facts.agentWorking
  const waiting = facts.waiting
  const ready = freshDeclaration(facts)
  const waitingKind = waiting && waiting.reason !== READY_TO_TEST
    ? isStopReason(waiting.reason, waiting.kind) ? 'stopped' : (waiting.kind ?? 'answer')
    : null
  return [
    () => facts.openAsk?.kind === 'approval'
      ? { kind: 'permission', why: facts.openAsk.title, since: facts.openAsk.since, threadId: facts.openAsk.threadId }
      : null,
    () => facts.conflictSince !== null ? { kind: 'conflict', since: facts.conflictSince } : null,
    () => {
      if (facts.openAsk?.kind === 'question') {
        const why = waitingKind === 'answer' ? waiting!.reason : facts.openAsk.title
        return { kind: 'answer', ...(why ? { why } : {}), since: facts.openAsk.since, threadId: facts.openAsk.threadId }
      }
      if (!idle) return null
      if (waitingKind === 'answer') return { kind: 'answer', why: waiting!.reason, since: waiting!.since }
      // A lead that declared ready waits on the drive, not on an answer.
      if (!waiting && !ready && facts.leadAwaitsHuman) return { kind: 'answer', since: facts.leadAwaitsHuman.since, quiet: true }
      return null
    },
    () => idle && waitingKind === 'plan' ? { kind: 'plan', since: waiting!.since } : null,
    () => {
      // From the design record, so it needs no `wait_for_you`; the lead's design wait still counts.
      if (!idle) return null
      if (waitingKind === 'design') return { kind: 'design', since: waiting!.since }
      if (facts.designsWaiting > 0) return { kind: 'design', since: facts.oldestDesignWaitingSince ?? 0 }
      return null
    },
    () => {
      if (!idle) return null
      if (waitingKind === 'stopped') return { kind: 'stopped', why: stoppedWhy(waiting!.reason), since: waiting!.since }
      const failed = facts.wakeFailed
      if (
        failed &&
        failed.at >= (facts.wakeQueuedAt ?? -Infinity) &&
        failed.at > (facts.latestRoundStartedAt ?? -Infinity)
      ) {
        return { kind: 'stopped', why: wakeFailedWhy(failed.exitCode), since: failed.at }
      }
      return null
    },
    () => {
      if (!idle || !ready) return null
      if (!facts.driveConfigured) return { kind: 'merge', since: ready.at }
      const drove = facts.humanDriveEndedAt
      if (drove !== null && drove > ready.at && !((facts.humanMessageAt ?? -Infinity) > drove)) {
        return { kind: 'merge', since: drove }
      }
      return { kind: 'test', why: ready.scenario, scenario: ready.scenario, since: ready.at }
    },
  ]
}

/**
 * The one need a feature shows, or null when it waits on nobody (decisions 1,
 * 17, 18). Only a started feature can need anything. While a round runs or the
 * lead is mid-turn, only an open ask (it halts the agent where it stands) or a
 * standing merge conflict counts.
 * A held need reads "With the orchestrator · …" until it has waited
 * {@link HELD_NEED_GRACE_MS}; a permission prompt and a design are never held.
 */
export function featureNeed(facts: NeedFacts, now: number): FeatureNeed | null {
  if (facts.status !== 'active') return null
  for (const candidate of candidates(facts)) {
    const bare = candidate()
    if (!bare) continue
    const words = wordsOf(bare)
    const held = facts.held && HOLDABLE.has(bare.kind) && now - bare.since < HELD_NEED_GRACE_MS
    return { ...bare, words: held ? `${HELD_PREFIX}${words}` : words, held }
  }
  return null
}

/**
 * The one event pings hang off (decisions 11 to 14): emitted when a feature
 * enters a need it was not in, and when a held need passes its hour.
 */
export const FEATURE_NEEDS_YOU = 'feature.needs_you'

/** What a {@link FEATURE_NEEDS_YOU} event carries. */
export interface NeedsYouData {
  kind: NeedKind
  words: string
  held: boolean
  why: string | null
  /** A bare reply's answer ({@link FeatureNeed.quiet}): news, but no ping. */
  quiet?: true
}

/**
 * Whether a {@link FEATURE_NEEDS_YOU} event's data pings the human, on the
 * desktop and the phone alike (decisions 11, 12, 18, 20): every need that is
 * not held, except the stop the human made themselves and a bare reply's answer. One rule, so the web and
 * the server cannot disagree. Malformed data never pings.
 */
export function needPings(data: unknown): data is NeedsYouData {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  if (typeof d.kind !== 'string' || !(NEED_KINDS as readonly string[]).includes(d.kind)) return false
  if (typeof d.words !== 'string' || d.held !== false || d.quiet === true) return false
  return !(d.kind === 'stopped' && d.why === YOU_STOPPED_IT)
}
