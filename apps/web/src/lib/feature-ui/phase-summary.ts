import type { EventRow, Phase } from '@runcastle/core'
import type { FeatureFull } from '../api'
import { fmtDuration, relTime } from '../format'
import { countDecisions } from './artifact'
import { groupByLap } from './laps'
import { isTerminal } from './map'
import { sessionKindName } from './session'

/**
 * What a finished phase produced, in one line (decision 10). The read-only
 * banner and the stepper's done-step tooltip both read it here, so the two can
 * never disagree about what happened.
 *
 * Everything is derived from the feed and the docs, and every part is optional:
 * a feed that does not reach back far enough simply cannot date a phase, and an
 * omitted part is the honest answer to that — never a guess.
 */
const PHASE_TITLES = { ideation: 'Ideation', spec: 'Spec', tickets: 'Tickets' } as const

/** The phases that have a frozen record — the three this flow owns. */
export type SummaryPhase = keyof typeof PHASE_TITLES

export function isSummaryPhase(phase: Phase): phase is SummaryPhase {
  return phase === 'ideation' || phase === 'spec' || phase === 'tickets'
}

/** What the summary is derived from — the feature, the feed, and one doc read. */
export interface PhaseSummaryInput {
  phase: Phase
  full: Pick<FeatureFull, 'feature' | 'sessions' | 'tickets' | 'waypoints'>
  events: readonly EventRow[]
  /** `decisions.md`, when the caller has read it; absent omits the count. */
  decisions?: string
}

/** The phase's title plus its facts: `Ideation · 2d · 3 sessions · 12 decisions`. */
export function phaseSummary(input: PhaseSummaryInput): string | null {
  if (!isSummaryPhase(input.phase)) return null
  const facts = phaseFacts(input)
  return facts ? `${PHASE_TITLES[input.phase]} · ${facts}` : PHASE_TITLES[input.phase]
}

/**
 * The facts alone, without the phase title — what the read-only banner renders
 * dim beside the title it already shows in bold. Null when nothing at all could
 * be derived.
 */
export function phaseFacts({ phase, full, events, decisions }: PhaseSummaryInput): string | null {
  if (!isSummaryPhase(phase)) return null
  const parts =
    phase === 'ideation'
      ? ideationFacts({ full, events, decisions })
      : phase === 'spec'
        ? specFacts(events)
        : ticketFacts(full)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** The session kinds that belong to ideation — the ones the map and grill open. */
const IDEATION_KINDS = new Set(['ideation', 'waypoint', 'converge'])

function ideationFacts({
  full,
  events,
  decisions,
}: Omit<PhaseSummaryInput, 'phase'>): string[] {
  const window = phaseWindow('ideation', full, events)
  const parts: string[] = []
  const span = windowSpan(window)
  if (span) parts.push(span)
  const sessions = ideationSessions(full, window)
  parts.push(`${sessions.length} session${sessions.length === 1 ? '' : 's'}`)
  if (decisions !== undefined) {
    const count = countDecisions(decisions)
    parts.push(`${count} decision${count === 1 ? '' : 's'}`)
  }
  if (full.feature.mapped) {
    const count = full.waypoints.length
    parts.push(`${count} waypoint${count === 1 ? '' : 's'}`)
  }
  return parts
}

/**
 * When the spec was written. `DocSummary` carries no timestamp, so the docs
 * watcher's `docs.changed` event is what dates the file — the last one that
 * named `spec.md`. A feed that never saw one says nothing.
 */
function specFacts(events: readonly EventRow[]): string[] {
  const written = [...events]
    .reverse()
    .find((event) => event.type === 'docs.changed' && changedFiles(event).some(isSpecFile))
  return written ? [`written ${relTime(written.ts)} ago`] : []
}

function isSpecFile(file: string): boolean {
  return file.split(/[\\/]/).pop() === 'spec.md'
}

function changedFiles(event: EventRow): string[] {
  const files = eventData(event)?.files
  return Array.isArray(files) ? files.filter((file): file is string => typeof file === 'string') : []
}

/**
 * What the ledger holds, per lap from lap 2 (decision 9) — the same grouping the
 * ledger itself renders, so the banner cannot claim a count the rows deny.
 */
function ticketFacts(full: Pick<FeatureFull, 'feature' | 'tickets'>): string[] {
  const count = (rows: readonly FeatureFull['tickets'][number][]) =>
    `${rows.length} emitted, ${rows.filter((ticket) => ticket.status === 'done').length} done`
  if (full.feature.lap <= 1) return [count(full.tickets)]
  return groupByLap(full.tickets, full.feature.lap).map(
    (group) => `lap ${group.lap} · ${count(group.rows)}`,
  )
}

// --- phase windows ----------------------------------------------------------

/** When a phase began and ended, as far as the feed can say. */
export interface PhaseWindow {
  from?: number
  to?: number
}

/**
 * The span a phase occupied. Ideation runs from the feature's creation (or the
 * `feature.started` event, for a draft that was parked first) to the first
 * transition into spec; each later phase runs from the previous boundary to its
 * own.
 */
export function phaseWindow(
  phase: SummaryPhase,
  full: Pick<FeatureFull, 'feature'>,
  events: readonly EventRow[],
): PhaseWindow {
  const specAt = firstTransitionTo(events, 'spec')
  if (phase === 'ideation') {
    const started = events.find((event) => event.type === 'feature.started')?.ts
    return { from: started ?? full.feature.createdAt, to: specAt }
  }
  const ticketsAt = firstTransitionTo(events, 'tickets')
  if (phase === 'spec') return { from: specAt, to: ticketsAt }
  return { from: ticketsAt, to: firstTransitionTo(events, 'implementation') }
}

function windowSpan(window: PhaseWindow): string | undefined {
  return window.from !== undefined && window.to !== undefined
    ? relTime(window.from, window.to)
    : undefined
}

function inWindow(ts: number | undefined, window: PhaseWindow): boolean {
  if (ts === undefined) return false
  return (window.from === undefined || ts >= window.from) && (window.to === undefined || ts <= window.to)
}

/**
 * When the feature first entered `phase`. Matched on the `{ from, to }` payload
 * every `setPhase` carries rather than on the event's type: the burn crosses
 * into implementation as `burn.started` and Iterate loops back as `lap.started`,
 * and both are phase transitions exactly as `phase.advanced` is.
 */
function firstTransitionTo(events: readonly EventRow[], phase: Phase): number | undefined {
  return events.find((event) => {
    const data = eventData(event)
    return typeof data?.from === 'string' && data.to === phase
  })?.ts
}

function eventData(event: EventRow): Record<string, unknown> | null {
  return typeof event.data === 'object' && event.data !== null
    ? (event.data as Record<string, unknown>)
    : null
}

// --- the sessions that ran (pinned ideation) --------------------------------

/** One quiet row in a pinned phase's session list (decision 10). */
export interface PhaseSessionRow {
  id: string
  /** `Ideation session`, `Waypoint session` — the strip's own naming. */
  name: string
  startedAt?: number
  /** Wall time to `session.ended`, when the feed recorded one. */
  duration?: string
  /** The one thing this session settled, when the feed and the map can say it. */
  fact?: string
}

/**
 * The ideation sessions that ran, oldest first — the record of how the idea was
 * worked. A session with no `createdAt` (a row written before sessions were
 * stamped) cannot be placed in the window and is left out rather than dated
 * wrongly.
 */
export function phaseSessions({
  full,
  events,
}: {
  full: Pick<FeatureFull, 'feature' | 'sessions' | 'tickets' | 'waypoints'>
  events: readonly EventRow[]
}): PhaseSessionRow[] {
  const window = phaseWindow('ideation', full, events)
  return ideationSessions(full, window).map((session) => {
    const endedAt = sessionEnd(events, session.id)
    return {
      id: session.id,
      name: `${sessionKindName(session)} session`,
      ...(session.createdAt === undefined ? {} : { startedAt: session.createdAt }),
      ...(session.createdAt !== undefined && endedAt !== undefined
        ? { duration: fmtDuration(session.createdAt, endedAt) }
        : {}),
      ...(sessionFact(full, events, session, endedAt) ?? {}),
    }
  })
}

function ideationSessions(
  full: Pick<FeatureFull, 'sessions'>,
  window: PhaseWindow,
): FeatureFull['sessions'] {
  return full.sessions
    .filter((session) => IDEATION_KINDS.has(session.kind) && inWindow(session.createdAt, window))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
}

function sessionEnd(events: readonly EventRow[], sessionId: string): number | undefined {
  return events.find(
    (event) =>
      (event.type === 'session.ended' || event.type === 'session.auto_ended') &&
      eventData(event)?.sessionId === sessionId,
  )?.ts
}

/**
 * What a session left behind: the grill that escalated to a map, the waypoints a
 * waypoint session terminated, the spec and tickets a converge wrote. Anything
 * else says nothing — a row that reports only when it has something to report.
 */
function sessionFact(
  full: Pick<FeatureFull, 'tickets' | 'waypoints'>,
  events: readonly EventRow[],
  session: FeatureFull['sessions'][number],
  endedAt: number | undefined,
): { fact: string } | undefined {
  if (session.kind === 'ideation') {
    const span: PhaseWindow = { from: session.createdAt, to: endedAt }
    const escalated = events.some(
      (event) => event.type === 'feature.escalated' && inWindow(event.ts, span),
    )
    return escalated ? { fact: 'escalated to a map' } : undefined
  }
  if (session.kind === 'waypoint') {
    const resolved = full.waypoints.filter(
      (waypoint) => waypoint.lastSessionId === session.id && isTerminal(waypoint),
    ).length
    return resolved > 0 ? { fact: `resolved ${resolved}` } : undefined
  }
  const emitted = full.tickets.filter((ticket) => ticket.lap === session.lap).length
  return emitted > 0
    ? { fact: `wrote spec, ${emitted} ticket${emitted === 1 ? '' : 's'}` }
    : undefined
}
