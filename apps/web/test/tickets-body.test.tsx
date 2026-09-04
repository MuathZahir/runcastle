// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ticket } from '@runcastle/core'

const server = vi.hoisted(() => ({ edits: [] as Record<string, unknown>[], directEdits: [] as Record<string, unknown>[], cancels: [] as Record<string, unknown>[], toasts: [] as string[], sessions: [] as Record<string, unknown>[] }))
const rows = [
  { id: 'current', featureId: 'f1', seq: 1, lap: 2, title: 'Current pending', goal: 'Goal', context: '', acceptanceCriteria: ['Works'], seams: [], blockedBy: [], kind: 'implementation', status: 'pending', commits: [] },
  { id: 'failed', featureId: 'f1', seq: 2, lap: 2, title: 'Current failed', goal: 'Goal', context: '', acceptanceCriteria: ['Works'], seams: [], blockedBy: [], kind: 'implementation', status: 'failed', commits: [] },
  { id: 'previous', featureId: 'f1', seq: 3, lap: 1, title: 'Previous pending', goal: 'Goal', context: '', acceptanceCriteria: ['Works'], seams: [], blockedBy: [], kind: 'implementation', status: 'pending', commits: [] },
] as Ticket[]

vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: (message: string) => server.toasts.push(message) }) }))
vi.mock('../src/trpc', () => ({ trpc: {
  useUtils: () => ({
    client: { ticket: { edit: { mutate: async (input: Record<string, unknown>) => { server.directEdits.push(input) } } } },
    feature: { get: { invalidate: async () => undefined }, list: { invalidate: async () => undefined } },
    events: { invalidate: async () => undefined },
  }),
  feature: {
    get: { useQuery: () => ({ data: { feature: { id: 'f1', projectId: 'p1', lap: 2 }, tickets: rows, sessions: server.sessions, docs: [] }, isLoading: false, error: null }) },
    endSession: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
  },
  settings: { get: { useQuery: () => ({ data: { fields: [] }, isLoading: false, error: null }) } },
  ticket: {
    edit: { useMutation: (options: { onSuccess?: () => void }) => ({ isPending: false, mutate: (input: Record<string, unknown>) => { server.edits.push(input); options.onSuccess?.() } }) },
    cancel: { useMutation: (options: { onSuccess?: () => void }) => ({ isPending: false, mutate: (input: Record<string, unknown>) => { server.cancels.push(input); options.onSuccess?.() } }) },
  },
} as unknown as typeof import('../src/trpc').trpc }))

const { TicketsBody } = await import('../src/components/bodies/tickets/TicketsBody')

beforeEach(() => { server.edits = []; server.directEdits = []; server.cancels = []; server.toasts = []; server.sessions = [] })
afterEach(cleanup)

describe('TicketsBody wire actions', () => {
  it('sends a model-only partial edit from the row menu', () => {
    render(<TicketsBody featureId="f1" />)
    const currentRow = screen.getByText('Current pending').closest('article')!
    fireEvent.click(within(currentRow).getByRole('button', { name: 'default model ▾' }))
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Ticket model' })).getByRole('option', { name: /gpt-5.6-sol/ }))
    expect(server.edits).toEqual([{ ticketId: 'current', model: 'gpt-5.6-sol' }])
  })

  it('bulk-edits only pending tickets from this lap and toasts the count', async () => {
    render(<TicketsBody featureId="f1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Model for all pending ▾' }))
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Model for all pending' })).getByRole('option', { name: /gpt-5.6-sol/ }))
    await vi.waitFor(() => expect(server.directEdits).toEqual([{ ticketId: 'current', model: 'gpt-5.6-sol' }]))
    await vi.waitFor(() => expect(server.toasts).toContain('1 tickets set to gpt-5.6-sol'))
  })

  it('shows an ended session as one quiet line, with no terminal and no doors', () => {
    server.sessions = [{ id: 's1', featureId: 'f1', kind: 'ideation', lap: 2, status: 'ended', createdAt: Date.now() }]
    render(<TicketsBody featureId="f1" />)
    expect(screen.getByText(/Ideation session/)).toBeTruthy()
    expect(screen.getByText(/ended/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Show terminal/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /End session/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Resume/ })).toBeNull()
  })

  it('calls ticket.cancel after the row confirmation', () => {
    render(<TicketsBody featureId="f1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand ticket #1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel ticket' }))
    const confirm = screen.getByText(/Tickets that depend on it treat it as done/).parentElement!
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel ticket' }))
    expect(server.cancels).toEqual([{ ticketId: 'current' }])
  })
})

describe('TicketsBody layout', () => {
  // The stack is a flex item of the workspace's row-direction two-pane wrapper,
  // so one that does not grow is laid out at its content width and the ledger is
  // read in half the window — the squeeze decision 6 chose a stack to avoid.
  it('grows the vertical stack to fill the workspace', () => {
    const { container } = render(<TicketsBody featureId="f1" />)
    const stack = container.firstElementChild!
    expect(stack.className).toMatch(/\bflex-1\b/)
    expect(stack.className).toMatch(/\bmin-w-0\b/)
  })
})
