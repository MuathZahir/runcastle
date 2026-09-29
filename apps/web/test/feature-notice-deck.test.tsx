// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventRow } from '@runcastle/core'
import { FeatureNoticeDeck } from '../src/components/chat/FeatureNoticeDeck'

/**
 * The notice deck mounted over the feature Chat tab (one-chat-layout-everywhere
 * decisions 3, 4, 10). Tier 2: what matters is which events arrive while the
 * tab is in front, and what the card buttons do afterwards.
 */
const NOW = 1_800_000_000_000

let nextId = 1
function event(type: string, message: string, ts = NOW + 1_000): EventRow {
  return { id: nextId++, projectId: 'proj_1', featureId: 'feat_1', ts, type, message }
}
const ticketsStored = (ts?: number) => event('tickets.stored', 'stored 3 tickets', ts)
const noteAdded = () => event('note.added', 'note added')

function setup(initial: EventRow[] = [], active = true) {
  const onView = vi.fn()
  const view = (events: EventRow[], isActive: boolean) => (
    <FeatureNoticeDeck events={events} tickets={[]} active={isActive} onView={onView} />
  )
  const { rerender } = render(view(initial, active))
  return { onView, update: (events: EventRow[], isActive = active) => rerender(view(events, isActive)) }
}

const cards = () => document.querySelectorAll('article')

describe('FeatureNoticeDeck', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'setInterval'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('replays nothing on mount — not even history the log loads afterwards', () => {
    const history = [ticketsStored(NOW - 60_000)]
    const { update } = setup([])
    update(history)
    expect(screen.queryByText('Tickets updated')).toBeNull()
  })

  it('raises a notice for a change that arrives while Chat is in front', () => {
    const { update } = setup([])
    update([ticketsStored()])
    expect(screen.getByText('Tickets updated')).toBeTruthy()
  })

  it('raises nothing for an event the mapping ignores', () => {
    const { update } = setup([])
    update([noteAdded()])
    expect(cards()).toHaveLength(0)
  })

  it('raises nothing while another tab is in front, and does not replay it on return', () => {
    const { update } = setup([], false)
    const missed = [ticketsStored()]
    update(missed, false)
    vi.setSystemTime(NOW + 5_000)
    update(missed, true)
    expect(screen.queryByText('Tickets updated')).toBeNull()
  })

  it('View switches to the notice’s tab and takes the card away', () => {
    const { update, onView } = setup([])
    update([ticketsStored()])
    fireEvent.click(screen.getByRole('button', { name: /View tickets/ }))
    expect(onView).toHaveBeenCalledWith('tickets')
    expect(screen.queryByText('Tickets updated')).toBeNull()
  })

  it('✕ takes the card away without switching tabs', () => {
    const { update, onView } = setup([])
    update([ticketsStored()])
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onView).not.toHaveBeenCalled()
    expect(screen.queryByText('Tickets updated')).toBeNull()
  })

  it('never expires a card', () => {
    const { update } = setup([])
    update([ticketsStored()])
    act(() => {
      vi.advanceTimersByTime(10 * 60_000)
    })
    expect(screen.getByText('Tickets updated')).toBeTruthy()
  })

  it('counts a burst up on one card instead of adding cards', () => {
    const first = ticketsStored()
    const { update } = setup([])
    update([first])
    update([first, ticketsStored()])
    expect(screen.getAllByText('Tickets updated')).toHaveLength(1)
  })
})
