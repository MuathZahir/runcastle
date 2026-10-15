import type { EventRow, Project, SessionRow, Ticket } from '@runcastle/core'
import { and, asc, desc, eq, gt, inArray, isNotNull } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { events, features, sessions, tickets } from '../db/schema'
import { activeProjectSession, getSessionRow } from '../launcher/sessions'
import { writeToLiveTerminal } from '../launcher/launcher'
import { subscribeLive } from './bus'
import { getEventRow } from './events'
import { getFeatureRow } from './repo'
import { getTicket } from './tickets'

/**
 * What the orchestrator hears about its features (`whole-cuts-plan-themselves`
 * decisions 11, 13): one `[runcastle]` line typed into its terminal while it is
 * live, and a catch-up list in its briefing when the human reopens it.
 *
 * Two kinds of event reach it, both only on features it owns:
 *
 * - END events — something it may be waiting on is over. Forwarded whoever
 *   started the work, and the only kind the catch-up lists.
 * - ACT events — the human did something on its feature. Forwarded only when
 *   not stamped `actor: 'orchestrator'`, since the orchestrator's own tool call
 *   already answered it in the call's result.
 *
 * | Event type                        | Kind | When                                        |
 * |-----------------------------------|------|---------------------------------------------|
 * | `session.self_plan_ended`         | end  | a self-planning run exited (`data.complete`) |
 * | `session.run_ended`               | end  | a `relay` / headless start-lap run exited   |
 * | `run.finished`                    | end  | a burn finished or failed (`data.status`)   |
 * | `ticket.done` / `ticket.failed`   | end  | only for a review or verification ticket    |
 * | `feature.shipped`                 | end  | a merge landed                              |
 * | `merge.conflict`                  | end  | a merge conflicted                          |
 * | `testdrive.dev_failed`            | end  | a drive's dev server failed to start        |
 * | `session.launched`                | act  | a session with a terminal opened            |
 * | `session.pty_exited`              | act  | a session with a terminal ended             |
 * | `burn.started` / `burn.restarted` | act  | a burn started                              |
 * | `testdrive.started` / `.stopped`  | act  | a test drive (not the review agent's)       |
 *
 * A lap starting is the `start-lap` session opening; a merge is its landing or
 * conflict above. Project-level events produce nothing except the orchestrator
 * setting turning off, which types the stop line.
 */

/** What the notifier needs to know about an event beyond its row. */
export interface NotifyState {
  /** The event's feature; absent for a project-level event. */
  feature?: { slug: string; orchestrated: boolean }
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

export const ORCHESTRATOR_STOP_LINE = `${PREFIX} The orchestrator mode was turned off for this project. Start nothing new; runs already going finish on their own. Tell the human what is still in flight.`

/** The event types that can be END events — the catch-up's query filter. */
const END_TYPES = [
  'session.self_plan_ended',
  'session.run_ended',
  'run.finished',
  'ticket.done',
  'ticket.failed',
  'feature.shipped',
  'merge.conflict',
  'testdrive.dev_failed',
]

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
  return !!session && (session.headless === true || session.purpose === 'self-plan' || session.purpose === 'relay')
}

/** What happened and what to read next, without the prefix or the slug; null for no line. */
function describe(event: EventRow, session: NotifyState['session'], ticket: NotifyState['ticket'], slug: string): Described | null {
  const data = record(event.data)
  const context = `Read it with get_feature_context({ slug: "${slug}" }).`
  const tickets = `Read it with list_tickets({ slug: "${slug}" }).`
  switch (event.type) {
    case 'session.self_plan_ended':
      return data.complete === true
        ? { kind: 'end', text: `finished planning: decisions, preview, spec and tickets are in. ${context}` }
        : { kind: 'end', text: `stopped before the plan was complete. ${context}` }
    case 'session.run_ended':
      return data.complete === true
        ? { kind: 'end', text: `headless run finished. ${context}` }
        : { kind: 'end', text: `headless run stopped before it finished. ${context}` }
    case 'run.finished': {
      const summary = typeof data.summary === 'string' ? clip(data.summary) : ''
      const verb = data.status === 'succeeded' ? 'burn finished' : 'burn failed'
      return { kind: 'end', text: `${verb}${summary ? ` (${summary})` : ''}. ${tickets}` }
    }
    case 'ticket.done':
    case 'ticket.failed': {
      if (ticket?.kind !== 'review') return null
      const pass = ticket.passKind === 'verification' ? 'verification pass' : 'review pass'
      const verb = event.type === 'ticket.done' ? 'finished' : 'failed'
      return { kind: 'end', text: `${pass} (ticket ${ticket.seq}) ${verb}. ${tickets}` }
    }
    case 'feature.shipped':
      return { kind: 'end', text: `${clip(event.message)}: shipped. Drafts waiting on it may start now. ${context}` }
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
      if (!session) return null
      if (session.purpose === 'start-lap') {
        return { kind: 'act', text: `the human started the next lap in a chat; it is busy until that session ends.` }
      }
      if (isHeadless(session)) return { kind: 'act', text: `the human had it plan itself. Wait for the run to end.` }
      return { kind: 'act', text: `the human opened a ${session.kind} session on it; it is busy until that session ends.` }
    case 'session.pty_exited':
      // A headless run's end is its own END event above.
      if (!session || isHeadless(session)) return null
      return { kind: 'act', text: `the human's ${session.kind} session on it ended; it is free again. ${context}` }
    case 'burn.started':
    case 'burn.restarted':
      return { kind: 'act', text: `the human started a burn. Wait for it to finish.` }
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

/** Whether a project-level event is the orchestrator setting turning off. */
function isOrchestratorTurnedOff(event: EventRow): boolean {
  const data = record(event.data)
  return (
    event.type === 'settings.updated' &&
    data.key === 'orchestrator' &&
    data.scope === 'project' &&
    (data.value === false || data.value === null)
  )
}

/**
 * The line to type into a live orchestrator for `event`, or null for none.
 * Pure: everything it needs about the feature, session and ticket is in `state`.
 */
export function orchestratorLineFor(event: EventRow, state: NotifyState): string | null {
  if (!event.featureId) return isOrchestratorTurnedOff(event) ? ORCHESTRATOR_STOP_LINE : null
  if (!state.feature?.orchestrated) return null
  const described = describe(event, state.session, state.ticket, state.feature.slug)
  if (!described) return null
  if (described.kind === 'act' && record(event.data).actor === 'orchestrator') return null
  return `${PREFIX} ${state.feature.slug} ${described.text}`
}

/** The project's live orchestrating session, if it has one. */
function liveOrchestrator(ctx: AppCtx, projectId: string): SessionRow | null {
  const session = activeProjectSession(ctx, projectId, 'project')
  return session?.purpose === 'orchestrate' ? session : null
}

/** Read the feature, session and ticket an event names. Missing rows are left out. */
function stateFor(ctx: AppCtx, event: EventRow): NotifyState {
  const state: NotifyState = {}
  if (event.featureId) {
    const feature = getFeatureRow(ctx, event.featureId)
    state.feature = { slug: feature.slug, orchestrated: feature.orchestrated }
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
 * Type the line for one event into the project's live orchestrator. Best
 * effort: nothing is retried, and nothing here throws into the emitter.
 */
function notifyOrchestrator(ctx: AppCtx, projectId: string, eventId: number): void {
  try {
    const orchestrator = liveOrchestrator(ctx, projectId)
    if (!orchestrator) return
    const event = getEventRow(ctx, eventId)
    if (!event) return
    const line = orchestratorLineFor(event, stateFor(ctx, event))
    if (line) writeToLiveTerminal(orchestrator.id, line)
  } catch (err) {
    console.error('orchestrator notifier failed', err)
  }
}

/**
 * One line per thing that ended on the orchestrator's features since the
 * project's last orchestrating session ended, oldest first. Nothing when there
 * never was one: a first orchestrator has nothing to catch up on.
 */
export function orchestratorCatchUp(ctx: AppCtx, project: Project): string[] {
  const last = ctx.db
    .select({ endedAt: sessions.endedAt })
    .from(sessions)
    .where(
      and(
        eq(sessions.projectId, project.id),
        eq(sessions.purpose, 'orchestrate'),
        isNotNull(sessions.endedAt),
      ),
    )
    .orderBy(desc(sessions.endedAt))
    .limit(1)
    .get()
  if (!last?.endedAt) return []

  const owned = ctx.db
    .select({ id: features.id, slug: features.slug })
    .from(features)
    .where(and(eq(features.projectId, project.id), eq(features.orchestrated, true)))
    .all()
  if (owned.length === 0) return []
  const slugs = new Map(owned.map((f) => [f.id, f.slug]))

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
