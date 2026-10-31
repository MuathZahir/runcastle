import { AUTOSTART_FAILED, AUTOSTART_SKIPPED, type EventRow, type SessionRow, type Ticket } from '@runcastle/core'
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

/**
 * The line to deliver to the holder for `event`, or null for none.
 * Pure: everything it needs about the feature, session and ticket is in `state`.
 */
export function orchestratorLineFor(event: EventRow, state: NotifyState): string | null {
  if (!event.featureId || !state.feature?.holderId) return null
  const described = describe(event, state.session, state.ticket, state.feature.slug)
  if (!described) return null
  if (described.kind === 'act' && !state.feature.holderRunning) return null
  if (record(event.data).actor === 'orchestrator' && (described.kind === 'act' || ANSWERED_END_TYPES.has(event.type))) {
    return null
  }
  return `${PREFIX} ${state.feature.slug} ${described.text}`
}

/** Read the feature, session and ticket an event names. Missing rows are left out. */
function stateFor(ctx: AppCtx, event: EventRow): NotifyState {
  const state: NotifyState = {}
  if (event.featureId) {
    const feature = getFeatureRow(ctx, event.featureId)
    const holderId = feature.status === 'shipped' ? null : (feature.heldBy ?? null)
    const holderRunning = holderId !== null && agentHost(ctx).isRunning(holderId)
    state.feature = { slug: feature.slug, holderId, holderRunning }
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
 * review ticket and the burn itself end ~20 ms apart, and two prompts would be
 * two turns for what ended together.
 */
export const ORCHESTRATOR_GATHER_MS = 300

/** Lines gathering per orchestrator thread, until their prompt goes. */
const gathering = new Map<string, string[]>()

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
function notifyOrchestrator(ctx: AppCtx, eventId: number): void {
  try {
    const event = getEventRow(ctx, eventId)
    if (!event) return
    const state = stateFor(ctx, event)
    const line = orchestratorLineFor(event, state)
    const threadId = recipient(event, state)
    if (!line || !threadId) return
    const lines = gathering.get(threadId)
    if (lines) {
      lines.push(line)
      return
    }
    gathering.set(threadId, [line])
    setTimeout(() => {
      const batch = gathering.get(threadId) ?? []
      gathering.delete(threadId)
      agentHost(ctx)
        .prompt(threadId, { text: batch.join('\n') }, { source: 'runcastle' })
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
