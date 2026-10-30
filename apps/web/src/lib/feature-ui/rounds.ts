import type { EventRow, ReadyDeclaration, RoundGates, RoundSummary, RunStatus, TicketKind } from '@runcastle/core'
import { pendingTickets } from './tickets'

/**
 * The round trail (`the-feature-lead-runs-rounds` decision 16): every run is a
 * round, numbered per feature from its runs, with the lead's own code landings
 * and its "Ready for you" declarations between them. Old features read the same
 * way — their runs are rounds too — so nothing here looks at the historical
 * `lap` field.
 */

/** A ticket as the trail reads it — a worker, under the round that ran it. */
export interface TrailTicket {
  id: string
  seq: number
  title: string
  status: string
  kind?: TicketKind
  digest?: string
}

/** The lead's own code landing, from a `lead.code_landed` event. */
export interface CodeLanding {
  commits: { sha: string; subject: string }[]
  files: string[]
  /** The round it landed after; null before the first round. */
  afterRunId: string | null
  at: number
}

export type RoundEntry<T extends TrailTicket = TrailTicket> = {
  type: 'round'
  round: number
  runId: string
  status: RunStatus
  /** The tickets the round held, in seq order — titled "{group}: {task}" as stored. */
  workers: T[]
  landed: number
  failed: number
  gates: RoundGates | null
  /** Wall time, or null while the round is still running. */
  durationMs: number | null
  /** The lead's one-line verdict — the run's own summary for now. */
  verdict: string | null
}

export type AgentFixEntry = {
  type: 'agent-fix'
  commits: { sha: string; subject: string }[]
  files: string[]
}

export type ReadyEntry = {
  type: 'ready'
  scenario: string
  /** The round the declaration follows, or null when none had run. */
  afterRound: number | null
}

export type TrailItem<T extends TrailTicket = TrailTicket> = RoundEntry<T> | AgentFixEntry | ReadyEntry

export interface RoundTrail<T extends TrailTicket = TrailTicket> {
  /** Oldest first: each round, then what the lead did after it. */
  entries: TrailItem<T>[]
  /** Pending tickets no round has held yet — "not yet dispatched". */
  notDispatched: T[]
}

/** Reads the lead's code landings out of the event feed; malformed rows are skipped. */
export function codeLandings(events: readonly EventRow[]): CodeLanding[] {
  return events.flatMap((event) => {
    if (event.type !== 'lead.code_landed') return []
    const data = (event.data ?? {}) as { commits?: unknown; files?: unknown; afterRunId?: unknown }
    const commits = Array.isArray(data.commits)
      ? data.commits.filter(
          (c): c is { sha: string; subject: string } =>
            typeof c === 'object' && c !== null && typeof (c as { sha?: unknown }).sha === 'string',
        )
      : []
    if (commits.length === 0) return []
    const files = Array.isArray(data.files) ? data.files.filter((f): f is string => typeof f === 'string') : []
    const afterRunId = typeof data.afterRunId === 'string' ? data.afterRunId : null
    return [{ commits: commits.map((c) => ({ sha: c.sha, subject: c.subject ?? '' })), files, afterRunId, at: event.ts }]
  })
}

/**
 * The trail, oldest first. A round is placed by its number; an agent fix or a
 * ready declaration sits right after the round it follows (before every round
 * when it follows none), in the order it happened.
 */
export function roundTrail<T extends TrailTicket>(
  rounds: readonly RoundSummary[],
  tickets: readonly T[],
  declarations: readonly Pick<ReadyDeclaration, 'runId' | 'scenario' | 'createdAt'>[],
  landings: readonly CodeLanding[] = [],
  runs: readonly { id: string; summary?: string }[] = [],
): RoundTrail<T> {
  const bySeq = new Map(tickets.map((t) => [t.seq, t]))
  const roundOf = new Map(rounds.map((r) => [r.runId, r.round]))
  const summaryOf = new Map(runs.map((r) => [r.id, r.summary?.trim() || null]))
  const placed: { key: [number, number, number]; item: TrailItem<T> }[] = []

  for (const r of rounds) {
    placed.push({
      key: [r.round, 0, r.startedAt],
      item: {
        type: 'round',
        round: r.round,
        runId: r.runId,
        status: r.status,
        workers: r.ticketSeqs.flatMap((seq) => bySeq.get(seq) ?? []),
        landed: r.landed.length,
        failed: r.failed.length,
        gates: r.gates,
        durationMs: r.finishedAt !== null ? r.finishedAt - r.startedAt : null,
        verdict: summaryOf.get(r.runId) ?? null,
      },
    })
  }
  const after = (runId: string | null): number => (runId !== null ? (roundOf.get(runId) ?? 0) : 0)
  for (const fix of landings) {
    placed.push({
      key: [after(fix.afterRunId), 1, fix.at],
      item: { type: 'agent-fix', commits: fix.commits, files: fix.files },
    })
  }
  for (const d of declarations) {
    const afterRound = d.runId !== null ? (roundOf.get(d.runId) ?? null) : null
    placed.push({
      key: [afterRound ?? 0, 1, d.createdAt],
      item: { type: 'ready', scenario: d.scenario, afterRound },
    })
  }
  placed.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2])

  const held = new Set(rounds.flatMap((r) => r.ticketSeqs))
  return {
    entries: placed.map((p) => p.item),
    notDispatched: pendingTickets(tickets).filter((t) => !held.has(t.seq)),
  }
}

/** Tickets under the round that last ran them, ascending; `round: null` is "not yet dispatched", last. */
export interface RoundGroup<T> {
  round: number | null
  rows: T[]
}

/** Each ticket seq to the round that last ran it. */
export function roundOfSeq(rounds: readonly Pick<RoundSummary, 'round' | 'ticketSeqs'>[]): Map<number, number> {
  const bySeq = new Map<number, number>()
  for (const r of [...rounds].sort((a, b) => a.round - b.round)) {
    for (const seq of r.ticketSeqs) bySeq.set(seq, r.round)
  }
  return bySeq
}

export function groupByRound<T extends { seq: number }>(
  tickets: readonly T[],
  rounds: readonly Pick<RoundSummary, 'round' | 'ticketSeqs'>[],
): RoundGroup<T>[] {
  const bySeq = roundOfSeq(rounds)
  const numbers = [...new Set(bySeq.values())].sort((a, b) => a - b)
  const groups: RoundGroup<T>[] = numbers
    .map((round) => ({ round, rows: tickets.filter((t) => bySeq.get(t.seq) === round) }))
    .filter((g) => g.rows.length > 0)
  const rest = tickets.filter((t) => !bySeq.has(t.seq))
  if (rest.length > 0) groups.push({ round: null, rows: rest })
  return groups
}

/** The tickets the latest round held — every ticket handed in when no round has run. */
export function latestRoundTickets<T extends { seq: number }>(
  tickets: readonly T[],
  rounds: readonly Pick<RoundSummary, 'ticketSeqs'>[],
): T[] {
  const last = rounds.at(-1)
  if (!last) return [...tickets]
  const seqs = new Set(last.ticketSeqs)
  return tickets.filter((t) => seqs.has(t.seq))
}

// --- what the latest round landed, in prose ---------------------------------

export interface TicketAccount {
  seq: number
  title: string
  /** The burner's `DIGEST.md`, trimmed — never empty (an empty one is dropped). */
  digest: string
}

/**
 * What the review page leads with, and where it came from (decisions #8): the
 * review agent's own summary, or the workers' accounts one per ticket.
 */
export type RoundAccount =
  | { source: 'review'; prose: string }
  | { source: 'tickets'; entries: TicketAccount[] }

/**
 * The prose account of what these tickets (the latest round's, see
 * {@link latestRoundTickets}) landed, or null when no agent wrote one. The
 * review agent's digest is the summary — it ran last and saw the result
 * working; without one, the implementation tickets' own digests stand in, and
 * the card labels them as such. A review ticket that wrote no digest falls
 * through to the fallback: an empty summary is no summary.
 */
export function roundAccount(
  tickets?: readonly { seq: number; title: string; kind?: TicketKind; digest?: string }[],
): RoundAccount | null {
  const rows = tickets ?? []
  const prose = rows.filter((t) => t.kind === 'review').at(-1)?.digest?.trim()
  if (prose) return { source: 'review', prose }
  const entries = rows.flatMap((t) => {
    const digest = t.kind === 'review' ? '' : (t.digest?.trim() ?? '')
    return digest ? [{ seq: t.seq, title: t.title, digest }] : []
  })
  return entries.length > 0 ? { source: 'tickets', entries } : null
}
