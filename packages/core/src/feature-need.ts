import * as z from 'zod'
import type { FeatureStatus } from './schemas'

/**
 * What a feature needs from the human (you-always-know-what-s-waiting decisions
 * 1, 14, 17, 18): one need from a fixed set, worked out once from plain facts so
 * the sidebar, the header, the chat, the palette, the tab title and the pings
 * all read the same answer. Pure: the server gathers {@link NeedFacts}, this
 * module decides.
 */

/**
 * The needs, most pressing first (decision 17): the order {@link featureNeed}
 * picks in. `handback` is the lead's outstanding handback to its orchestrator
 * (the-status-tells-the-truth decision 5), last of all.
 */
export const NEED_KINDS = ['permission', 'conflict', 'worker', 'answer', 'plan', 'design', 'stopped', 'test', 'merge', 'handback'] as const
export type NeedKind = (typeof NEED_KINDS)[number]

/**
 * Which kind of wait the lead's `wait_for_you` says it is (decision 2). A reason
 * with no kind is an answer, so agents that predate the kind keep working.
 */
export const WaitingKind = z.enum(['answer', 'plan', 'design', 'stuck'])
export type WaitingKind = z.infer<typeof WaitingKind>

/**
 * How long an outstanding handback keeps a need the orchestrator's before it
 * comes to the human (decision 18; the-status-tells-the-truth decision 2).
 */
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

/**
 * The words before a held need's own words: the chat that owns the feature
 * (every-feature-has-one-owner decision 15). "With <Chat>" only ever means the
 * chat owns it.
 */
export const heldPrefix = (chat: string): string => `With ${chat} · `

/**
 * The words before a human-owned feature's handback line while it is out to its
 * chat (every-feature-has-one-owner decision 20).
 */
export const askingPrefix = (chat: string): string => `Asking ${chat} · `

/** What a chat-owned feature reads while its chat asks the human about it, after {@link heldPrefix} (decision 17). */
export const ASKING_YOU = 'asking you'

/** The words before an outstanding handback's line once nothing holds it. */
export const HANDED_BACK_PREFIX = 'Handed back · '

/** How long a handback's line may run on a sidebar row or a status line. */
const HANDBACK_LINE_MAX = 80

/**
 * The line a handback reads by: the summary's first non-empty line, cut at its
 * first sentence's end and clipped to {@link HANDBACK_LINE_MAX} characters.
 */
export function handbackLine(summary: string): string {
  const line = summary.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '') ?? ''
  const end = line.search(/[.!?](\s|$)/)
  // A question or an exclamation keeps its mark; a full stop is dropped.
  const sentence = end > 0 ? line.slice(0, line[end] === '.' ? end : end + 1) : line
  return sentence.length > HANDBACK_LINE_MAX ? `${sentence.slice(0, HANDBACK_LINE_MAX - 1).trimEnd()}…` : sentence
}

/** A prefix's words alone, for a line with nothing after it ("Handed back"). */
const alone = (prefix: string): string => prefix.slice(0, -' · '.length)

/** The reason when the lead's latest wake failed to launch or died in its turn. */
export function wakeFailedWhy(exitCode: number | null): string {
  return exitCode === null ? 'the agent’s run failed' : `the agent’s run failed (exit ${exitCode})`
}

/** Everything {@link featureNeed} decides from. Every `since`/`at` is ms since the epoch. */
export interface NeedFacts {
  status: FeatureStatus
  /**
   * The orchestrator chat that owns the feature (holds it); null when the human
   * does (every-feature-has-one-owner decisions 15–17): its name, whether it is
   * asking the human about this feature now, and whether it is working.
   */
  owner: { chat: string; asking: boolean; working: boolean } | null
  /**
   * A human-owned feature's chat, by name, while its lead's handback is out to
   * it (decision 20); null otherwise.
   */
  askingChat: string | null
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
  /**
   * The worker that most recently came to need the human, by showing "needs
   * you" or by failing (interactive-workers decisions 6, 16); `since` is when.
   */
  workerNeedsYou: { label: string; threadId: string; since: number } | null
  /**
   * The lead's outstanding handback to its owner chat, or to its chat when the
   * human owns it (the-status-tells-the-truth decisions 5, 7;
   * every-feature-has-one-owner decision 20): when it handed back and what it
   * said. Null when it never did, or something has answered it since.
   */
  handback: { at: number; summary: string } | null
}

/** The one thing a feature waits on the human for. */
export interface FeatureNeed {
  kind: NeedKind
  /** What the sidebar row, the status line and the ping say: "Plan to approve", "With Notes triage · Merge conflict". */
  words: string
  /** The words after "·": the reason, the call's title, the scenario. */
  why?: string
  /**
   * A chat has it, not the human: it reads in Working, not Needs you, never
   * counts and never pings (every-feature-has-one-owner decisions 15–17, 20).
   * Everything a chat-owned feature needs, but a permission prompt and a
   * worker's question; and a human-owned feature's handback to its chat.
   */
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

/**
 * What only the feature itself can answer: never held, whoever owns it
 * (every-feature-has-one-owner decision 16) — a permission prompt in its
 * terminal and a "with you" worker's question.
 */
const NEVER_HELD: ReadonlySet<NeedKind> = new Set(['permission', 'worker'])

type Bare = Omit<FeatureNeed, 'words' | 'held'>

/** The words of a bare need, before any held prefix. */
function wordsOf(need: Bare): string {
  switch (need.kind) {
    case 'permission':
      return `Needs permission · ${need.why}`
    case 'conflict':
      return 'Merge conflict'
    case 'worker':
      return `${need.why} needs you`
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
    case 'handback':
      return need.why ? `${HANDED_BACK_PREFIX}${need.why}` : alone(HANDED_BACK_PREFIX)
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

/**
 * What a lead's wait asks for. Only the design record makes a design need
 * (small-fixes decision 3): a "design" wait while no recorded design waits —
 * a picture shown as a file, say — is an answer.
 */
function ownKind(kind: WaitingKind | null, designsWaiting: number): 'answer' | 'plan' | 'design' {
  if (kind === 'plan') return 'plan'
  if (kind === 'design' && designsWaiting > 0) return 'design'
  return 'answer'
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
    ? isStopReason(waiting.reason, waiting.kind) ? 'stopped' : ownKind(waiting.kind, facts.designsWaiting)
    : null
  return [
    () => facts.openAsk?.kind === 'approval'
      ? { kind: 'permission', why: facts.openAsk.title, since: facts.openAsk.since, threadId: facts.openAsk.threadId }
      : null,
    () => facts.conflictSince !== null ? { kind: 'conflict', since: facts.conflictSince } : null,
    // A worker waits on the human whatever its lead is doing, so this counts while the lead works.
    () => facts.workerNeedsYou
      ? { kind: 'worker', why: facts.workerNeedsYou.label, since: facts.workerNeedsYou.since, threadId: facts.workerNeedsYou.threadId }
      : null,
    () => {
      if (facts.openAsk?.kind === 'question') {
        const why = waitingKind === 'answer' ? waiting!.reason : facts.openAsk.title
        return { kind: 'answer', ...(why ? { why } : {}), since: facts.openAsk.since, threadId: facts.openAsk.threadId }
      }
      if (!idle) return null
      if (waitingKind === 'answer') return { kind: 'answer', why: waiting!.reason, since: waiting!.since }
      // A lead that declared ready waits on the drive, not on an answer; one that
      // handed back waits on its orchestrator, and its handback speaks for it.
      if (!waiting && !ready && !facts.handback && facts.leadAwaitsHuman) return { kind: 'answer', since: facts.leadAwaitsHuman.since, quiet: true }
      return null
    },
    () => idle && waitingKind === 'plan' ? { kind: 'plan', since: waiting!.since } : null,
    () => {
      // From the design record, so it needs no `wait_for_you`; a lead's design wait counts only while one waits.
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
    () => (idle && facts.handback ? { kind: 'handback', why: handbackLine(facts.handback.summary), since: facts.handback.at } : null),
  ]
}

/**
 * The hour safety net (the-status-tells-the-truth decision 2;
 * every-feature-has-one-owner decision 17): an outstanding handback its owner
 * chat has left for {@link HELD_NEED_GRACE_MS}, while the chat neither asks the
 * human about this feature nor works, comes back to the human.
 */
function lapsed(facts: NeedFacts, now: number): boolean {
  const { owner, handback } = facts
  return !!owner && !!handback && !owner.asking && !owner.working && now - handback.at >= HELD_NEED_GRACE_MS
}

/**
 * Whether a chat has this need now, not the human (every-feature-has-one-owner
 * decisions 16, 20): under an owner chat everything but what only the feature
 * can answer, until the safety net lapses; under the human only the handback
 * that is out to the feature's chat.
 */
function isHeld(facts: NeedFacts, need: Bare, now: number): boolean {
  if (NEVER_HELD.has(need.kind)) return false
  if (facts.owner) return !lapsed(facts, now)
  return need.kind === 'handback' && !!facts.askingChat
}

/** A held need's words: behind its owner chat's name, or, for a handback out to a human-owned feature's chat, asking it. */
function heldWords(facts: NeedFacts, need: Bare): string {
  if (!facts.owner) {
    const prefix = askingPrefix(facts.askingChat ?? '')
    return need.why ? `${prefix}${need.why}` : alone(prefix)
  }
  const prefix = heldPrefix(facts.owner.chat)
  if (facts.handback && facts.owner.asking) return `${prefix}${ASKING_YOU}`
  if (need.kind === 'handback') return need.why ? `${prefix}${need.why}` : alone(prefix)
  return `${prefix}${wordsOf(need)}`
}

/**
 * The one need a feature shows, or null when it waits on nobody (decisions 1,
 * 17, 18). Only a started feature can need anything. While a round runs or the
 * lead is mid-turn, only an open ask (it halts the agent where it stands), a
 * standing merge conflict or a worker that needs the human counts.
 *
 * Who owns the feature decides who has the need (every-feature-has-one-owner
 * decisions 15–17, 20). Under an orchestrator chat every need but a permission
 * prompt and a worker's question is held: it reads "With <Chat> · <its words>"
 * — "With <Chat> · asking you" while the chat asks the human about it with a
 * handback out — and comes back to the human as its plain words ("Handed back
 * · …") only once a handback has waited {@link HELD_NEED_GRACE_MS} on a chat
 * that neither asks nor works. Under the human every need reads as it always
 * did, but a handback out to the feature's chat, which reads "Asking <Chat> ·
 * <its first line>", held. A held need never outranks one that is not:
 * precedence orders each group.
 */
export function featureNeed(facts: NeedFacts, now: number): FeatureNeed | null {
  if (facts.status !== 'active') return null
  let firstHeld: Bare | null = null
  for (const candidate of candidates(facts)) {
    const need = candidate()
    if (!need) continue
    if (!isHeld(facts, need, now)) return { ...need, words: wordsOf(need), held: false }
    firstHeld ??= need
  }
  return firstHeld ? { ...firstHeld, words: heldWords(facts, firstHeld), held: true } : null
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
  /** The worker's thread a `worker` need opens (interactive-workers decision 6). */
  threadId?: string
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
