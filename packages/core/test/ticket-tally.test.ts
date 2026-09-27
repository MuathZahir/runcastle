import { describe, expect, it } from 'vitest'
import { type TallyTicket, ticketTally } from '../src/ticket-tally'

const t = (over: Partial<TallyTicket>): TallyTicket => ({ kind: 'implementation', status: 'pending', lap: 1, ...over })

describe('ticketTally', () => {
  it('counts this lap’s work tickets, landed of total', () => {
    const tickets = [t({ status: 'done' }), t({ status: 'done' }), t({ status: 'burning' }), t({ status: 'failed' })]
    expect(ticketTally(tickets, 1)).toEqual({ landed: 2, total: 4, waived: 0 })
  })

  it('never counts the review ticket, whatever its status', () => {
    const tickets = [t({ status: 'done' }), t({ kind: 'review', status: 'burning' }), t({ kind: 'review', status: 'done' })]
    expect(ticketTally(tickets, 1)).toEqual({ landed: 1, total: 1, waived: 0 })
  })

  it('takes cancelled tickets out of the total and reports them as waived', () => {
    const tickets = [t({ status: 'done' }), t({ status: 'cancelled' }), t({ status: 'pending' })]
    expect(ticketTally(tickets, 1)).toEqual({ landed: 1, total: 2, waived: 1 })
  })

  it('ignores other laps', () => {
    const tickets = [t({ lap: 1, status: 'done' }), t({ lap: 1, status: 'cancelled' }), t({ lap: 2, status: 'pending' })]
    expect(ticketTally(tickets, 2)).toEqual({ landed: 0, total: 1, waived: 0 })
  })

  it('places a ticket by landedLap over the lap it was stored in', () => {
    const tickets = [t({ lap: 1, landedLap: 2, status: 'done' })]
    expect(ticketTally(tickets, 2)).toEqual({ landed: 1, total: 1, waived: 0 })
    expect(ticketTally(tickets, 1)).toEqual({ landed: 0, total: 0, waived: 0 })
  })

  it('an untyped ticket counts as work', () => {
    expect(ticketTally([{ status: 'done', lap: 1 }], 1)).toEqual({ landed: 1, total: 1, waived: 0 })
  })
})
