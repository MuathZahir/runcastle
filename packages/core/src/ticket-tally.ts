/**
 * The one ticket count — pure, IO-free. Every surface that states a count (the
 * sidebar row, the feature page's summary, header, Tickets tab, ledger, run
 * header, burn bar, stepper tooltip) reads this, so the formulas cannot drift
 * apart again: a shipped page once read "1 of 1 landed" beside "2/2 done"
 * because one of six hand-rolled filters counted the review ticket.
 *
 * The definition: this lap's work tickets, landed of total. The review ticket
 * is the review pass, not work, so it is never counted. A cancelled (waived)
 * ticket leaves the total and is reported on its own as `waived`. A ticket's
 * lap is `landedLap` when the caller knows it, else the lap it was stored in.
 */

/** The fields of a ticket the tally reads — a stored `Ticket` satisfies it. */
export interface TallyTicket {
  kind?: string
  status: string
  lap: number
  landedLap?: number
}

export interface TicketTally {
  /** This lap's work tickets that landed (status `done`). */
  landed: number
  /** This lap's work tickets, waived ones excluded. */
  total: number
  /** This lap's cancelled work tickets. */
  waived: number
}

/**
 * This lap's work tickets, waived ones included — the set the tally counts, for
 * a surface that breaks it down further (the ledger's "1 failed · 2 burning").
 */
export function lapWorkTickets<T extends TallyTicket>(tickets: readonly T[], lap: number): T[] {
  return tickets.filter((ticket) => ticket.kind !== 'review' && (ticket.landedLap ?? ticket.lap) === lap)
}

export function ticketTally(tickets: readonly TallyTicket[], lap: number): TicketTally {
  const work = lapWorkTickets(tickets, lap)
  const waived = work.filter((ticket) => ticket.status === 'cancelled').length
  return {
    landed: work.filter((ticket) => ticket.status === 'done').length,
    total: work.length - waived,
    waived,
  }
}
