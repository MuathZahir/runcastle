import { describe, expect, it } from 'vitest'
import { type TallyTicket, ticketTally } from '../src/ticket-tally'

const t = (over: Partial<TallyTicket>): TallyTicket => ({ kind: 'implementation', status: 'pending', ...over })

describe('ticketTally', () => {
  it('counts the feature’s work tickets, landed of total', () => {
    const tickets = [t({ status: 'done' }), t({ status: 'done' }), t({ status: 'burning' }), t({ status: 'failed' })]
    expect(ticketTally(tickets)).toEqual({ landed: 2, total: 4, waived: 0 })
  })

  it('never counts the review ticket, whatever its status', () => {
    const tickets = [t({ status: 'done' }), t({ kind: 'review', status: 'burning' }), t({ kind: 'review', status: 'done' })]
    expect(ticketTally(tickets)).toEqual({ landed: 1, total: 1, waived: 0 })
  })

  it('takes cancelled tickets out of the total and reports them as waived', () => {
    const tickets = [t({ status: 'done' }), t({ status: 'cancelled' }), t({ status: 'pending' })]
    expect(ticketTally(tickets)).toEqual({ landed: 1, total: 2, waived: 1 })
  })

  it('an untyped ticket counts as work', () => {
    expect(ticketTally([{ status: 'done' }])).toEqual({ landed: 1, total: 1, waived: 0 })
  })
})
