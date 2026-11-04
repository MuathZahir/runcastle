import { AUTOSTART_FAILED, AUTOSTART_SKIPPED, type EventRow, type PromptDisplay, type SessionRow, type Ticket } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { tickets } from '../db/schema'
import { getSessionRow } from '../launcher/sessions'
import { agentHost } from '../threads/types'
import { subscribeLive } from './bus'
import { getEventRow } from './events'
import { getFeatureRow } from './repo'
import { getTicket } from './tickets'

/**
 * What a project thread hears about the features it holds
 * (`whole-cuts-plan-themselves` decisions 11, 13, 20; `threads-hold-features`):
 * one `[runcastle]` line said into the HOLDER as a runcastle prompt
 * ({@link notifyOrchestrator}), and into no other thread, however new. A feature
 * nobody holds produces nothing, and a shipped one has nothing more to say.
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
 * | Event type                        | Kind | When                                        |
 * |-----------------------------------|------|---------------------------------------------|
 * | `session.self_plan_ended`         | end  | a self-planning run exited (`data.complete`) |
 * | `session.run_ended`               | end  | a headless run exited (rows before threads) |
 * | `run.finished`                    | end  | a round finished or failed (`data.status`)  |
 * | `run.reconciled`                  | end  | a server restart cut a round off            |
 * | `feature.waiting`                 | end  | the agent waits for the human (`data.why`)  |
 * | `feature.ready_declared`          | end  | the agent declared the work ready to test   |
 * | `lead.wake_failed`                | end  | runcastle could not wake the agent          |
 * | `ticket.done` / `ticket.failed`   | end  | only for a review or verification ticket    |
 * | `feature.shipped`                 | end  | a merge landed                              |
 * | `merge.conflict`                  | end  | a merge conflicted                          |
 * | `testdrive.dev_failed`            | end  | a drive's dev server failed to start        |
 * | `feature.started`                 | end  | only a draft that started by itself         |
 * | `feature.autostart.*`             | end  | a draft could not start by itself           |
 * | `feature.taken`                   | end  | another thread took it; goes to the old holder |
 * | `session.launching`               | act  | a self-planning run was launched            |
 * | `session.process_started`         | act  | the human's message started a thread        |
 * | `session.process_stopped`         | act  | that thread's process stopped               |
 * | `testdrive.started` / `.stopped`  | act  | a test drive (not the review agent's)       |
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
  }
  /** The session the event names (`data.sessionId`), when there is one. */
  session?: Pick<SessionRow, 'kind' | 'purpose' | 'headless'>
  /** The ticket the event is about, when there is one. */
  ticket?: Pick<Ticket, 'seq' | 'kind' | 'passKind'>
}

type NewsEntry = Extract<PromptDisplay, { news: unknown }>['news'][number]

type Described = { kind: 'end' | 'act'; text: string }

const PREFIX = '[runcastle]'

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

/** What happened and what to read next, without the prefix or the slug; null for no line. */
function describe(event: EventRow, session: NotifyState['session'], ticket: NotifyState['ticket'], slug: string): Described | null {
  const data = record(event.data)
  const context = `Read it with get_feature_context({ slug: "${slug}" }).`
  const tickets = `Read it with list_tickets({ slug: "${slug}" }).`
  switch (event.type) {
    case 'session.self_plan_ended':
      return data.complete === true
        ? { kind: 'end', text: `finished planning. ${context}` }
        : { kind: 'end', text: `stopped before the plan was complete. ${context}` }
    case 'session.run_ended':
      return data.complete === true
        ? { kind: 'end', text: `headless run finished. ${context}` }
        : { kind: 'end', text: `headless run stopped before it finished. ${context}` }
    case 'run.finished': {
      const summary = typeof data.summary === 'string' ? clip(data.summary) : ''
      const verb = data.status === 'succeeded' ? 'round finished' : 'round failed'
      return { kind: 'end', text: `${verb}${summary ? ` (${summary})` : ''}. ${tickets}` }
    }
    case 'run.reconciled':
      // Only a round is news; its lead is woken with the same counts.
      if (data.workflow !== 'ticket-burner') return null
      return {
        kind: 'end',
        text: `round interrupted by a server restart (${String(data.landedTickets)} landed, ${String(data.pendingTickets)} pending). ${tickets}`,
      }
    case 'feature.waiting': {
      // "ready to test" is the ready line's; a cleared reason is not news.
      if (typeof data.why !== 'string' || data.why === READY_REASON) return null
      return {
        kind: 'end',
        text: `waits for you: ${clip(data.why, WHY_MAX)}. Read what it asked with read_feature_chat({ slug: "${slug}" }).`,
      }
    }
    case 'feature.ready_declared': {
      const scenario = typeof data.scenario === 'string' ? clip(data.scenario) : ''
      return { kind: 'end', text: `declared ready to test${scenario ? ` (drive: ${scenario})` : ''}. ${context}` }
    }
    case 'lead.wake_failed':
      // The messages wait for the agent's next wake; without this line a sender
      // would believe its message was being worked on.
      return {
        kind: 'end',
        text: `could not wake its agent, so messages sent to it have not reached it yet (${clip(event.message)}). ${context}`,
      }
    case 'ticket.done':
    case 'ticket.failed': {
      if (ticket?.kind !== 'review') return null
      const pass = ticket.passKind === 'verification' ? 'verification pass' : 'review pass'
      const verb = event.type === 'ticket.done' ? 'finished' : 'failed'
      return { kind: 'end', text: `${pass} (ticket ${ticket.seq}) ${verb}. ${tickets}` }
    }
    case 'feature.shipped':
      return { kind: 'end', text: `${clip(event.message)}: shipped. Backlog features waiting on it may start now. ${context}` }
    case 'merge.conflict': {
      const files = Array.isArray(data.files) ? data.files.length : 0
      return {
        kind: 'end',
        text: `merge conflicted${files > 0 ? ` in ${files} file(s)` : ''}. Resolve it in the feature's worktree, then merge_feature again. ${context}`,
      }
    }
    case 'testdrive.dev_failed':
      return { kind: 'end', text: `drive failed: ${clip(event.message)}. ${context}` }
    case 'feature.started':
      if (typeof data.autoStartedBy !== 'string') return null
      return {
        kind: 'end',
        text: `started by itself because ${data.autoStartedBy} shipped. Nothing is working on it yet: plan_feature or send_to_feature sets it going.`,
      }
    case AUTOSTART_SKIPPED:
    case AUTOSTART_FAILED:
      return { kind: 'end', text: `${clip(event.message, WHY_MAX)}. ${context}` }
    case 'feature.taken': {
      const name = typeof data.name === 'string' ? `the thread "${clip(data.name)}"` : 'another thread'
      return { kind: 'end', text: `was taken by ${name}, so you will hear nothing more about it and it is no longer yours to act on.` }
    }
    case 'session.launching':
      // Plan it yourself is the human's act; its end is its own END event above.
      if (!session || session.purpose !== 'self-plan') return null
      return { kind: 'act', text: `the human had it plan itself. Wait for the run to end.` }
    case 'session.process_started':
      // A thread runcastle started (a wake, a kickoff) is runcastle delivering, not the human acting.
      // A side thread never makes the feature busy.
      if (!session || data.source !== 'human' || session.kind === 'side' || isHeadless(session)) return null
      return { kind: 'act', text: `the human is talking to its ${session.kind} thread; it is busy until that conversation goes quiet.` }
    case 'session.process_stopped':
      if (!session || data.startedBy !== 'human' || session.kind === 'side' || isHeadless(session)) return null
      return { kind: 'act', text: `the human's ${session.kind} conversation on it went quiet; it is free again. ${context}` }
    case 'testdrive.started':
      if (data.purpose === 'review') return null
      return { kind: 'act', text: `the human started a test drive of it.` }
    case 'testdrive.stopped':
      if (data.purpose === 'review') return null
      return { kind: 'act', text: `the human stopped the test drive of it. ${context}` }
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
    case 'session.run_ended':
      return data.complete === true
        ? { tone: 'done', words: 'Worker finished' }
        : { tone: 'failed', words: 'Worker stopped before it finished' }
    case 'run.finished': {
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
  const said = describe(event, state.session, state.ticket, state.feature.slug)
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
  const said = described(event, state)
  return said && state.feature ? `${PREFIX} ${state.feature.slug} ${said.text}` : null
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
    state.feature = { slug: feature.slug, title: feature.title, holderId, holderRunning }
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

/** Lines gathering per orchestrator thread, until their prompt goes. */
const gathering = new Map<string, { line: string; news: ReturnType<typeof orchestratorNewsFor> }[]>()

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
 * 20; chat-as-web-components decision 6): one runcastle prompt with a line per
 * event, queued to the end of a running turn and starting the thread when no
 * process runs. Best effort: nothing is retried or sent to another thread, and
 * nothing here throws into the emitter.
 */
export function notifyOrchestrator(ctx: AppCtx, eventId: number): void {
  try {
    const event = getEventRow(ctx, eventId)
    if (!event) return
    const state = stateFor(ctx, event)
    const line = orchestratorLineFor(event, state)
    const threadId = recipient(event, state)
    if (!line || !threadId) return
    const entry = { line, news: orchestratorNewsFor(event, state) }
    const gathered = gathering.get(threadId)
    if (gathered) {
      gathered.push(entry)
      return
    }
    gathering.set(threadId, [entry])
    setTimeout(() => {
      const batch = gathering.get(threadId) ?? []
      gathering.delete(threadId)
      const news = newsByFeature(batch)
      agentHost(ctx)
        .prompt(
          threadId,
          { text: batch.map((b) => b.line).join('\n') },
          { source: 'runcastle', ...(news.length > 0 ? { display: { news } } : {}) },
        )
        .catch((err) => console.error('orchestrator notifier failed', err))
    }, ORCHESTRATOR_GATHER_MS).unref?.()
  } catch (err) {
    console.error('orchestrator notifier failed', err)
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
