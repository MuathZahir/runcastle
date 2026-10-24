// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ticket } from '@runcastle/core'

/**
 * What a lane's model menu reaches. Tier 2 because a click is not a string:
 * which lanes carry the menu is markup and is tested in `run-lanes.test.ts`;
 * what is asked here is that a choice lands on `ticket.edit` mid-run, and that
 * retry-on-a-model is `ticket.edit` THEN `ticket.retry` — the order the
 * composition depends on, since the burn resolves the row the edit just wrote.
 *
 * tRPC is the true boundary and the only thing stubbed.
 */
const server = vi.hoisted(() => ({
  calls: [] as { call: string; input: Record<string, unknown> }[],
  toasts: [] as string[],
  runStatus: 'running' as string,
  tickets: [] as unknown[],
}))

const record = (call: string) => (input: Record<string, unknown>, options?: { onSuccess?: (r: unknown) => void }) => {
  server.calls.push({ call, input })
  options?.onSuccess?.({ resumedFrom: 'runcastle/ticket/demo/1-aaa', preservedCommits: 2 })
}

vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: (message: string) => server.toasts.push(message) }) }))
vi.mock('../src/lib/events', () => ({ useEventLog: () => [] }))
vi.mock('../src/lib/live', () => ({ useLivePoll: () => false }))
vi.mock('../src/components/run/LaneTranscript', () => ({ LaneTranscript: () => null }))
vi.mock('../src/lib/reviews', () => ({ useReviewArtifacts: () => ({ data: [] }) }))
vi.mock('../src/trpc', () => ({ trpc: {
  useUtils: () => ({ feature: { get: { invalidate: async () => undefined } } }),
  feature: {
    rounds: { useQuery: () => ({ data: [] }) },
    get: { useQuery: () => ({ data: { feature: { id: 'f1', projectId: 'p1', lap: 1, branch: 'feature/demo' }, tickets: server.tickets, sessions: [] } }) },
    launchSession: { useMutation: () => ({ isPending: false, mutate: record('launch') }) },
  },
  run: {
    get: { useQuery: () => ({ data: { id: 'r1', status: server.runStatus, startedAt: 0 } }) },
    listByFeature: { useQuery: () => ({ data: [] }) },
    cancel: { useMutation: () => ({ isPending: false, mutate: record('run.cancel') }) },
  },
  settings: { get: { useQuery: () => ({ data: { fields: [] } }) } },
  findings: { listByFeature: { useQuery: () => ({ data: { findings: [] } }) } },
  ticket: {
    edit: { useMutation: () => ({ isPending: false, mutate: record('ticket.edit') }) },
    retry: { useMutation: () => ({ isPending: false, mutate: record('ticket.retry') }) },
    stop: { useMutation: () => ({ isPending: false, mutate: record('ticket.stop') }) },
    cancel: { useMutation: () => ({ isPending: false, mutate: record('ticket.cancel') }) },
  },
} as unknown as typeof import('../src/trpc').trpc }))

const { RunBody } = await import('../src/components/bodies/RunBody')

const ticket = (over: Partial<Ticket> & { id: string; seq: number }): Ticket => ({
  featureId: 'f1', lap: 1, title: 'Build it', goal: 'Goal', context: '', acceptanceCriteria: ['Works'],
  seams: [], blockedBy: [], kind: 'implementation', status: 'pending', commits: [], ...over,
}) as Ticket

const rows = [
  ticket({ id: 't1', seq: 1, model: 'claude-opus-5' }),
  ticket({ id: 't2', seq: 2, status: 'failed', error: 'agent made no commits' }),
  ticket({ id: 't3', seq: 3, status: 'burning' }),
]

beforeEach(() => { server.calls = []; server.toasts = []; server.runStatus = 'running'; server.tickets = rows })
afterEach(cleanup)

const mount = () => render(<RunBody featureId="f1" runId="r1" />)

/** Open one lane's menu and pick the option matching `option`. */
function pick(laneId: string, menu: string, option: RegExp) {
  const lane = document.getElementById(laneId)!
  fireEvent.click(within(lane).getByRole('combobox', { name: menu }))
  fireEvent.click(within(screen.getByRole('listbox', { name: menu })).getByRole('option', { name: option }))
}

/** simplify-the-pages decision 9a: building gets the review page's Status tier. */
describe('the building page’s tiers', () => {
  // `the-feature-lead-runs-rounds` decision 24: the header's status line and
  // the round trail say it, so no Round/Tickets/Review list sits above the run.
  it('states no Round, Tickets and Review fact list above the run’s own heading', () => {
    mount()
    expect(document.querySelector('[data-tier="status"]')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Run' })).toBeTruthy()
  })

  it('leaves status and elapsed time out of the run header', () => {
    mount()
    const header = screen.getByRole('heading', { name: 'Run' }).closest('header')!
    expect(header.textContent).not.toMatch(/Running|landed|\d+s/)
  })
})

describe('reassigning a lane mid-run', () => {
  it('sends a model-only edit from a pending lane while the run is live', () => {
    mount()
    pick('lane-t1', 'Ticket model', /gpt-5.6-sol/)
    expect(server.calls).toEqual([{ call: 'ticket.edit', input: { ticketId: 't1', model: 'gpt-5.6-sol' } }])
  })

  it('clears an assignment back to the project default', () => {
    mount()
    pick('lane-t1', 'Ticket model', /default \(project model\)/)
    expect(server.calls).toEqual([{ call: 'ticket.edit', input: { ticketId: 't1', model: '' } }])
  })

  /** A failed ticket is the agent's to retry or set aside (tickets-and-review decision 12). */
  it('offers a failed lane no Retry, Retry on… or Waive, live run or not', () => {
    for (const status of ['running', 'done'] as const) {
      server.runStatus = status
      mount()
      const lane = document.getElementById('lane-t2')!
      expect(within(lane).queryByRole('button', { name: 'Retry' })).toBeNull()
      expect(within(lane).queryByRole('combobox', { name: 'Retry on…' })).toBeNull()
      expect(within(lane).queryByRole('button', { name: /Waive|Set aside/ })).toBeNull()
      cleanup()
    }
  })

  it('offers a burning lane no menu of any kind', () => {
    mount()
    const lane = document.getElementById('lane-t3')!
    expect(within(lane).queryByRole('combobox')).toBeNull()
    expect(within(lane).getByRole('button', { name: 'Stop ticket' })).toBeTruthy()
  })
})
