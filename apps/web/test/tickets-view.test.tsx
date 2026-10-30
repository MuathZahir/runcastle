// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventRow, RoundSummary, Ticket } from '@runcastle/core'
import { laneFacts } from '../src/lib/feature-ui/run'

/**
 * The panel's Tickets view (the-feature-s-right-panel decisions 17–19): which
 * round is the current one, what a row says, and what an opened ticket's
 * actions reach. Tier 2 because a click is not a string; tRPC is the true
 * boundary and the only thing stubbed, recording each call in order — retry on
 * a model is `ticket.edit` THEN `ticket.retry`, since the burn resolves the row
 * the edit just wrote.
 */
const server = vi.hoisted(() => ({
  calls: [] as { call: string; input: Record<string, unknown> }[],
  toasts: [] as string[],
  tickets: [] as unknown[],
  rounds: [] as unknown[],
  runs: [] as unknown[],
  events: [] as unknown[],
  findings: [] as unknown[],
  recordings: [] as unknown[],
  boots: new Map<string, unknown[]>(),
  stopPending: false,
  failSave: false,
}))

const mutation = (call: string, result: unknown = {}) => () => ({
  isPending: call === 'ticket.stop' && server.stopPending,
  variables: call === 'ticket.stop' && server.stopPending ? { ticketId: 't3' } : undefined,
  mutate: (input: Record<string, unknown>, options?: { onSuccess?: (r: unknown) => void }) => {
    server.calls.push({ call, input })
    options?.onSuccess?.(result)
  },
  mutateAsync: async (input: Record<string, unknown>) => {
    server.calls.push({ call, input })
    if (server.failSave) throw new Error('refused')
    return result
  },
})

vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: (message: string) => server.toasts.push(message) }) }))
vi.mock('../src/lib/events', () => ({ useEventLog: () => server.events }))
vi.mock('../src/lib/live', () => ({ useLivePoll: () => false }))
vi.mock('../src/lib/land-on-chat', () => ({ useLandOnChat: () => () => undefined }))
vi.mock('../src/lib/reviews', () => ({ useReviewArtifacts: () => ({ data: server.recordings }) }))
vi.mock('../src/components/run/LaneTranscript', () => ({
  LaneTranscript: ({ ticketId, bootEvents }: { ticketId: string; bootEvents: unknown[] }) => {
    server.boots.set(ticketId, bootEvents)
    return null
  },
}))
vi.mock('../src/components/review/EvidenceStage', () => ({
  EvidenceStage: ({ recordings }: { recordings: { ticketId: string }[] }) => (
    <div data-testid="evidence-stage">{recordings.map((r) => r.ticketId).join(',')}</div>
  ),
}))
vi.mock('../src/trpc', () => ({ trpc: {
  useUtils: () => ({
    client: { ticket: { edit: { mutate: async (input: Record<string, unknown>) => { server.calls.push({ call: 'client.ticket.edit', input }) } } } },
    feature: { get: { invalidate: async () => { server.calls.push({ call: 'invalidate', input: {} }) } } },
  }),
  feature: {
    rounds: { useQuery: () => ({ data: server.rounds }) },
    get: { useQuery: () => ({ data: { feature: { id: 'f1', projectId: 'p1', branch: 'feature/demo' }, tickets: server.tickets, runs: server.runs, sessions: [] } }) },
    launchSession: { useMutation: mutation('feature.launchSession') },
  },
  settings: { get: { useQuery: () => ({ data: { fields: [] } }) } },
  findings: { listByFeature: { useQuery: () => ({ data: { findings: server.findings } }) } },
  ticket: {
    edit: { useMutation: mutation('ticket.edit') },
    retry: { useMutation: mutation('ticket.retry') },
    stop: { useMutation: mutation('ticket.stop', { stopped: true, swept: false, confirmed: true }) },
    cancel: { useMutation: mutation('ticket.cancel', { confirmed: true }) },
  },
} as unknown as typeof import('../src/trpc').trpc }))

const { TicketsView, splitRounds } = await import('../src/components/bodies/tickets/TicketsView')

const ticket = (over: Partial<Ticket> & { id: string; seq: number }): Ticket => ({
  featureId: 'f1', lap: 1, title: `Ticket ${over.seq}`, goal: 'Goal', context: '', acceptanceCriteria: ['Works'],
  seams: [], blockedBy: [], kind: 'implementation', status: 'pending', commits: [], ...over,
}) as Ticket

const round = (over: Partial<RoundSummary> & { round: number; ticketSeqs: number[] }): RoundSummary => ({
  runId: `r${over.round}`, status: 'succeeded', landed: [], failed: [], gates: null, startedAt: 0, finishedAt: 60_000, ...over,
})

const event = (over: Partial<EventRow> & { id: number; type: string }): EventRow => ({
  projectId: 'p1', featureId: 'f1', ts: over.id * 1_000, message: '', ...over,
})

beforeEach(() => {
  server.calls = []
  server.toasts = []
  server.rounds = []
  server.runs = []
  server.events = []
  server.findings = []
  server.recordings = []
  server.boots = new Map()
  server.stopPending = false
  server.failSave = false
  server.tickets = [
    ticket({ id: 't1', seq: 1, model: 'claude-opus-5' }),
    ticket({ id: 't2', seq: 2, status: 'failed', error: 'agent made no commits' }),
    ticket({ id: 't3', seq: 3, status: 'burning' }),
  ]
})
afterEach(cleanup)

const mount = () => render(<TicketsView featureId="f1" />)
const row = (seq: number) => screen.getByText(`#${seq}`).closest('article') as HTMLElement
const open = (seq: number) => {
  fireEvent.click(within(row(seq)).getAllByRole('button')[0])
  return row(seq)
}
const pick = (scope: HTMLElement, menu: string, option: RegExp) => {
  fireEvent.click(within(scope).getByRole('combobox', { name: menu }))
  fireEvent.click(within(screen.getByRole('listbox', { name: menu })).getByRole('option', { name: option }))
}
const calls = () => server.calls.filter((c) => c.call !== 'invalidate').map((c) => c.call)

describe('splitRounds', () => {
  const t = (seq: number, status: Ticket['status'] = 'done') => ticket({ id: `t${seq}`, seq, status })

  it('makes the running round current and folds the rest', () => {
    const { folded, current } = splitRounds(
      [t(1), t(2, 'burning'), t(3, 'pending')],
      [round({ round: 2, ticketSeqs: [2], status: 'running' }), round({ round: 1, ticketSeqs: [1] })],
    )
    expect(current).toMatchObject({ number: 2, running: true })
    expect(current.tickets.map((x) => x.seq)).toEqual([2])
    expect(folded.map((g) => g.round.round)).toEqual([1])
  })

  it('makes the tickets no round has run the next round once a round has finished', () => {
    const { folded, current } = splitRounds(
      [t(1), t(2, 'pending'), t(3, 'cancelled')],
      [round({ round: 1, ticketSeqs: [1] })],
    )
    expect(current).toMatchObject({ round: null, number: 2, running: false })
    expect(current.tickets.map((x) => x.seq)).toEqual([2])
    expect(folded.map((g) => g.round.round)).toEqual([1])
  })

  it('shows the latest round when nothing waits', () => {
    const { folded, current } = splitRounds(
      [t(1), t(2)],
      [round({ round: 2, ticketSeqs: [2] }), round({ round: 1, ticketSeqs: [1] })],
    )
    expect(current.round?.round).toBe(2)
    expect(current.tickets.map((x) => x.seq)).toEqual([2])
    expect(folded.map((g) => g.round.round)).toEqual([1])
  })

  it('calls the tickets before any round Round 1', () => {
    expect(splitRounds([t(1, 'pending')], []).current).toMatchObject({ round: null, number: 1 })
  })
})

describe('laneFacts', () => {
  it('dates a lane from its first event and remembers whether the agent ever spoke', () => {
    const facts = laneFacts([
      { type: 'burn.setup', ticketId: 't1', ts: 100 },
      { type: 'ticket.burning', ticketId: 't1', ts: 120 },
      { type: 'burn.text', ticketId: 't1', ts: 140 },
      { type: 'burn.setup', ticketId: 't2', ts: 105 },
      { type: 'ticket.failed', ticketId: 't2', ts: 106 },
      { type: 'run.started', ts: 90 },
    ])
    expect(facts.get('t1')).toEqual({ hadOutput: true, startedAt: 100 })
    expect(facts.get('t2')).toEqual({ hadOutput: false, startedAt: 105 })
    expect(facts.size).toBe(2)
  })
})

describe('a ticket row', () => {
  it('says its state in words', () => {
    server.tickets = [
      ticket({ id: 't1', seq: 1, status: 'done', commits: ['abcdef1234567'] }),
      ticket({ id: 't2', seq: 2, blockedBy: [3] }),
      ticket({ id: 't3', seq: 3, status: 'failed', error: 'stopped by the human' }),
      ticket({ id: 't4', seq: 4, kind: 'review', status: 'done' }),
    ]
    mount()
    expect(row(1).textContent).toContain('Landed · abcdef1')
    expect(row(2).textContent).toContain('Waits on #3')
    expect(row(3).textContent).toContain('Stopped')
    expect(row(4).textContent).toContain('Reviewed')
  })

  it('folds an earlier round to one line', () => {
    server.tickets = [ticket({ id: 't1', seq: 1, status: 'done' }), ticket({ id: 't2', seq: 2 })]
    server.rounds = [round({ round: 1, ticketSeqs: [1], landed: [1] })]
    mount()
    const fold = screen.getByRole('button', { name: /Round 1/ })
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    expect(fold.textContent).toContain('1 of 1 landed')
    expect(fold.textContent).toContain('1m')
  })

  it('times a running ticket and its log from its own latest attempt', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(100_000)
    server.runs = [{ id: 'r2', status: 'running', startedAt: 0 }]
    server.events = [
      event({ id: 10, runId: 'r1', ticketId: 't3', type: 'burn.setup' }),
      event({ id: 40, runId: 'r2', ticketId: 't3', type: 'burn.setup' }),
      event({ id: 41, runId: 'r2', ticketId: 't1', type: 'burn.setup' }),
    ]
    mount()
    expect(row(3).textContent).toContain('Running · 1m')
    open(3)
    expect((server.boots.get('t3') as EventRow[]).map((e) => e.id)).toEqual([40])
    vi.useRealTimers()
  })
})

describe('an opened ticket’s actions', () => {
  it('stops a running ticket, and says so while the stop is in flight', () => {
    mount()
    fireEvent.click(within(open(3)).getByRole('button', { name: 'Stop' }))
    expect(server.calls).toContainEqual({ call: 'ticket.stop', input: { ticketId: 't3' } })
    cleanup()
    server.stopPending = true
    mount()
    expect(within(open(3)).getByRole('button', { name: /Stopping/ })).toBeTruthy()
  })

  it('retries a failed ticket', () => {
    mount()
    fireEvent.click(within(open(2)).getByRole('button', { name: 'Retry' }))
    expect(calls()).toEqual(['ticket.retry'])
    expect(server.calls[0].input).toEqual({ ticketId: 't2' })
  })

  it('retries on another model as an edit, then a retry — only with no run live', () => {
    mount()
    pick(open(2), 'Retry on…', /gpt-5.6-sol/)
    expect(server.calls.filter((c) => c.call !== 'invalidate')).toEqual([
      { call: 'ticket.edit', input: { ticketId: 't2', model: 'gpt-5.6-sol' } },
      { call: 'ticket.retry', input: { ticketId: 't2' } },
    ])
    cleanup()
    server.runs = [{ id: 'r1', status: 'running', startedAt: 0 }]
    mount()
    expect(within(open(2)).queryByRole('combobox', { name: 'Retry on…' })).toBeNull()
  })

  it('retries fresh only behind a confirm', () => {
    mount()
    const card = open(2)
    fireEvent.click(within(card).getByRole('button', { name: 'Retry fresh' }))
    expect(calls()).toEqual([])
    expect(card.textContent).toContain('Start #2 over?')
    fireEvent.click(within(card).getByRole('button', { name: 'Retry fresh' }))
    expect(server.calls[0]).toEqual({ call: 'ticket.retry', input: { ticketId: 't2', fresh: true } })
  })

  it('sets a failed ticket aside', () => {
    mount()
    const card = open(2)
    fireEvent.click(within(card).getByRole('button', { name: 'Set aside' }))
    fireEvent.click(within(card).getByRole('button', { name: 'Set aside' }))
    expect(server.calls[0]).toEqual({ call: 'ticket.cancel', input: { ticketId: 't2', reason: 'set aside from the Tickets view' } })
  })

  it('names a landing conflict’s files and opens a terminal to resolve it', () => {
    server.tickets = [ticket({ id: 't2', seq: 2, status: 'failed', conflictFiles: ['src/a.ts'], attemptBranch: 'runcastle/ticket/demo/2-x' })]
    mount()
    const card = open(2)
    expect(card.textContent).toContain('src/a.ts')
    expect(within(card).getByRole('button', { name: 'Resolve with agent' })).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Resolve in terminal' }))
    expect(server.calls[0]).toMatchObject({
      call: 'feature.launchSession',
      input: { featureId: 'f1', purpose: 'resolve-conflict', purposeData: { mergeFrom: 'runcastle/ticket/demo/2-x', mergeInto: 'feature/demo' } },
    })
  })

  it('reassigns a waiting ticket’s model', () => {
    mount()
    pick(open(1), 'Ticket model', /default \(project model\)/)
    expect(server.calls[0]).toEqual({ call: 'ticket.edit', input: { ticketId: 't1', model: '' } })
  })

  it('cancels a waiting ticket only behind a confirm', () => {
    mount()
    const card = open(1)
    fireEvent.click(within(card).getByRole('button', { name: 'Cancel' }))
    expect(calls()).toEqual([])
    expect(card.textContent).toContain('Tickets that depend on it treat it as done')
    fireEvent.click(within(card).getByRole('button', { name: 'Cancel' }))
    expect(server.calls[0]).toEqual({ call: 'ticket.cancel', input: { ticketId: 't1' } })
  })

  it('keeps the editor open when a save fails', async () => {
    server.failSave = true
    mount()
    fireEvent.click(within(open(1)).getByRole('button', { name: 'Edit' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save ticket' }))
    })
    expect(server.calls[0]).toMatchObject({ call: 'ticket.edit', input: { ticketId: 't1', title: 'Ticket 1' } })
    expect(screen.getByRole('button', { name: 'Save ticket' })).toBeTruthy()
  })

  it('offers a running ticket no model menu, edit or cancel', () => {
    mount()
    const card = open(3)
    expect(within(card).queryByRole('combobox')).toBeNull()
    expect(within(card).queryByRole('button', { name: /Edit|Cancel/ })).toBeNull()
  })
})

describe('a done review ticket', () => {
  beforeEach(() => {
    server.tickets = [ticket({ id: 'rv', seq: 5, kind: 'review', status: 'done' })]
    server.findings = [
      { id: 'o1', reviewTicketId: 'rv', kind: 'observation', title: 'Spacing is loose' },
      { id: 'd1', reviewTicketId: 'rv', kind: 'defect', title: 'Save drops the title' },
      { id: 'd2', reviewTicketId: 'other', kind: 'defect', title: 'Someone else’s' },
    ]
  })

  it('lists what it found, defects first', () => {
    mount()
    const part = within(open(5)).getByRole('heading', { name: 'Findings' }).closest('section') as HTMLElement
    const items = within(part).getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual(['Save drops the title', 'Spacing is loose'])
  })

  it('plays its walkthrough in the evidence stage, and offers none without a recording', () => {
    mount()
    expect(within(open(5)).queryByRole('button', { name: 'Watch the walkthrough' })).toBeNull()
    cleanup()
    server.recordings = [{ ticketId: 'rv', seq: 5, videoUrl: '/api/reviews/ticket/rv/video' }]
    mount()
    fireEvent.click(within(open(5)).getByRole('button', { name: 'Watch the walkthrough' }))
    expect(screen.getByTestId('evidence-stage').textContent).toBe('rv')
  })
})

describe('the list menu', () => {
  it('sets every waiting ticket to one model, one edit at a time, then one toast', async () => {
    server.tickets = [ticket({ id: 't1', seq: 1 }), ticket({ id: 't2', seq: 2 }), ticket({ id: 't3', seq: 3, status: 'done' })]
    mount()
    const trigger = screen.getByRole('button', { name: 'Ticket list options' })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /gpt-5.6-sol/ }))
    })
    expect(server.calls).toEqual([
      { call: 'client.ticket.edit', input: { ticketId: 't1', model: 'gpt-5.6-sol' } },
      { call: 'client.ticket.edit', input: { ticketId: 't2', model: 'gpt-5.6-sol' } },
      { call: 'invalidate', input: {} },
    ])
    expect(server.toasts).toEqual(['2 tickets set to gpt-5.6-sol'])
  })
})
