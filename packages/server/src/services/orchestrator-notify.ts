import {
  AUTOSTART_FAILED,
  AUTOSTART_SKIPPED,
  type DecidedWithoutYou,
  type EventRow,
  type Feature,
  type PromptDisplay,
  type ReviewFinding,
} from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { getSessionRow } from '../launcher/sessions'
import { agentHost } from '../threads/types'
import { subscribeLive } from './bus'
import { mayStartInBackground } from './database-copy'
import type { EpicSibling } from './epic-siblings'
import { epicSiblingsInProgress, MERGED_BY_RUNCASTLE, ownerWords } from './epic-siblings'
import { emit, getEventRow } from './events'
import { chatNameOf } from '../threads/chat-name'
import { getFeatureRow } from './repo'
import { listByFeature as listFindings } from './review-findings'

/**
 * What an epic (an orchestrator chat) hears from runcastle about its own
 * features (`autopilot-retires` decisions 2, 9): every merge, and trouble that
 * crosses features. One `[runcastle]` line is said into the feature's EPIC
 * (`features.chat_id`, the chat it came from) as a runcastle prompt
 * ({@link notifyOrchestrator}), into no other thread, and it wakes the epic.
 * A feature with no epic, or whose epic chat is gone, says nothing.
 *
 * A merge, by anyone, is said once the merge has started its up-next drafts
 * ({@link announceMerge}), with the review summary, the decisions marked
 * "Decided without you" and the defects dismissed. The lead's own trouble
 * comes by `hand_back` (`lead-handback.ts`), not through here.
 *
 * | Event type               | When                                                         |
 * |--------------------------|--------------------------------------------------------------|
 * | `feature.autostart.*`    | a dependent could not start by itself, or its lead could not launch |
 * | `feature.shipped`        | a feature of the epic merged, by anyone                      |
 *
 * Project-level events produce nothing.
 */

/** What the notifier needs to know about an event beyond its row. */
export interface NotifyState {
  /** The event's feature; absent for a project-level event. */
  feature?: {
    slug: string
    title: string
    /** The epic its trouble goes to; null when the event is not trouble or it has no epic. */
    holderId: string | null
    /** For a merge, what the epic hears of it; absent for any other event. */
    merge?: MergeNews
  }
}

/** What the feature's epic hears of its merge, read once the merge has started its up-next drafts. */
export interface MergeNews {
  /** The epic: the orchestrator thread the feature came from. */
  epicId: string
  /** Who merged it, as the epic reads it: `the human`, `this chat`, or `the chat "<name>"`. */
  by: string
  /** Who merged it, as the human reads it: `you` or the chat's name. */
  byName: string
  /** The branch it merged into. */
  base: string
  /** The merge commit, when known. */
  sha: string | null
  /** The outcome doc's path in the repo, when the merge wrote one. */
  outcome: string | null
  /** The epic's other features in progress. */
  siblings: EpicSibling[]
  /** The `## Review summary` text written at the merge; null when none could be composed. */
  reviewSummary: string | null
  /** The decisions the lead settled without the human, as merged. */
  decided: DecidedWithoutYou[]
  /** The defects dismissed rather than fixed. */
  dismissed: Pick<ReviewFinding, 'title' | 'severity' | 'location' | 'resolutionNote'>[]
}

/** What the epic is told when nothing of it is left in progress (decision 6). */
export const NOTHING_TO_CHECK = 'Nothing of this epic is in progress, so there is nothing to check.'

type NewsEntry = Extract<PromptDisplay, { news: unknown }>['news'][number]

const PREFIX = '[runcastle]'

/** News a copied database (a test drive) kept from a holder it has not started. */
export const ORCHESTRATOR_NEWS_NOT_SENT = 'orchestrator.news_not_sent'

/** The longest a summary carried from an event gets, so a line stays one short line. */
const SUMMARY_MAX = 80

/** The longest a message carried from an event gets. */
const MESSAGE_MAX = 200

function record(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {}
}

/** One line, at most `max` characters. */
function clip(text: string, max = SUMMARY_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

/** Whether an event is trouble that crosses features: a dependent that could not start (decision 9). */
function isTrouble(type: string): boolean {
  return type === AUTOSTART_SKIPPED || type === AUTOSTART_FAILED
}

/** What happened and what to read next, without the prefix or the slug; null for no line. */
function describe(event: EventRow, slug: string): string | null {
  if (!isTrouble(event.type)) return null
  return `${clip(event.message, MESSAGE_MAX)}. Read it with get_feature_context({ slug: "${slug}" }).`
}

/** The merge line's text after the prefix and the slug (decisions 2, 6, 7, 9). */
function describeMerge(merge: MergeNews, slug: string): string {
  const head = `merged into ${merge.base} by ${merge.by}.`
  // The brief's section, without its own heading: the message names it.
  const summary = merge.reviewSummary?.replace(/^#+ *Review summary *\n/, '').trim()
  const settled = [
    ...(summary ? ['Review summary:', summary] : []),
    ...(merge.decided.length
      ? ['Decided without the human:', ...merge.decided.map((d) => `- ${d.n}. ${d.title}`)]
      : []),
    ...(merge.dismissed.length
      ? [
          'Defects dismissed, not fixed:',
          ...merge.dismissed.map(
            (d) => `- ${d.title} (${d.severity}, ${d.location})${d.resolutionNote ? `: ${clip(d.resolutionNote, MESSAGE_MAX)}` : ''}`,
          ),
        ]
      : []),
  ]
  if (merge.siblings.length === 0) return [head, ...settled, NOTHING_TO_CHECK].join('\n')
  const siblings = merge.siblings.map((s) => `- ${s.slug}: ${s.title}`)
  const where = [
    ...(merge.sha ? [`the merge commit ${merge.sha.slice(0, 12)}`] : []),
    // A one-file feature's record is the `## Review summary` at the end of its brief.md, quoted above.
    ...(merge.outcome && !merge.outcome.endsWith('/brief.md') ? [merge.outcome] : []),
  ]
  const read =
    where.length > 0
      ? `Read the change: ${where.join(' and ')}.`
      : `Read the change with get_feature_context({ slug: "${slug}" }).`
  return [head, ...settled, 'In progress in this epic:', ...siblings, read].join('\n')
}

/** What the human reads of one event: its tone, and plain words with no slug or tool name. */
export interface NewsEvent {
  tone: 'done' | 'needsYou' | 'failed' | 'info'
  words: string
}

/** The human's words for an event {@link describe} has a line for (plain words, no plumbing). */
function humanWords(event: EventRow, state: NotifyState): NewsEvent | null {
  switch (event.type) {
    case 'feature.shipped': {
      const merge = state.feature?.merge
      return merge ? { tone: 'done', words: `Merged by ${merge.byName}` } : null
    }
    case AUTOSTART_SKIPPED:
    case AUTOSTART_FAILED:
      return { tone: 'failed', words: clip(event.message, MESSAGE_MAX) }
    default:
      return null
  }
}

/**
 * The line to deliver to the holder for `event`, or null for none.
 * Pure: everything it needs about the feature is in `state`.
 */
export function orchestratorLineFor(event: EventRow, state: NotifyState): string | null {
  if (!event.featureId || !state.feature) return null
  if (event.type === 'feature.shipped') {
    const merge = state.feature.merge
    return merge ? `${PREFIX} ${state.feature.slug} ${describeMerge(merge, state.feature.slug)}` : null
  }
  if (!state.feature.holderId) return null
  const text = describe(event, state.feature.slug)
  return text ? `${PREFIX} ${state.feature.slug} ${text}` : null
}

/** The same event in the human's words, with the feature it is about; null exactly when there is no line. */
export function orchestratorNewsFor(
  event: EventRow,
  state: NotifyState,
): ({ featureId: string; title: string } & NewsEvent) | null {
  if (!orchestratorLineFor(event, state) || !event.featureId || !state.feature) return null
  const news = humanWords(event, state)
  return news ? { featureId: event.featureId, title: state.feature.title, ...news } : null
}

/** The thread the line for `event` goes to: the feature's epic; null for none. */
export function orchestratorTargetFor(event: EventRow, state: NotifyState): string | null {
  if (event.type === 'feature.shipped') return state.feature?.merge?.epicId ?? null
  return state.feature?.holderId ?? null
}

/** What a merge's `feature.shipped` carries (set by the merge flow). */
export type ShippedData = {
  base?: string
  sha?: string | null
  outcome?: string | null
  /** The orchestrator thread whose `merge_feature` merged it, `runcastle` (`MERGED_BY_RUNCASTLE`) when it merged by itself; null when the human did. */
  mergedBy?: string | null
  /** The `## Review summary` text the merge wrote (autopilot-retires decision 2). */
  reviewSummary?: string | null
  /** The decisions marked "Decided without you", as merged. */
  decidedWithoutYou?: DecidedWithoutYou[]
}

/** The feature's epic chat, when it has one that still exists. */
function epicOf(ctx: AppCtx, feature: Feature): string | null {
  const epic = feature.chatId ? getSessionRow(ctx, feature.chatId) : null
  return epic && epic.kind === 'project' ? epic.id : null
}

/** What the epic hears of a merge, read now; undefined when the feature has no epic or its epic chat is gone. */
function mergeNewsFor(ctx: AppCtx, event: EventRow, feature: Feature): MergeNews | undefined {
  const epicId = epicOf(ctx, feature)
  if (!epicId) return undefined
  const data = record(event.data) as ShippedData
  const mergedBy = typeof data.mergedBy === 'string' ? data.mergedBy : null
  const siblings = epicSiblingsInProgress(ctx, feature)
  const name = mergedBy === MERGED_BY_RUNCASTLE ? 'runcastle' : mergedBy ? chatNameOf(ctx, mergedBy) : null
  return {
    epicId,
    by: ownerWords(ctx, mergedBy, epicId),
    byName: name ?? 'you',
    base: typeof data.base === 'string' ? data.base : (feature.baseBranch ?? 'its base'),
    sha: typeof data.sha === 'string' ? data.sha : null,
    outcome: typeof data.outcome === 'string' ? data.outcome : null,
    siblings,
    reviewSummary: typeof data.reviewSummary === 'string' ? data.reviewSummary : null,
    decided: Array.isArray(data.decidedWithoutYou) ? data.decidedWithoutYou : [],
    dismissed: listFindings(ctx, feature.id)
      .filter((f) => f.kind === 'defect' && f.status === 'dismissed')
      .map(({ title, severity, location, resolutionNote }) => ({ title, severity, location, resolutionNote })),
  }
}

/**
 * Read the feature an event names. A merge's news is read only `afterMerge`
 * (from {@link announceMerge}): the live `feature.shipped` comes before the
 * merge has started its up-next drafts, which its sibling list counts.
 */
function stateFor(ctx: AppCtx, event: EventRow, afterMerge = false): NotifyState {
  if (!event.featureId) return {}
  const feature = getFeatureRow(ctx, event.featureId)
  const merge = afterMerge && event.type === 'feature.shipped' ? mergeNewsFor(ctx, event, feature) : undefined
  return {
    feature: {
      slug: feature.slug,
      title: feature.title,
      // Only trouble reaches the epic outside a merge; a shipped feature still
      // reports that the drafts waiting on it could not start.
      holderId: isTrouble(event.type) ? epicOf(ctx, feature) : null,
      ...(merge ? { merge } : {}),
    },
  }
}

/**
 * How long lines are gathered, from the first one, before they go: a burn's
 * review ticket and the round itself end ~20 ms apart, and two prompts would be
 * two turns for what ended together.
 */
export const ORCHESTRATOR_GATHER_MS = 300

/** One gathered line: its text and the human's words for it. */
type Gathered = { line: string; news: ReturnType<typeof orchestratorNewsFor> }

/** Lines gathering per orchestrator thread, until their prompt goes. */
const gathering = new Map<string, Gathered[]>()

/** A batch's news for the human: one entry per feature, its events in arrival order. */
function newsByFeature(batch: { news: ReturnType<typeof orchestratorNewsFor> }[]): NewsEntry[] {
  const byFeature = new Map<string, NewsEntry>()
  for (const { news } of batch) {
    if (!news) continue
    const entry = byFeature.get(news.featureId) ?? { featureId: news.featureId, title: news.title, events: [] }
    entry.events.push({ tone: news.tone, words: news.words })
    byFeature.set(news.featureId, entry)
  }
  return [...byFeature.values()]
}

/**
 * Say the line for one event into the feature's holder (chat-as-web-components
 * decision 6): one runcastle prompt per gathered batch, a line per event, queued
 * to the end of a running turn and starting the thread when no process runs.
 * Best effort: nothing is retried or sent to another thread, and nothing here
 * throws into the emitter.
 */
export function notifyOrchestrator(ctx: AppCtx, eventId: number, afterMerge = false): void {
  try {
    const event = getEventRow(ctx, eventId)
    if (!event) return
    const state = stateFor(ctx, event, afterMerge)
    const line = orchestratorLineFor(event, state)
    const threadId = orchestratorTargetFor(event, state)
    if (!line || !threadId) return
    // In a test drive, news never starts a holder the driver has not started
    // (drives-never-touch-real-conversations decision 9).
    if (!mayStartInBackground(getSessionRow(ctx, threadId))) {
      // A type the notifier has no line for, so this event says nothing onward.
      if (event.featureId) {
        emit(ctx, event.featureId, {
          type: ORCHESTRATOR_NEWS_NOT_SENT,
          message: 'news not sent: this drive has not started the epic this feature came from',
          data: { threadId, eventId: event.id, line },
        })
      }
      return
    }
    const entry: Gathered = { line, news: orchestratorNewsFor(event, state) }
    const gathered = gathering.get(threadId)
    if (gathered) {
      gathered.push(entry)
      return
    }
    gathering.set(threadId, [entry])
    setTimeout(() => {
      const batch = gathering.get(threadId) ?? []
      gathering.delete(threadId)
      deliver(ctx, threadId, batch).catch((err) => console.error('orchestrator notifier failed', err))
    }, ORCHESTRATOR_GATHER_MS).unref?.()
  } catch (err) {
    console.error('orchestrator notifier failed', err)
  }
}

/** Say a gathered batch as one prompt, the human's words for it beside; it wakes the epic. */
async function deliver(ctx: AppCtx, threadId: string, batch: Gathered[]): Promise<void> {
  const news = newsByFeature(batch)
  await agentHost(ctx).prompt(
    threadId,
    { text: batch.map((b) => b.line).join('\n') },
    { source: 'runcastle', ...(news.length > 0 ? { display: { news } } : {}) },
  )
}

/** How many notifiers listen: a merge is announced only while one does, as live events are. */
let listening = 0

/**
 * Tell the merged feature's epic, once the merge flow has started the up-next
 * drafts waiting on it (decision 5). `shippedEventId` is the merge's
 * `feature.shipped`, whose live delivery said nothing. Best effort, like every line.
 */
export function announceMerge(ctx: AppCtx, shippedEventId: number): void {
  if (listening > 0) notifyOrchestrator(ctx, shippedEventId, true)
}

/**
 * Subscribe the notifier to the live event bus; returns the unsubscribe. Called
 * once at boot.
 */
export function startOrchestratorNotifier(ctx: AppCtx): () => void {
  listening += 1
  const unsubscribe = subscribeLive((signal) => {
    if (signal.kind === 'event') notifyOrchestrator(ctx, signal.eventId)
  })
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    listening -= 1
    unsubscribe()
  }
}
