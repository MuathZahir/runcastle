import type { EventRow, Project, SessionRow, Ticket } from '@runcastle/core'
import { type SQL, and, asc, desc, eq, gt, inArray, isNotNull, ne, sql } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { events, features, sessions, tickets } from '../db/schema'
import { activeProjectSession, getSessionRow } from '../launcher/sessions'
import { subscribeLive } from './bus'
import { getEventRow } from './events'
import { deliveryFor } from './orchestrator-delivery'
import { queueOrchestratorLine } from './orchestrator-messages'
import { getFeatureRow } from './repo'
import { getTicket } from './tickets'

/**
 * What the orchestrator hears about the features it follows
 * (`whole-cuts-plan-themselves` decisions 11, 13, 20; `one-orchestrator-no-mode`
 * decision 3): one `[runcastle]` line delivered into the live project session
 * (see `orchestrator-delivery.ts`), and a catch-up list in its briefing when the
 * human reopens it.
 *
 * A feature is FOLLOWED while it is not shipped and at least one of its events
 * carries `actor: 'orchestrator'` — one the orchestrator created, messaged,
 * planned, started, drove or merged. It is read from the events table; nothing
 * is stored on the feature.
 *
 * Two kinds of event reach it, both only on followed features:
 *
 * - END events — something it may be waiting on is over. Forwarded whoever
 *   started the work, except a merge's landing or conflict stamped
 *   `actor: 'orchestrator'`, which `merge_feature` already returned. The only
 *   kind the catch-up lists.
 * - ACT events — the human did something on a followed feature. Forwarded only when
 *   not stamped `actor: 'orchestrator'`, since the orchestrator's own tool call
 *   already answered it in the call's result.
 *
 * | Event type                        | Kind | When                                        |
 * |-----------------------------------|------|---------------------------------------------|
 * | `session.self_plan_ended`         | end  | a self-planning run exited (`data.complete`) |
 * | `session.run_ended`               | end  | a headless run exited                       |
 * | `run.finished`                    | end  | a round finished or failed (`data.status`)  |
 * | `feature.waiting`                 | end  | the agent waits for the human (`data.why`)  |
 * | `feature.ready_declared`          | end  | the agent declared the work ready to test   |
 * | `lead.wake_failed`                | end  | runcastle could not wake the agent          |
 * | `ticket.done` / `ticket.failed`   | end  | only for a review or verification ticket    |
 * | `feature.shipped`                 | end  | a merge landed                              |
 * | `merge.conflict`                  | end  | a merge conflicted                          |
 * | `testdrive.dev_failed`            | end  | a drive's dev server failed to start        |
 * | `session.launched`                | act  | a session with a terminal opened            |
 * | `session.pty_exited`              | act  | a session with a terminal ended             |
 * | `testdrive.started` / `.stopped`  | act  | a test drive (not the review agent's)       |
 *
 * A merge is its landing or conflict above. Project-level events produce nothing.
 */

/** What the notifier needs to know about an event beyond its row. */
export interface NotifyState {
  /** The event's feature; absent for a project-level event. */
  feature?: { slug: string; followed: boolean }
  /** The session the event names (`data.sessionId`), when there is one. */
  session?: Pick<SessionRow, 'kind' | 'purpose' | 'headless'>
  /** The ticket the event is about, when there is one. */
  ticket?: Pick<Ticket, 'seq' | 'kind' | 'passKind'>
}

type Described = { kind: 'end' | 'act'; text: string }

const PREFIX = '[runcastle]'

/** The longest a summary carried from an event gets, so a line stays one short line. */
const SUMMARY_MAX = 80

/** Lines the catch-up lists before it stops counting them out. */
const CATCH_UP_MAX = 50

/** The waiting reason `declareReady` sets; the ready line speaks for it. */
const READY_REASON = 'ready to test'

/** The longest a waiting reason gets in a line: it is what the agent asked, so it runs longer. */
const WHY_MAX = 200

/** The event types that can be END events — the catch-up's query filter. */
const END_TYPES = [
  'session.self_plan_ended',
  'session.run_ended',
  'run.finished',
  'feature.waiting',
  'feature.ready_declared',
  'lead.wake_failed',
  'ticket.done',
  'ticket.failed',
  'feature.shipped',
  'merge.conflict',
  'testdrive.dev_failed',
]

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
    case 'session.launched':
      // A lead woken headless is runcastle delivering to it, not the human acting.
      // A side session never makes the feature busy: it holds no terminal slot.
      if (!session || session.purpose === 'lead-wake' || session.kind === 'side') return null
      if (isHeadless(session)) return { kind: 'act', text: `the human had it plan itself. Wait for the run to end.` }
      return { kind: 'act', text: `the human opened a ${session.kind} session on it; it is busy until that session ends.` }
    case 'session.pty_exited':
      // A headless run's end is its own END event above.
      if (!session || isHeadless(session) || session.kind === 'side') return null
      return { kind: 'act', text: `the human's ${session.kind} session on it ended; it is free again. ${context}` }
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
 * The line to deliver to a live orchestrator for `event`, or null for none.
 * Pure: everything it needs about the feature, session and ticket is in `state`.
 */
export function orchestratorLineFor(event: EventRow, state: NotifyState): string | null {
  if (!event.featureId || !state.feature?.followed) return null
  const described = describe(event, state.session, state.ticket, state.feature.slug)
  if (!described) return null
  if (record(event.data).actor === 'orchestrator' && (described.kind === 'act' || ANSWERED_END_TYPES.has(event.type))) {
    return null
  }
  return `${PREFIX} ${state.feature.slug} ${described.text}`
}

/** The followed features `where` selects: unshipped, with an orchestrator-stamped event. */
function followedFeatures(ctx: AppCtx, where: SQL): { id: string; slug: string }[] {
  const orchestratorActed = sql`exists (select 1 from ${events} where ${events.featureId} = ${features.id} and json_extract(${events.data}, '$.actor') = 'orchestrator')`
  return ctx.db
    .select({ id: features.id, slug: features.slug })
    .from(features)
    .where(and(where, ne(features.status, 'shipped'), orchestratorActed))
    .all()
}

/** Read the feature, session and ticket an event names. Missing rows are left out. */
function stateFor(ctx: AppCtx, event: EventRow): NotifyState {
  const state: NotifyState = {}
  if (event.featureId) {
    const feature = getFeatureRow(ctx, event.featureId)
    const followed = followedFeatures(ctx, eq(features.id, feature.id)).length > 0
    state.feature = { slug: feature.slug, followed }
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
 * Add the line for one event to the project's live orchestrator's pending
 * message and kick its runtime's delivery (decision 20). Best effort: nothing
 * is retried, and nothing here throws into the emitter.
 */
function notifyOrchestrator(ctx: AppCtx, projectId: string, eventId: number): void {
  try {
    const orchestrator = activeProjectSession(ctx, projectId, 'project')
    if (!orchestrator) return
    const event = getEventRow(ctx, eventId)
    if (!event) return
    const line = orchestratorLineFor(event, stateFor(ctx, event))
    if (!line) return
    queueOrchestratorLine(orchestrator.id, line)
    deliveryFor(orchestrator).kick(orchestrator)
  } catch (err) {
    console.error('orchestrator notifier failed', err)
  }
}

/**
 * One line per thing that ended on the followed features since the project's
 * last project session ended, oldest first. Nothing when there never was one:
 * a first orchestrator has nothing to catch up on.
 */
export function orchestratorCatchUp(ctx: AppCtx, project: Project): string[] {
  const last = ctx.db
    .select({ endedAt: sessions.endedAt })
    .from(sessions)
    .where(
      and(
        eq(sessions.projectId, project.id),
        eq(sessions.kind, 'project'),
        isNotNull(sessions.endedAt),
      ),
    )
    .orderBy(desc(sessions.endedAt))
    .limit(1)
    .get()
  if (!last?.endedAt) return []

  const followed = followedFeatures(ctx, eq(features.projectId, project.id))
  if (followed.length === 0) return []
  const slugs = new Map(followed.map((f) => [f.id, f.slug]))

  const ids = ctx.db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        inArray(events.featureId, [...slugs.keys()]),
        inArray(events.type, END_TYPES),
        gt(events.ts, last.endedAt),
      ),
    )
    .orderBy(asc(events.id))
    .all()

  const lines: string[] = []
  for (const { id } of ids) {
    const event = getEventRow(ctx, id)
    const slug = event?.featureId ? slugs.get(event.featureId) : undefined
    if (!event || !slug) continue
    const described = describe(event, undefined, ticketFor(ctx, event), slug)
    if (described?.kind === 'end') lines.push(`${slug} ${described.text}`)
  }
  if (lines.length <= CATCH_UP_MAX) return lines
  return [
    ...lines.slice(0, CATCH_UP_MAX),
    `…and ${lines.length - CATCH_UP_MAX} more — read get_project_context`,
  ]
}

/**
 * Subscribe the notifier to the live event bus; returns the unsubscribe. Called
 * once at boot.
 */
export function startOrchestratorNotifier(ctx: AppCtx): () => void {
  return subscribeLive((signal) => {
    if (signal.kind === 'event') notifyOrchestrator(ctx, signal.projectId, signal.eventId)
  })
}
