import { modelEntryFor } from '@runcastle/core'
import type { AgentRuntime, EventRow, ModelEntry, Ticket, TicketKind } from '@runcastle/core'
import type { FeatureFull } from '../api'
import { RUNTIME_LABEL } from '../settings'

export interface TicketAccount {
  seq: number
  title: string
  /** The burner's `DIGEST.md`, trimmed — never empty (an empty one is dropped). */
  digest: string
}

/**
 * What the review page leads with, and where it came from (decisions #8). The
 * human arrives at review to read what the lap delivered, in prose.
 */
export type LapAccount =
  /** The review agent's own summary — it ran last and saw the result working. */
  | { source: 'review'; prose: string }
  /** No review summary: the burners' own accounts, one per ticket. */
  | { source: 'tickets'; entries: TicketAccount[] }

/** A ticket as the "what landed" block reads it — its account and whose it is. */
interface DigestTicketFigure {
  seq: number
  title: string
  kind?: TicketKind
  digest?: string
  /** Which lap emitted it. Absent only in figures that predate lap scoping. */
  lap?: number
}

/**
 * The prose account of what this lap landed, or null when no agent wrote one.
 *
 * The review agent's digest is the summary (decisions #8): it runs last, holds
 * the spec plus every implementation digest, and is the only agent that saw the
 * result working — so its account beats any synthesis assembled here. It rides
 * the existing ticket-digest seam, so nothing new is stored.
 *
 * Falling back to the implementation tickets' own digests is deliberately a
 * DIFFERENT thing, and the card labels it as such: several agents each saying
 * what they did is not one account of the lap.
 *
 * Everything read here belongs to `lap`, the lap being accounted for — a heading
 * that says "What landed this lap" may never be answered by another one. Picking
 * the last review ticket in the whole batch is indistinguishable from correct
 * while a feature has only lap 1; from lap 2 on, until that lap's own review has
 * run, it presents lap 1's summary as this lap's account. A lap with nothing to
 * say says nothing (null) and the card's no-review state stands. Passing no lap
 * accounts every ticket handed in, which is what an unstamped batch means.
 *
 * Within the lap the review ticket is picked exactly as {@link reviewOutcome}
 * picks it — the last one — so the block and the row above it can never be
 * talking about different reviews. A review ticket that wrote no digest falls
 * through to the fallback: an empty summary is no summary.
 */
export function lapAccount(
  tickets?: readonly DigestTicketFigure[],
  lap?: number,
): LapAccount | null {
  const rows = (tickets ?? []).filter((t) => lap === undefined || t.lap === lap)
  const prose = rows.filter((t) => t.kind === 'review').at(-1)?.digest?.trim()
  if (prose) return { source: 'review', prose }
  const entries = rows.flatMap((t) => {
    const digest = t.kind === 'review' ? '' : (t.digest?.trim() ?? '')
    return digest ? [{ seq: t.seq, title: t.title, digest }] : []
  })
  return entries.length > 0 ? { source: 'tickets', entries } : null
}

// --- the review agent's structured findings ---------------------------------

/** The server-computed counts behind the review card's one-line verdict. */
export interface LapGroup<T> {
  lap: number
  rows: T[]
  /** Rendered expanded; every other group collapses. */
  current: boolean
}

/**
 * Rows under their lap, ascending (decisions.md #6). Ascending because that is
 * how `test-notes.md` already sections its `## Lap N` headers on disk — the UI
 * is catching up with a grouping the pipeline has had all along, not inventing
 * a second order for it.
 *
 * The expanded group is `currentLap`'s, falling back to the last lap that HAS
 * rows: a lap always begins empty, so keying purely on `feature.lap` would
 * collapse everything on screen the moment Iterate landed.
 */
export function groupByLap<T extends { lap: number }>(
  rows: readonly T[],
  currentLap: number,
): LapGroup<T>[] {
  const laps = [...new Set(rows.map((r) => r.lap))].sort((a, b) => a - b)
  const expanded = laps.includes(currentLap) ? currentLap : laps[laps.length - 1]
  return laps.map((lap) => ({
    lap,
    rows: rows.filter((r) => r.lap === lap),
    current: lap === expanded,
  }))
}

// --- per-ticket model assignment (decisions.md #4) ---------------------------

/** A ticket's model assignment as its card shows it. */
export interface TicketModelChip {
  id: string
  runtime: AgentRuntime
  /** The runtime named for a human — "Claude Code", "Codex". */
  runtimeLabel: string
}

/**
 * What a ticket's card says about the model it will burn on, or null when it
 * carries no assignment. Null is the ordinary case and shows nothing: an
 * unassigned ticket burns on whatever the ledger's own model chip already
 * names, and repeating that on every row would say nothing per ticket.
 *
 * The runtime comes from the roster rather than the id, since a model's runtime
 * is a declared property of its entry (decisions.md #3) — an id the operator has
 * since removed from the roster falls back to `modelEntryFor`'s default rather
 * than leaving the chip runtime-less.
 */
export function ticketModelChip(
  ticket: Pick<Ticket, 'model'>,
  roster: readonly ModelEntry[],
): TicketModelChip | null {
  const id = ticket.model?.trim()
  if (!id) return null
  const { runtime } = modelEntryFor(id, { models: roster })
  return { id, runtime, runtimeLabel: RUNTIME_LABEL[runtime] }
}

/** The workspace's lap banner (decisions.md #6), or null on lap 1. */
export interface LapBanner {
  lap: number
  /** When Iterate put the feature on this lap, or null if the feed cannot say. */
  startedAt: number | null
  /** What the lap before this one landed, as one line. */
  landed: string
}

/**
 * What the workspace says about the lap it is on, from lap 2 onward — which lap,
 * when it was kicked off, and what the lap before it landed. Lap 1 returns null:
 * a feature that merges first try looks exactly like the plain linear flow
 * (ADR-0010 §4), and iteration ceremony over it is noise.
 *
 * WHY this lap exists needs no lookup — Iterate is the only thing that bumps a
 * lap, so the reason is a constant the banner states in words. What the feed adds
 * is WHEN: the latest `lap.started`, UNLESS a later `lap.aborted` took that lap
 * back (a lap whose terminal could not be opened is rolled back to the previous
 * lap and phase, so its start no longer describes where the feature is). Absent
 * is a normal answer — a feed that does not reach back to the Iterate simply
 * cannot date it.
 */
export function lapBanner(
  full: Pick<FeatureFull, 'feature' | 'tickets'>,
  events: readonly EventRow[],
): LapBanner | null {
  const lap = full.feature.lap
  if (lap <= 1) return null

  const lastLapEvent = [...events]
    .reverse()
    .find((e) => e.type === 'lap.started' || e.type === 'lap.aborted')
  const previous = lap - 1
  const landed = full.tickets.filter((t) => t.lap === previous && t.status === 'done').length

  return {
    lap,
    startedAt: lastLapEvent?.type === 'lap.started' ? lastLapEvent.ts : null,
    landed: `Lap ${previous} landed ${
      landed === 0 ? 'no tickets' : `${landed} ticket${landed === 1 ? '' : 's'}`
    }`,
  }
}

export interface LapChipFigure {
  label: string
  story: string
  promotedFromEarlier: number
}

export function lapChip(
  tickets: readonly { kind?: TicketKind; status: string; lap: number; landedLap?: number }[],
  feature: { lap: number; lapSessionRan?: boolean },
): LapChipFigure {
  const implementation = tickets.filter((ticket) => ticket.kind !== 'review' && (ticket.landedLap ?? ticket.lap) === feature.lap)
  const landed = implementation.filter((ticket) => ticket.status === 'done').length
  const promotedFromEarlier = implementation.filter((ticket) => ticket.lap < feature.lap).length
  const story = feature.lapSessionRan
    ? `Lap ${feature.lap}'s session digested your notes and emitted this lap's tickets`
    : `Lap ${feature.lap} is open — its session will digest your notes and emit this lap's tickets`
  return { label: `Lap ${feature.lap} · ${landed} of ${implementation.length} tickets landed`, story, promotedFromEarlier }
}

const noun = (count: number, singular: string) => `${count} ${singular}${count === 1 ? '' : 's'}`

export function triageFooter(input: {
  quickFix: number
  carried: number
  nextLap: number
  standing: readonly { count: number; lap: number }[]
}): string {
  const parts: string[] = []
  if (input.quickFix > 0) parts.push(`${noun(input.quickFix, 'ticket')} will mint`)
  if (input.carried > 0) parts.push(`${noun(input.carried, 'note')} carried into the lap conversation`)
  if (input.quickFix === 0 && input.carried > 0) parts.push(`review what you're bringing to the conversation → Start lap ${input.nextLap}`)
  for (const debt of input.standing) {
    if (debt.count > 0) parts.push(`${noun(debt.count, 'unburned fix ticket')} from lap ${debt.lap} will burn with these`)
  }
  return parts.join(' · ')
}

export function burnLabel(
  pending: readonly { lap: number }[],
  lap: number,
): string {
  const current = pending.filter((ticket) => ticket.lap === lap).length
  const carried = pending.length - current
  const base = `Burn ${noun(pending.length, 'ticket')}`
  if (carried === 0) return base
  const previousLaps = [...new Set(pending.filter((ticket) => ticket.lap !== lap).map((ticket) => ticket.lap))]
  const carriedLabel = previousLaps.length === 1 ? ` · ${carried} carried from lap ${previousLaps[0]}` : ` · ${carried} carried from earlier laps`
  return `${base} — ${current} from lap ${lap}${carriedLabel}`
}

// --- the map rail (mapped ideation) ----------------------------------------

/**
 * The map doc's path, or undefined when the feature isn't mapped or nothing is
 * charted yet. One implementation so the rail's read and the next-step bar's fog
 * read resolve the SAME `docs.read` query key and share a single fetch.
 */
