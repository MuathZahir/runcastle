import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { type ReviewFinding, type RoundSummary, Ticket } from '@runcastle/core'
import { TicketHistory } from '../src/components/bodies/history/HistoryView'

/**
 * The History view (burns-become-workers decision 19): a feature's old
 * tickets, frozen, read only. Tier 1 — what it shows is the markup it emits.
 */

const ticket = (seq: number, over: Partial<Ticket> = {}): Ticket =>
  Ticket.parse({
    id: `tk_${seq}`,
    featureId: 'feat_1',
    seq,
    title: `Ticket ${seq}`,
    goal: `The goal of ${seq}`,
    context: '',
    acceptanceCriteria: [],
    seams: [],
    blockedBy: [],
    status: 'done',
    commits: [],
    ...over,
  })

const round: RoundSummary = {
  round: 1,
  runId: 'run_1',
  status: 'succeeded',
  ticketSeqs: [1, 2],
  landed: [1],
  failed: [],
  gates: null,
  startedAt: 0,
  finishedAt: 120_000,
}

const finding: ReviewFinding = {
  id: 'fd_1',
  featureId: 'feat_1',
  reviewTicketId: 'tk_2',
  reviewWorkerId: null,
  kind: 'defect',
  severity: 'high',
  title: 'The form loses its input',
  location: 'src/form.tsx:12',
  citation: 'x',
  detail: 'y',
  reproStep: 'type, then blur',
  status: 'fixed',
  openReason: null,
  failureReason: null,
  fixTicketId: null,
  resolvedBy: null,
  resolutionNote: null,
  createdAt: 0,
}

const render = (tickets: Ticket[], rounds: RoundSummary[] = [round], findings: ReviewFinding[] = [finding]): string =>
  renderToStaticMarkup(createElement(TicketHistory, { tickets, rounds, findings }))

describe('TicketHistory', () => {
  const tickets = [
    ticket(1, { digest: 'Built the form and its tests.' }),
    ticket(2, { kind: 'review', title: 'Review' }),
    ticket(3, { status: 'pending', title: 'Never dispatched' }),
  ]

  it('shows each old ticket with its goal and digest, the rounds they ran in, and what a review found', () => {
    const html = render(tickets)
    expect(html).toContain('Round 1')
    expect(html).toContain('1 of 1 landed')
    expect(html).toContain('Ticket 1')
    expect(html).toContain('The goal of 1')
    expect(html).toContain('Built the form and its tests.')
    expect(html).toContain('Reviewed')
    expect(html).toContain('The form loses its input')
    // A ticket no round ran is kept too, said as never run.
    expect(html).toContain('Never run')
    expect(html).toContain('Never dispatched')
  })

  it('offers nothing to do: no button, no live log', () => {
    const html = render(tickets)
    expect(html).not.toContain('<button')
    expect(html).not.toMatch(/Retry|Stop|Cancel|Edit|Live log/)
  })

  it('shows nothing for a feature with no tickets', () => {
    expect(render([], [], [])).toBe('')
  })
})
