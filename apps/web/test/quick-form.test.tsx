// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParkDraftMode } from '../src/components/quick/ParkDraftMode'
import { QuickChangeMode } from '../src/components/quick/QuickChangeMode'

describe('Quick overlay modes', () => {
  afterEach(cleanup)

  it('states Quick change in one line and carries creation details in the footer', () => {
    render(<QuickChangeMode
      title="Darker empty state" duplicate={null} tickets={['Fix the chip']} writtenCount={1}
      slug="darker-empty-state" base="main" branches={['main']} detectedBranch="main"
      busy={false} ready rowRefs={{ current: [] }}
      onTitleChange={() => {}} onTicketChange={() => {}} onAddTicket={() => {}}
      onRemoveTicket={() => {}} onBasePick={() => {}} onSubmit={() => {}} onCancel={() => {}}
    />)

    expect(screen.getByText('Each sentence becomes a ticket; you review, then burn.')).toBeTruthy()
    expect(screen.getByText('feature/darker-empty-state')).toBeTruthy()
    expect(screen.getByRole('button', { name: /from main/ })).toBeTruthy()
    expect(screen.getByText('· 1 ticket + review')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create feature' })).toBeTruthy()
    expect(screen.queryByText(/creates its own feature/i)).toBeNull()
  })

  it('states Park a draft in one line and submits trimmed Notes as its brief', () => {
    const onSubmit = vi.fn()
    render(<ParkDraftMode
      title="Slack alerts" slug="slack-alerts" oneLiner="Notify builds" notes="  Keep email out of scope.  "
      duplicate={null} busy={false} ready onTitleChange={() => {}} onOneLinerChange={() => {}}
      onNotesChange={() => {}} onSubmit={onSubmit} onCancel={() => {}}
    />)

    expect(screen.getByText('A row and a title. Nothing is cut until you Start it.')).toBeTruthy()
    expect(screen.getByLabelText('Notes (optional — becomes the brief)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Park it' }))
    expect(onSubmit).toHaveBeenCalledWith('Keep email out of scope.')
  })
})
