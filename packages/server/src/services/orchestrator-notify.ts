import { AUTOSTART_FAILED, AUTOSTART_SKIPPED, type EventRow, type PromptDisplay, type SessionRow, type Ticket } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { tickets } from '../db/schema'
import { getSessionRow } from '../launcher/sessions'
import { agentHost } from '../threads/types'
import { subscribeLive } from './bus'
import { mayStartInBackground } from './database-copy'
import { emit, getEventRow } from './events'
import { getFeatureRow } from './repo'
import { getTicket } from './tickets'
import { wakes, type WakeReason } from './wake-rule'

/**
 * What a project thread hears about the features it holds
 * (`whole-cuts-plan-themselves` decisions 11, 13, 20; `threads-hold-features`):
 * one `[runcastle]` line said into the HOLDER as a runcastle prompt
 * ({@link notifyOrchestrator}), and into no other thread, however new. A feature
 * nobody holds produces nothing, and a shipped one has nothing more to say.
 *
 * Each line is tagged by the wake rule (`wake-rule.ts`; `agents-are-woken-only-
 * when-it-matters` decisions 3–5): a handback or a question wakes the holder,
 * starting it when its process has stopped; news is held, logged in its chat
 * and said with its next prompt. A gathered batch with one waking line carries
 * the rest with it.
 *
 * Two kinds of event reach it:
 *
 * - END events — something it may be waiting on is over. Forwarded whoever
 *   started the work, except a merge's landing or conflict stamped
 *   `actor: 'orchestrator'`, which `merge_feature` already returned. These start
 *   a holder whose process has stopped.
 * - ACT events — the human did something on a held feature. Forwarded only when
 *   not stamped `actor: 'orchestrator'`, since the thread's own tool call already
 *   answered it, and only while the holder's process runs: they tell a working
 *   thread to wait or carry on, and a closed one is doing neither (decision 12).
 *
 * | Event type                        | Kind | Wakes?   | When                                        |
 * |-----------------------------------|------|----------|---------------------------------------------|
 * | `session.self_plan_ended`         | end  | unless the feature already waits on the human | a self-planning run exited (`data.complete`) |
 * | `run.finished`                    | end  | failed   | a round finished or failed (`data.status`)  |
 * | `run.reconciled`                  | end  | no       | a server restart cut a round off            |
 * | `feature.waiting`                 | end  | yes      | the agent waits for the human (`data.why`)  |
 * | `feature.ready_declared`          | end  | yes      | the agent declared the work ready to test   |
 * | `lead.wake_failed`                | end  | yes      | runcastle could not wake the agent          |
 * | `ticket.done` / `ticket.failed`   | end  | no       | only for a review or verification ticket    |
 * | `feature.shipped`                 | end  | yes      | a merge landed                              |
 * | `merge.conflict`                  | end  | no       | the human's own merge conflicted            |
 * | `merge.resolved`                  | end  | no       | a standing conflict was resolved            |
 * | `testdrive.dev_failed`            | end  | yes      | a drive's dev server failed to start        |
 * | `feature.started`                 | end  | yes      | only a draft that started by itself         |
 * | `feature.autostart.*`             | end  | yes      | a draft could not start by itself           |
 * | `feature.taken`                   | end  | no       | another thread took it; goes to the old holder |
 * | `session.launching`               | act  | no       | a self-planning run was launched            |
 * | `session.process_started`         | act  | no       | the human's message started a thread        |
 * | `session.process_stopped`         | act  | no       | that thread's process stopped               |
 * | `testdrive.started` / `.stopped`  | act  | no       | a test drive (not the review agent's)       |
 *
 * A merge is its landing or conflict above. Project-level events produce nothing.
 */

/** What the notifier needs to know about an event beyond its row. */
export interface NotifyState {
  /** The event's feature; absent for a project-level event. */
  feature?: {
    slug: string
    title: string
    /** The thread holding it; null when none does, or once it has shipped. */
    holderId: string | null
    /** Whether the holder's process is running. */
    holderRunning: boolean
    /** Whether the feature waits on the human (a waiting reason is set). */
    waiting?: boolean
  }
  /** The session the event names (`data.sessionId`), when there is one. */
  session?: Pick<SessionRow, 'kind' | 'purpose' | 'headless'>
  /** The ticket the event is about, when there is one. */
  ticket?: Pick<Ticket, 'seq' | 'kind' | 'passKind'>
}

type NewsEntry = Extract<PromptDisplay, { news: unknown }>['news'][number]

/**
 * A line: what kind of event it is, its words, the wake rule's tag, and for a
 * line about what the human is doing, the key a newer such line replaces it by
 * while both are held (decision 13).
 */
type Described = { kind: 'end' | 'act'; text: string; reason: WakeReason; key?: string }

const PREFIX = '[runcastle]'

/** News a copied database (a test drive) kept from a holder it has not started. */
export const ORCHESTRATOR_NEWS_NOT_SENT = 'orchestrator.news_not_sent'

/** The longest a summary carried from an event gets, so a line stays one short line. */
const SUMMARY_MAX = 80

/** The waiting reason `declareReady` sets; the ready line speaks for it. */
const READY_REASON = 'ready to test'

/** The longest a waiting reason gets in a line: it is what the agent asked, so it runs longer. */
const WHY_MAX = 200

/**
 * The END events a tool call's own result already reports: `merge_feature`
 * returns the landing or the conflict synchronously. Stamped by the
 * orchestrator, they are not typed back. Every other END event outlives the
 * call that started its work, so it is forwarded even when stamped.
 */
const ANSWERED_END_TYPES = new Set(['feature.shipped', 'merge.conflict'])

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

/** Whether a session runs without a terminal, for rows that predate the column too. */
function isHeadless(session: NotifyState['session']): boolean {
  return !!session && (session.headless === true || session.purpose === 'self-plan')
}

/** The hold key the human's talking and went-quiet lines share, so the newer replaces the older (decision 13). */
const talkingKey = (slug: string, kind: string): string => `talking:${slug}:${kind}`

/** The hold key a drive's started and stopped lines share. */
const driveKey = (slug: string): string => `drive:${slug}`

/** What happened and what to read next, without the prefix or the slug; null for no line. */
function describe(event: EventRow, state: NotifyState, slug: string): Described | null {
  const { session, ticket } = state
  const data = record(event.data)
  const context = `Read it with get_feature_context({ slug: "${slug}" }).`
  const tickets = `Read it with list_tickets({ slug: "${slug}" }).`
  switch (event.type) {
    case 'session.self_plan_ended': {
      // A run that ends on a wait already woke the holder with the wait's line (decision 5).
      const reason: WakeReason = state.feature?.waiting ? 'news' : 'handback'
      return data.complete === true
        ? { kind: 'end', text: `finished planning. ${context}`, reason }
        : { kind: 'end', text: `stopped before the plan was complete. ${context}`, reason }
    }
    case 'run.finished': {
      const summary = typeof data.summary === 'string' ? clip(data.summary) : ''
      // A finished round goes to its lead, whose ready or wait line follows; a failed one is the
      // holder's to see. A cancelled one is the human's own Stop: they know.
      if (data.status === 'cancelled') return { kind: 'end', text: `round cancelled${summary ? ` (${summary})` : ''}. ${tickets}`, reason: 'news' }
      const ok = data.status === 'succeeded'
      return { kind: 'end', text: `${ok ? 'round finished' : 'round failed'}${summary ? ` (${summary})` : ''}. ${tickets}`, reason: ok ? 'news' : 'handback' }
    }
    case 'run.reconciled':
      // Only a round is news; its lead is woken with the same counts.
      if (data.workflow !== 'ticket-burner') return null
      return {
        kind: 'end',
        text: `round interrupted by a server restart (${String(data.landedTickets)} landed, ${String(data.pendingTickets)} pending). ${tickets}`,
        reason: 'news',
      }
    case 'feature.waiting': {
      // "ready to test" is the ready line's; a cleared reason is not news.
      if (typeof data.why !== 'string' || data.why === READY_REASON) return null
      return {
        kind: 'end',
        text: `waits for you: ${clip(data.why, WHY_MAX)}. Read what it asked with read_feature_chat({ slug: "${slug}" }).`,
        reason: 'question',
      }
    }
    case 'feature.ready_declared': {
      const scenario = typeof data.scenario === 'string' ? clip(data.scenario) : ''
      return { kind: 'end', text: `declared ready to test${scenario ? ` (drive: ${scenario})` : ''}. ${context}`, reason: 'handback' }
    }
    case 'lead.wake_failed':
      // The messages wait for the agent's next wake; without this line a sender
      // would believe its message was being worked on.
      return {
        kind: 'end',
        text: `could not wake its agent, so messages sent to it have not reached it yet (${clip(event.message)}). ${context}`,
        // Nothing else will come from a lead that cannot be woken: held, the feature would stall unseen.
        reason: 'question',
      }
    case 'ticket.done':
    case 'ticket.failed': {
      if (ticket?.kind !== 'review') return null
      const pass = ticket.passKind === 'verification' ? 'verification pass' : 'review pass'
      const verb = event.type === 'ticket.done' ? 'finished' : 'failed'
      return { kind: 'end', text: `${pass} (ticket ${ticket.seq}) ${verb}. ${tickets}`, reason: 'news' }
    }
    case 'feature.shipped':
      return { kind: 'end', text: `${clip(event.message)}: shipped. Backlog features waiting on it may start now. ${context}`, reason: 'handback' }
    case 'merge.conflict': {
      // Reached here only for a merge the human pressed: the orchestrator's own
      // merge_feature already returned its conflict (ANSWERED_END_TYPES). The
      // human holds the Resolve button, so relaying it would resolve it twice
      // (drives-never-touch-real-conversations decision 7).
      const files = Array.isArray(data.files) ? data.files.length : 0
      return {
        kind: 'end',
        text:
          `merge conflicted${files > 0 ? ` in ${files} file(s)` : ''} when the human merged it by hand. ` +
          `The human has the Resolve button on the feature: leave the conflict to them unless they ask you. ${context}`,
        // The human holds it, so it asks nothing of the orchestrator: news (decision 18).
        reason: 'news',
      }
    }
    case 'merge.resolved':
      // A merge that landed retires its conflict on the way to shipping; that
      // is the shipped line's news, not this one.
      if (typeof data.mergeFrom !== 'string' || typeof data.mergeInto !== 'string') return null
      return { kind: 'end', text: `merge conflict resolved (${data.mergeFrom} is in ${data.mergeInto}). Nothing to relay. ${context}`, reason: 'news' }
    case 'testdrive.dev_failed':
      return { kind: 'end', text: `drive failed: ${clip(event.message)}. ${context}`, reason: 'question' }
    case 'feature.started':
      if (typeof data.autoStartedBy !== 'string') return null
      return {
        kind: 'end',
        text: `started by itself because ${data.autoStartedBy} shipped. Nothing is working on it yet: plan_feature or send_to_feature sets it going.`,
        reason: 'question',
      }
    case AUTOSTART_SKIPPED:
    case AUTOSTART_FAILED:
      return { kind: 'end', text: `${clip(event.message, WHY_MAX)}. ${context}`, reason: 'question' }
    case 'feature.taken': {
      const name = typeof data.name === 'string' ? `the thread "${clip(data.name)}"` : 'another thread'
      return { kind: 'end', text: `was taken by ${name}, so you will hear nothing more about it and it is no longer yours to act on.`, reason: 'news' }
    }
    case 'session.launching':
      // Plan it yourself is the human's act; its end is its own END event above.
      if (!session || session.purpose !== 'self-plan') return null
      return { kind: 'act', text: `the human had it plan itself. Wait for the run to end.`, reason: 'news' }
    case 'session.process_started':
      // A thread runcastle started (a wake, a kickoff) is runcastle delivering, not the human acting.
      // A side thread never makes the feature busy.
      if (!session || data.source !== 'human' || session.kind === 'side' || isHeadless(session)) return null
      return {
        kind: 'act',
        text: `the human is talking to its ${session.kind} thread; it is busy until that conversation goes quiet.`,
        reason: 'news',
        key: talkingKey(slug, session.kind),
      }
    case 'session.process_stopped':
      if (!session || data.startedBy !== 'human' || session.kind === 'side' || isHeadless(session)) return null
      return {
        kind: 'act',
        text: `the human's ${session.kind} conversation on it went quiet; it is free again. ${context}`,
        reason: 'news',
        key: talkingKey(slug, session.kind),
      }
    case 'testdrive.started':
      if (data.purpose === 'review') return null
      return { kind: 'act', text: `the human started a test drive of it.`, reason: 'news', key: driveKey(slug) }
    case 'testdrive.stopped':
      if (data.purpose === 'review') return null
      return { kind: 'act', text: `the human stopped the test drive of it. ${context}`, reason: 'news', key: driveKey(slug) }
    default:
      return null
  }
}

/** What the human reads of one event: its tone, and plain words with no slug or tool name. */
export interface NewsEvent {
  tone: 'done' | 'needsYou' | 'failed' | 'info'
  words: string
}

/** The human's words for an event {@link describe} has a line for (decision 5: plain words, no plumbing). */
function humanWords(event: EventRow, ticket: NotifyState['ticket']): NewsEvent | null {
  const data = record(event.data)
  switch (event.type) {
    case 'session.self_plan_ended':
      return data.complete === true
        ? { tone: 'done', words: 'Finished planning' }
        : { tone: 'failed', words: 'Stopped before the plan was complete' }
    case 'run.finished': {
      if (data.status === 'cancelled') return { tone: 'info', words: 'Round cancelled' }
      if (data.status === 'succeeded') {
        return { tone: 'done', words: typeof data.round === 'number' ? `Round ${data.round} finished` : 'Round finished' }
      }
      const summary = typeof data.summary === 'string' ? clip(data.summary) : ''
      return { tone: 'failed', words: `Round failed${summary ? `: ${summary}` : ''}` }
    }
    case 'run.reconciled':
      return { tone: 'failed', words: 'Round cut off by a restart' }
    case 'feature.waiting':
      return { tone: 'needsYou', words: `Waits for you: ${typeof data.why === 'string' ? clip(data.why, WHY_MAX) : ''}` }
    case 'feature.ready_declared':
      return { tone: 'needsYou', words: 'Ready to test' }
    case 'lead.wake_failed':
      return { tone: 'failed', words: 'Could not wake its agent' }
    case 'ticket.done':
    case 'ticket.failed': {
      const pass = ticket?.passKind === 'verification' ? 'Verification pass' : 'Review pass'
      return event.type === 'ticket.done'
        ? { tone: 'done', words: `${pass} finished` }
        : { tone: 'failed', words: `${pass} failed` }
    }
    case 'feature.shipped':
      return { tone: 'done', words: 'Merged — shipped' }
    case 'merge.resolved':
      return { tone: 'done', words: 'Merge conflict resolved' }
    case 'merge.conflict': {
      const files = Array.isArray(data.files) ? data.files.length : 0
      return { tone: 'failed', words: files > 0 ? `Merge conflicted in ${files} ${files === 1 ? 'file' : 'files'}` : 'Merge conflicted' }
    }
    case 'testdrive.dev_failed':
      return { tone: 'failed', words: 'Test drive failed to start' }
    case 'feature.started':
      return { tone: 'info', words: `Started by itself after ${String(data.autoStartedBy)} shipped` }
    case AUTOSTART_SKIPPED:
    case AUTOSTART_FAILED:
      return { tone: 'failed', words: clip(event.message, WHY_MAX) }
    case 'feature.taken':
      return { tone: 'info', words: typeof data.name === 'string' ? `Taken by the chat “${clip(data.name)}”` : 'Taken by another chat' }
    case 'session.launching':
      return { tone: 'info', words: 'You had it plan itself' }
    case 'session.process_started':
      return { tone: 'info', words: 'You are talking to its chat' }
    case 'session.process_stopped':
      return { tone: 'info', words: 'Its chat went quiet' }
    case 'testdrive.started':
      return { tone: 'info', words: 'You started a test drive' }
    case 'testdrive.stopped':
      return { tone: 'info', words: 'You stopped the test drive' }
    default:
      return null
  }
}

/** What an event says to its holder, or null when it says nothing; the gate both the line and the news go through. */
function described(event: EventRow, state: NotifyState): Described | null {
  if (!event.featureId || !state.feature?.holderId) return null
  const said = describe(event, state, state.feature.slug)
  if (!said) return null
  if (said.kind === 'act' && !state.feature.holderRunning) return null
  if (record(event.data).actor === 'orchestrator' && (said.kind === 'act' || ANSWERED_END_TYPES.has(event.type))) {
    return null
  }
  return said
}

/**
 * The line to deliver to the holder for `event`, or null for none.
 * Pure: everything it needs about the feature, session and ticket is in `state`.
 */
export function orchestratorLineFor(event: EventRow, state: NotifyState): string | null {
  return orchestratorDeliveryFor(event, state)?.line ?? null
}

/** The line for `event`, whether it wakes the holder, and its hold key; null for no line. Pure, as {@link orchestratorLineFor}. */
export function orchestratorDeliveryFor(event: EventRow, state: NotifyState): { line: string; wake: boolean; key?: string } | null {
  const said = described(event, state)
  if (!said || !state.feature) return null
  return { line: `${PREFIX} ${state.feature.slug} ${said.text}`, wake: wakes(said.reason), ...(said.key ? { key: said.key } : {}) }
}

/** The same event in the human's words, with the feature it is about; null exactly when there is no line. */
export function orchestratorNewsFor(
  event: EventRow,
  state: NotifyState,
): ({ featureId: string; title: string } & NewsEvent) | null {
  if (!described(event, state) || !event.featureId || !state.feature) return null
  const news = humanWords(event, state.ticket)
  return news ? { featureId: event.featureId, title: state.feature.title, ...news } : null
}

/** Read the feature, session and ticket an event names. Missing rows are left out. */
function stateFor(ctx: AppCtx, event: EventRow): NotifyState {
  const state: NotifyState = {}
  if (event.featureId) {
    const feature = getFeatureRow(ctx, event.featureId)
    // A shipped feature has nothing more to say, except that the drafts waiting
    // on it could not start, which the merge reports on the shipped feature.
    const over = feature.status === 'shipped' && event.type !== AUTOSTART_FAILED
    const holderId = over ? null : (feature.heldBy ?? null)
    const holderRunning = holderId !== null && agentHost(ctx).isRunning(holderId)
    state.feature = { slug: feature.slug, title: feature.title, holderId, holderRunning, waiting: !!feature.waitingReason }
  }
  const sessionId = record(event.data).sessionId
  if (typeof sessionId === 'string') {
    const session = getSessionRow(ctx, sessionId)
    if (session) state.session = session
  }
  const ticket = ticketFor(ctx, event)
  if (ticket) state.ticket = ticket
  return state
}

/** The ticket an event is about, if it names one that still exists. */
function ticketFor(ctx: AppCtx, event: EventRow): Ticket | undefined {
  if (!event.ticketId) return undefined
  const row = ctx.db.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, event.ticketId)).get()
  return row ? getTicket(ctx, row.id) : undefined
}

/**
 * How long lines are gathered, from the first one, before they go: a burn's
 * review ticket and the round itself end ~20 ms apart, and two prompts would be
 * two turns for what ended together.
 */
export const ORCHESTRATOR_GATHER_MS = 300

/** One gathered line: its text, the human's words for it, whether it wakes, and its hold key. */
type Gathered = { line: string; news: ReturnType<typeof orchestratorNewsFor>; wake: boolean; key?: string }

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

/** The thread a line about `event` goes to: the holder, or for a take the thread that lost it. */
function recipient(event: EventRow, state: NotifyState): string | null {
  if (event.type !== 'feature.taken') return state.feature?.holderId ?? null
  const from = record(event.data).from
  return typeof from === 'string' ? from : null
}

/**
 * Add the line for one event to what the feature's holder hears next (decision
 * 20; chat-as-web-components decision 6). A gathered batch with a waking line
 * is one runcastle prompt with a line per event, queued to the end of a running
 * turn and starting the thread when no process runs; a batch of news only is
 * held, a line at a time, for the thread's next prompt (`agents-are-woken-only-
 * when-it-matters` decisions 2, 3). Best effort: nothing is retried or sent to
 * another thread, and nothing here throws into the emitter.
 */
export function notifyOrchestrator(ctx: AppCtx, eventId: number): void {
  try {
    const event = getEventRow(ctx, eventId)
    if (!event) return
    const state = stateFor(ctx, event)
    const delivery = orchestratorDeliveryFor(event, state)
    const threadId = recipient(event, state)
    if (!delivery || !threadId) return
    // In a test drive, news never starts a holder the driver has not started
    // (drives-never-touch-real-conversations decision 9).
    if (!mayStartInBackground(getSessionRow(ctx, threadId))) {
      // A type the notifier has no line for, so this event says nothing onward.
      if (event.featureId) {
        emit(ctx, event.featureId, {
          type: ORCHESTRATOR_NEWS_NOT_SENT,
          message: 'news not sent: this drive has not started the thread that holds this feature',
          data: { threadId, eventId: event.id, line: delivery.line },
        })
      }
      return
    }
    const entry: Gathered = { ...delivery, news: orchestratorNewsFor(event, state) }
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

/** Say a gathered batch: one prompt when a line in it wakes, else each line held for the next prompt. */
async function deliver(ctx: AppCtx, threadId: string, batch: Gathered[]): Promise<void> {
  const host = agentHost(ctx)
  if (batch.some((b) => b.wake)) {
    const news = newsByFeature(batch)
    await host.prompt(
      threadId,
      { text: batch.map((b) => b.line).join('\n') },
      { source: 'runcastle', ...(news.length > 0 ? { display: { news } } : {}) },
    )
    return
  }
  for (const b of batch) {
    const news = newsByFeature([b])
    await host.prompt(
      threadId,
      { text: b.line },
      { source: 'runcastle', hold: true, ...(b.key ? { holdKey: b.key } : {}), ...(news.length > 0 ? { display: { news } } : {}) },
    )
  }
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
