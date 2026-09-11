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
vi.mock('../src/components/SessionPanel', () => ({ SessionPanel: () => null }))
vi.mock('../src/components/run/LaneTranscript', () => ({ LaneTranscript: () => null }))
vi.mock('../src/trpc', () => ({ trpc: {
  useUtils: () => ({ feature: { get: { invalidate: async () => undefined } } }),
  feature: {
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

  /** ADR-0006: the server refuses a retry mid-run, so nothing offers one. */
  it('leaves a live run’s failed lane the retry it has today, and no retry-on-a-model', () => {
    mount()
    const lane = document.getElementById('lane-t2')!
    expect(within(lane).queryByRole('combobox', { name: 'Retry on…' })).toBeNull()
    fireEvent.click(within(lane).getByRole('button', { name: 'Retry' }))
    expect(server.calls).toEqual([{ call: 'ticket.retry', input: { ticketId: 't2' } }])
  })

  it('retries on a chosen model as one gesture, the edit first and the same toast after', () => {
    server.runStatus = 'done'
    mount()
    pick('lane-t2', 'Retry on…', /gpt-5.6-sol/)
    expect(server.calls).toEqual([
      { call: 'ticket.edit', input: { ticketId: 't2', model: 'gpt-5.6-sol' } },
      { call: 'ticket.retry', input: { ticketId: 't2' } },
    ])
    expect(server.toasts).toContain('resuming ticket #2 from 2 preserved commit(s)')
  })

  it('keeps the plain retry on the model the ticket already has', () => {
    server.runStatus = 'done'
    mount()
    fireEvent.click(within(document.getElementById('lane-t2')!).getByRole('button', { name: 'Retry' }))
    expect(server.calls).toEqual([{ call: 'ticket.retry', input: { ticketId: 't2' } }])
    expect(server.toasts).toContain('resuming ticket #2 from 2 preserved commit(s)')
  })

  it('offers a burning lane no menu of any kind', () => {
    mount()
    const lane = document.getElementById('lane-t3')!
    expect(within(lane).queryByRole('combobox')).toBeNull()
    expect(within(lane).getByRole('button', { name: 'Stop ticket' })).toBeTruthy()
  })
})
