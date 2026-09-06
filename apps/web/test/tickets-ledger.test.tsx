// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelEntry, Ticket } from '@runcastle/core'

const { ModelMenu } = await import('../src/components/bodies/tickets/ModelMenu')
const { TicketRow } = await import('../src/components/bodies/tickets/TicketRow')
const { TicketLedger, ticketLedgerMeta } = await import('../src/components/bodies/tickets/TicketLedger')
const { pendingTicketsForLap } = await import('../src/components/bodies/tickets/TicketsBody')

const roster: ModelEntry[] = [
  { id: 'claude-opus-5', runtime: 'claude-code', note: 'hard problems' },
  { id: 'gpt-5.6-sol', runtime: 'codex', note: 'backend' },
]
const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 't1', featureId: 'f1', seq: 1, lap: 2, title: 'Build it', goal: 'Goal', context: 'Context', acceptanceCriteria: ['Works'], seams: ['UI'], blockedBy: [], kind: 'implementation', status: 'pending', commits: [], ...over,
})
const saveStub = () => vi.fn(async () => undefined)

afterEach(() => { cleanup(); sessionStorage.clear() })

describe('ModelMenu', () => {
  it('lists runtime groups and selects an id or the project default', () => {
    const change = vi.fn()
    render(<ModelMenu value="" roster={roster} onChange={change} />)
    fireEvent.click(screen.getByRole('button', { name: 'default model ▾' }))
    expect(screen.getByText('Claude Code')).toBeTruthy()
    expect(screen.getByText('Codex')).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: /gpt-5.6-sol/ }))
    expect(change).toHaveBeenLastCalledWith('gpt-5.6-sol')
    fireEvent.click(screen.getByRole('button', { name: 'default model ▾' }))
    fireEvent.click(screen.getByRole('option', { name: /default \(project model\)/ }))
    expect(change).toHaveBeenLastCalledWith('')
  })
})

describe('TicketRow', () => {
  it('changes the row model and cancels after an inline confirmation', () => {
    const model = vi.fn(); const cancel = vi.fn()
    render(<TicketRow ticket={ticket()} roster={roster} readonly={false} onEdit={saveStub()} onModel={model} onCancel={cancel} onCopySha={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'default model ▾' }))
    fireEvent.click(screen.getByRole('option', { name: /claude-opus-5/ }))
    expect(model).toHaveBeenCalledWith('t1', 'claude-opus-5')
    fireEvent.click(screen.getByRole('button', { name: 'Expand ticket #1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel ticket' }))
    expect(screen.getByText(/Tickets that depend on it treat it as done/)).toBeTruthy()
    fireEvent.click(within(screen.getByText(/Tickets that depend/).parentElement!).getByRole('button', { name: 'Cancel ticket' }))
    expect(cancel).toHaveBeenCalledWith('t1')
  })

  it('edits text only, and keeps the editor open until the save lands', async () => {
    let land = (): void => {}
    const save = vi.fn(() => new Promise<void>((resolve) => { land = resolve }))
    render(<TicketRow ticket={ticket()} roster={roster} readonly={false} onEdit={save} onModel={vi.fn()} onCancel={vi.fn()} onCopySha={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand ticket #1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit ticket' }))
    expect(screen.getAllByRole('textbox').length).toBe(4)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByText('MODEL')).toBeNull()
    fireEvent.change(screen.getByDisplayValue('Build it'), { target: { value: 'Build it well' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save ticket' }))
    expect(save).toHaveBeenCalledWith('t1', { title: 'Build it well', goal: 'Goal', context: 'Context', acceptanceCriteria: ['Works'] })
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy()
    land()
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: /Sav/ })).toBeNull())
  })

  it('hides editing and cancellation in a readonly ledger', () => {
    render(<TicketRow ticket={ticket()} roster={roster} readonly onEdit={saveStub()} onModel={vi.fn()} onCancel={vi.fn()} onCopySha={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand ticket #1' }))
    expect(screen.queryByRole('button', { name: 'Edit ticket' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel ticket' })).toBeNull()
  })
})

describe('TicketLedger', () => {
  it('counts only non-cancelled tickets in the current lap', () => {
    expect(ticketLedgerMeta([ticket({ lap: 1, status: 'done' }), ticket({ id: 't2', seq: 2 }), ticket({ id: 't3', seq: 3, status: 'cancelled' })], 2)).toBe('0/1 done · lap 2')
  })

  it('offers one bulk model control when pending tickets exist', () => {
    const bulk = vi.fn()
    render(<TicketLedger tickets={[ticket(), ticket({ id: 't2', seq: 2, lap: 1 }), ticket({ id: 't3', seq: 3, status: 'failed' })]} currentLap={2} roster={roster} readonly={false} docs={[]} sandbox="docker" defaultModel="opus" onDoc={vi.fn()} onEdit={saveStub()} onModel={vi.fn()} onBulkModel={bulk} onCancel={vi.fn()} onCopySha={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Model for all pending ▾' }))
    fireEvent.click(screen.getAllByRole('option', { name: /gpt-5.6-sol/ })[0]!)
    expect(bulk).toHaveBeenCalledWith('gpt-5.6-sol')
  })

  it('bulk targeting includes only pending tickets in the current lap', () => {
    const rows = [ticket(), ticket({ id: 't2', lap: 1 }), ticket({ id: 't3', status: 'failed' })]
    expect(pendingTicketsForLap(rows, 2).map((row) => row.id)).toEqual(['t1'])
  })
})
