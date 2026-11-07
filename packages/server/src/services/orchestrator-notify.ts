import { AUTOSTART_FAILED, AUTOSTART_SKIPPED, type EventRow, type PromptDisplay } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { getSessionRow } from '../launcher/sessions'
import { agentHost } from '../threads/types'
import { subscribeLive } from './bus'
import { mayStartInBackground } from './database-copy'
import { emit, getEventRow } from './events'
import { getFeatureRow } from './repo'

/**
 * What a project thread hears from runcastle about the features it holds
 * (`agents-are-woken-only-when-it-matters` decisions 19, 23): only machine events
 * about its own work, each waking it. Everything else it hears from a feature
 * comes from that feature's lead, by `hand_back` (decisions 20–22). One
 * `[runcastle]` line is said into the HOLDER as a runcastle prompt
 * ({@link notifyOrchestrator}), into no other thread. A feature nobody holds
 * produces nothing, and a shipped one has nothing more to say.
 *
 * | Event type               | When                                                         |
 * |--------------------------|--------------------------------------------------------------|
 * | `testdrive.dev_failed`   | a drive the orchestrator started failed to start (stamped `actor: 'orchestrator'`) |
 * | `feature.started`        | a draft it holds started by itself (`data.autoStartedBy`)    |
 * | `feature.autostart.*`    | a draft it holds could not start by itself                   |
 * | `lead.wake_failed`       | a message it sent a lead could not reach it (stamped `actor: 'orchestrator'`) |
 *
 * Project-level events produce nothing.
 */

/** What the notifier needs to know about an event beyond its row. */
export interface NotifyState {
  /** The event's feature; absent for a project-level event. */
  feature?: {
    slug: string
    title: string
    /** The thread holding it; null when none does, or once it has shipped. */
    holderId: string | null
  }
}

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

/** Whether the orchestrator's own tool call caused the event (its drive, its message). */
function byOrchestrator(event: EventRow): boolean {
  return record(event.data).actor === 'orchestrator'
}

/** What happened and what to read next, without the prefix or the slug; null for no line. */
function describe(event: EventRow, slug: string): string | null {
  const data = record(event.data)
  const context = `Read it with get_feature_context({ slug: "${slug}" }).`
  switch (event.type) {
    case 'testdrive.dev_failed':
      return byOrchestrator(event) ? `the drive you started failed: ${clip(event.message)}. ${context}` : null
    case 'feature.started':
      if (typeof data.autoStartedBy !== 'string') return null
      return `started by itself because ${data.autoStartedBy} shipped. Nothing is working on it yet: plan_feature or send_to_feature sets it going, unless its brief says grill with you: then hand the human its chat.`
    case AUTOSTART_SKIPPED:
    case AUTOSTART_FAILED:
      return `${clip(event.message, MESSAGE_MAX)}. ${context}`
    case 'lead.wake_failed':
      // The message waits for the agent's next wake; without this line the
      // orchestrator would believe its message was being worked on.
      return byOrchestrator(event)
        ? `could not wake its agent, so your message has not reached it yet (${clip(event.message)}). ${context}`
        : null
    default:
      return null
  }
}

/** What the human reads of one event: its tone, and plain words with no slug or tool name. */
export interface NewsEvent {
  tone: 'done' | 'needsYou' | 'failed' | 'info'
  words: string
}

/** The human's words for an event {@link describe} has a line for (plain words, no plumbing). */
function humanWords(event: EventRow): NewsEvent | null {
  const data = record(event.data)
  switch (event.type) {
    case 'testdrive.dev_failed':
      return { tone: 'failed', words: 'Test drive failed to start' }
    case 'feature.started':
      return { tone: 'info', words: `Started by itself after ${String(data.autoStartedBy)} shipped` }
    case AUTOSTART_SKIPPED:
    case AUTOSTART_FAILED:
      return { tone: 'failed', words: clip(event.message, MESSAGE_MAX) }
    case 'lead.wake_failed':
      return { tone: 'failed', words: 'Could not wake its agent' }
    default:
      return null
  }
}

/**
 * The line to deliver to the holder for `event`, or null for none.
 * Pure: everything it needs about the feature is in `state`.
 */
export function orchestratorLineFor(event: EventRow, state: NotifyState): string | null {
  if (!event.featureId || !state.feature?.holderId) return null
  const text = describe(event, state.feature.slug)
  return text ? `${PREFIX} ${state.feature.slug} ${text}` : null
}

/** The same event in the human's words, with the feature it is about; null exactly when there is no line. */
export function orchestratorNewsFor(
  event: EventRow,
  state: NotifyState,
): ({ featureId: string; title: string } & NewsEvent) | null {
  if (!orchestratorLineFor(event, state) || !event.featureId || !state.feature) return null
  const news = humanWords(event)
  return news ? { featureId: event.featureId, title: state.feature.title, ...news } : null
}

/** Read the feature an event names. */
function stateFor(ctx: AppCtx, event: EventRow): NotifyState {
  if (!event.featureId) return {}
  const feature = getFeatureRow(ctx, event.featureId)
  // A shipped feature has nothing more to say, except that the drafts waiting
  // on it could not start, which the merge reports on the shipped feature.
  const over = feature.status === 'shipped' && event.type !== AUTOSTART_FAILED
  return { feature: { slug: feature.slug, title: feature.title, holderId: over ? null : (feature.heldBy ?? null) } }
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
export function notifyOrchestrator(ctx: AppCtx, eventId: number): void {
  try {
    const event = getEventRow(ctx, eventId)
    if (!event) return
    const state = stateFor(ctx, event)
    const line = orchestratorLineFor(event, state)
    const threadId = state.feature?.holderId ?? null
    if (!line || !threadId) return
    // In a test drive, news never starts a holder the driver has not started
    // (drives-never-touch-real-conversations decision 9).
    if (!mayStartInBackground(getSessionRow(ctx, threadId))) {
      // A type the notifier has no line for, so this event says nothing onward.
      if (event.featureId) {
        emit(ctx, event.featureId, {
          type: ORCHESTRATOR_NEWS_NOT_SENT,
          message: 'news not sent: this drive has not started the thread that holds this feature',
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

/** Say a gathered batch as one prompt, the human's words for it beside. */
async function deliver(ctx: AppCtx, threadId: string, batch: Gathered[]): Promise<void> {
  const news = newsByFeature(batch)
  await agentHost(ctx).prompt(
    threadId,
    { text: batch.map((b) => b.line).join('\n') },
    { source: 'runcastle', ...(news.length > 0 ? { display: { news } } : {}) },
  )
}

/**
 * Subscribe the notifier to the live event bus; returns the unsubscribe. Called
 * once at boot.
 */
export function startOrchestratorNotifier(ctx: AppCtx): () => void {
  return subscribeLive((signal) => {
    if (signal.kind === 'event') notifyOrchestrator(ctx, signal.eventId)
  })
}
