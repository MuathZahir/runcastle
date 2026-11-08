import type { TicketKind } from '@runcastle/core'

/** "1 ticket" / "3 tickets" — the pluralised count these summaries are made of. */
export const noun = (count: number, singular: string): string =>
  `${count} ${singular}${count === 1 ? '' : 's'}`

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

/**
 * A feature's build progress, 0..1: its done tickets (frozen history) and
 * landed build workers (with you, on its own) over every ticket not cancelled
 * and every build worker not dropped — the same share the sidebar pie shows.
 */
export function buildShare(
  tickets: readonly { status: string }[],
  workers: readonly { kind?: string | null; status: string }[],
): number {
  const builds = workers.filter((w) => (w.kind === 'with-you' || w.kind === 'on-its-own') && w.status !== 'dropped')
  const counted = tickets.filter((ticket) => ticket.status !== 'cancelled')
  const total = counted.length + builds.length
  if (total === 0) return 0
  return (counted.filter((ticket) => ticket.status === 'done').length + builds.filter((w) => w.status === 'landed').length) / total
}

/** "1 of 1 ticket done", "2 of 3 tickets done" — pluralised on the total. */
export function ticketCountText({ done, total }: { done: number; total: number }): string {
  return `${done} of ${total} ${total === 1 ? 'ticket' : 'tickets'} done`
}

