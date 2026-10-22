// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAN_UNFINISHED, UNCOMMITTED_DESIGN, type Ticket } from '@runcastle/core'
import type { NextStep } from '../src/lib/feature-ui'
import { featureStatus, headerActions } from '../src/lib/feature-ui/status-line'

const server = vi.hoisted(() => ({ edits: [] as Record<string, unknown>[], directEdits: [] as Record<string, unknown>[], cancels: [] as Record<string, unknown>[], toasts: [] as string[], sessions: [] as Record<string, unknown>[], tickets: [] as unknown[] }))
const rows = [
  { id: 'current', featureId: 'f1', seq: 1, lap: 2, title: 'Current pending', goal: 'Goal', context: '', acceptanceCriteria: ['Works'], seams: [], blockedBy: [], kind: 'implementation', passKind: 'review', reviewedCommit: null, completedAt: null, status: 'pending', commits: [] },
  { id: 'failed', featureId: 'f1', seq: 2, lap: 2, title: 'Current failed', goal: 'Goal', context: '', acceptanceCriteria: ['Works'], seams: [], blockedBy: [], kind: 'implementation', passKind: 'review', reviewedCommit: null, completedAt: null, status: 'failed', commits: [] },
  { id: 'previous', featureId: 'f1', seq: 3, lap: 1, title: 'Previous pending', goal: 'Goal', context: '', acceptanceCriteria: ['Works'], seams: [], blockedBy: [], kind: 'implementation', passKind: 'review', reviewedCommit: null, completedAt: null, status: 'pending', commits: [] },
] as Ticket[]

vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: (message: string) => server.toasts.push(message) }) }))
vi.mock('../src/trpc', () => ({ trpc: {
  useUtils: () => ({
    client: { ticket: { edit: { mutate: async (input: Record<string, unknown>) => { server.directEdits.push(input) } } } },
    feature: { get: { invalidate: async () => undefined }, list: { invalidate: async () => undefined } },
    events: { invalidate: async () => undefined },
  }),
  feature: {
    rounds: { useQuery: () => ({ data: [] }) },
    get: { useQuery: () => ({ data: { feature: { id: 'f1', projectId: 'p1', lap: 2 }, tickets: server.tickets, sessions: server.sessions, docs: [] }, isLoading: false, error: null }) },
    endSession: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
  },
  settings: { get: { useQuery: () => ({ data: { fields: [] }, isLoading: false, error: null }) } },
  ticket: {
    edit: { useMutation: (options: { onSuccess?: () => void }) => ({ isPending: false, mutate: (input: Record<string, unknown>) => { server.edits.push(input); options.onSuccess?.() } }) },
    cancel: { useMutation: (options: { onSuccess?: () => void }) => ({ isPending: false, mutate: (input: Record<string, unknown>) => { server.cancels.push(input); options.onSuccess?.() } }) },
  },
} as unknown as typeof import('../src/trpc').trpc }))

const { TicketsBody } = await import('../src/components/bodies/tickets/TicketsBody')

beforeEach(() => { server.edits = []; server.directEdits = []; server.cancels = []; server.toasts = []; server.sessions = []; server.tickets = rows })
afterEach(() => { cleanup() })

describe('TicketsBody wire actions', () => {
  it('sends a model-only partial edit from the row menu', () => {
    render(<TicketsBody featureId="f1" />)
    const currentRow = screen.getByText('Current pending').closest('article')!
    fireEvent.click(within(currentRow).getByRole('combobox', { name: 'Ticket model' }))
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Ticket model' })).getByRole('option', { name: /gpt-5.6-sol/ }))
    expect(server.edits).toEqual([{ ticketId: 'current', model: 'gpt-5.6-sol' }])
  })

  it('bulk-edits every pending ticket, whatever lap it was stamped with, and toasts the count', async () => {
    render(<TicketsBody featureId="f1" />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Model for all pending' }))
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Model for all pending' })).getByRole('option', { name: /gpt-5.6-sol/ }))
    await vi.waitFor(() => expect(server.directEdits).toEqual([{ ticketId: 'current', model: 'gpt-5.6-sol' }, { ticketId: 'previous', model: 'gpt-5.6-sol' }]))
    await vi.waitFor(() => expect(server.toasts).toContain('2 tickets set to gpt-5.6-sol'))
  })

  /** one-chat-layout-everywhere decision 1: every session lives on the Chat tab. */
  it('holds no terminal and no session strip, live or ended — the ledger owns the body', () => {
    for (const status of ['live', 'ended']) {
      server.sessions = [{ id: 's1', featureId: 'f1', kind: 'chat', lap: 2, status, createdAt: Date.now() }]
      const { container, unmount } = render(<TicketsBody featureId="f1" />)
      expect(screen.queryByText(/Chat session/)).toBeNull()
      expect(screen.queryByRole('button', { name: /Show terminal|Hide terminal|End session/ })).toBeNull()
      expect([...container.firstElementChild!.children].map((c) => c.getAttribute('aria-label'))).toEqual(['Tickets'])
      unmount()
    }
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

  /** simplify-the-pages decision 9b: nothing has run yet, so there is no status and no history. */
  it('lays planning out as Now then Work — no Status or Reference tier', () => {
    const { container } = render(<TicketsBody featureId="f1" />)
    expect(container.querySelector('[data-tier="status"], [data-tier="reference"], dl, #lap-trail')).toBeNull()
  })
})

/**
 * Go on the tickets view (design-mode decision 12): above the list, the
 * status line's own Go — disabled with its reason when gated, with Go anyway…
 * only for the unfinished plan — and every click opens Go's confirmation.
 */
describe('TicketsBody Go', () => {
  const planning = (over: { ticketsReadyLap?: number | null; uncommittedDesign?: boolean } = {}) => {
    const status = featureStatus({
      feature: { phase: 'planning', status: 'active', lap: 2, ticketsReadyLap: over.ticketsReadyLap ?? null, waitingReason: null },
      rounds: [],
      declarations: [],
      agentWorking: false,
      driving: false,
      selfPlanning: false,
      ...(over.uncommittedDesign ? { uncommittedDesign: true } : {}),
      now: 0,
    })
    const ns: NextStep = { kick: '', secondary: [], busy: false }
    return headerActions(ns, status).go!
  }
  const mount = (action: ReturnType<typeof planning>) => {
    const onGo = vi.fn()
    const view = render(<TicketsBody featureId="f1" go={{ action, busy: false, onGo }} />)
    return { onGo, view }
  }

  it('puts an enabled Go above the ticket list once the plan is finished, opening the confirmation', () => {
    const { onGo, view } = mount(planning({ ticketsReadyLap: 2 }))
    const go = screen.getByRole('button', { name: 'Go' })
    expect(go.hasAttribute('disabled')).toBe(false)
    const firstRow = screen.getByText('Current pending')
    expect(go.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Go anyway…' })).toBeNull()
    expect(view.container.textContent).not.toContain(PLAN_UNFINISHED)
    fireEvent.click(go)
    expect(onGo).toHaveBeenCalledTimes(1)
  })

  it('is disabled with the reason beneath it before the plan is finished, and Go anyway… opens the confirmation', () => {
    const { onGo, view } = mount(planning())
    expect(screen.getByRole('button', { name: 'Go' }).hasAttribute('disabled')).toBe(true)
    expect(view.container.textContent).toContain(PLAN_UNFINISHED)
    fireEvent.click(screen.getByRole('button', { name: 'Go anyway…' }))
    expect(onGo).toHaveBeenCalledTimes(1)
  })

  it('offers no way past uncommitted design work', () => {
    const { view } = mount(planning({ ticketsReadyLap: 2, uncommittedDesign: true }))
    expect(screen.getByRole('button', { name: 'Go' }).hasAttribute('disabled')).toBe(true)
    expect(view.container.textContent).toContain(UNCOMMITTED_DESIGN)
    expect(screen.queryByRole('button', { name: 'Go anyway…' })).toBeNull()
  })

  it('has no Go where it is not handed one', () => {
    render(<TicketsBody featureId="f1" />)
    expect(screen.queryByRole('button', { name: 'Go' })).toBeNull()
  })
})
