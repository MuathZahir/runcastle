import { modelEntryFor } from '@runcastle/core'
import type { AgentRuntime, ModelEntry, Ticket, TicketKind } from '@runcastle/core'
import { RUNTIME_LABEL } from '../settings'

/** "1 ticket" / "3 tickets" — the pluralised count these summaries are made of. */
export const noun = (count: number, singular: string): string =>
  `${count} ${singular}${count === 1 ? '' : 's'}`

/**
 * The tickets a round would still RUN — the client's copy of the server's
 * `isPendingTicket` (services/tickets.ts). Anything terminal is behind the
 * round rather than in front of it.
 */
export function pendingTickets<T extends { status: string }>(tickets: readonly T[]): T[] {
  return tickets.filter(
    (ticket) =>
      ticket.status !== 'done' && ticket.status !== 'failed' && ticket.status !== 'cancelled',
  )
}

/**
 * The one ticket count every surface states: the feature's work tickets, the
 * review tickets and waived (cancelled) tickets never counted.
 */
export function ticketCount(
  tickets: readonly { kind?: TicketKind; status: string }[],
): { done: number; total: number } {
  const work = tickets.filter((ticket) => ticket.kind !== 'review' && ticket.status !== 'cancelled')
  return { done: work.filter((ticket) => ticket.status === 'done').length, total: work.length }
}

/**
 * How far the feature's work has got, 0..1, for its progress glyph
 * (tickets-and-review-are-tools-not-phases decision 9): the share of its
 * tickets that landed, review tickets included and cancelled ones not counted.
 * No ticket is no progress.
 */
export function landedShare(tickets: readonly { status: string }[]): number {
  const counted = tickets.filter((ticket) => ticket.status !== 'cancelled')
  if (counted.length === 0) return 0
  return counted.filter((ticket) => ticket.status === 'done').length / counted.length
}

/** "1 of 1 ticket done", "2 of 3 tickets done" — pluralised on the total. */
export function ticketCountText({ done, total }: { done: number; total: number }): string {
  return `${done} of ${total} ${total === 1 ? 'ticket' : 'tickets'} done`
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
  const { runtime } = modelEntryFor(id, { discovered: [], models: roster })
  return { id, runtime, runtimeLabel: RUNTIME_LABEL[runtime] }
}
