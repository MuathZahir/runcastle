import { modelEntryFor } from '@runcastle/core'
import type { AgentRuntime, EventRow, ModelEntry, Ticket, TicketKind } from '@runcastle/core'
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

/** An Iterate whose lap session could not be opened, rolled back (decision 26g). */
export interface LapAbort {
  /** When the rollback was recorded. */
  at: number
  /** The server's own account of it, git error and all. */
  message: string
}

/**
 * The Iterate that failed, or null when the last thing the feed says about laps
 * is that one started.
 *
 * A lap whose terminal cannot be opened is rolled back whole — lap and phase
 * both — and the rollback is recorded as `lap.aborted` (`features.ts`
 * `rethinkAndLaunch`). The walked failure looked like nothing had happened: the
 * page came back exactly as it was, with the only trace of it buried in the
 * Activity feed. So the alert slot reads this, and a later `lap.started`
 * (the retry landing) is what takes it back down.
 */
export function lapAbort(events: readonly EventRow[]): LapAbort | null {
  const last = [...events]
    .reverse()
    .find((e) => e.type === 'lap.started' || e.type === 'lap.aborted')
  if (last?.type !== 'lap.aborted') return null
  return { at: last.ts, message: last.message }
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

/**
 * Which exit the ticked boxes chose, and what its button says (decision 21).
 *
 * The human never picks the road up front — Fix and Iterate were the same
 * decision entered through two doors, and asking again inside the door is the
 * duplicate choice this removes. So the road falls out of the list: anything
 * left to talk about opens lap N+1's conversation, and a list that is quick
 * fixes all the way down has nothing to discuss, so its tickets just burn.
 */
export function triageRoad(input: { quickFix: number; carried: number; nextLap: number }): {
  road: 'burn' | 'lap'
  label: string
} {
  const { quickFix, carried, nextLap } = input
  if (quickFix > 0 && carried === 0)
    return { road: 'burn', label: `Mint ${noun(quickFix, 'ticket')} and burn` }
  if (quickFix === 0) return { road: 'lap', label: `Start lap ${nextLap}` }
  return { road: 'lap', label: `Mint ${quickFix} · carry ${carried} → Start lap ${nextLap}` }
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
