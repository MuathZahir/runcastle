// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventRow } from '@runcastle/core'
import { FeatureNoticeDeck } from '../src/components/chat/FeatureNoticeDeck'
import { DRIVE_NOTICE_MS } from '../src/lib/chat-notices'
import { atWidth } from './phone-width'

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
    <FeatureNoticeDeck events={events} active={isActive} onView={onView} />
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
    expect(screen.queryByText('Ticket history')).toBeNull()
  })

  it('raises a notice for a change that arrives while Chat is in front', () => {
    const { update } = setup([])
    update([ticketsStored()])
    expect(screen.getByText('Ticket history')).toBeTruthy()
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
    expect(screen.queryByText('Ticket history')).toBeNull()
  })

  it('View switches to the notice’s tab and takes the card away', () => {
    const { update, onView } = setup([])
    update([ticketsStored()])
    fireEvent.click(screen.getByRole('button', { name: /View history/ }))
    expect(onView).toHaveBeenCalledWith('work')
    expect(screen.queryByText('Ticket history')).toBeNull()
  })

  it('✕ takes the card away without switching tabs', () => {
    const { update, onView } = setup([])
    update([ticketsStored()])
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onView).not.toHaveBeenCalled()
    expect(screen.queryByText('Ticket history')).toBeNull()
  })

  it('never expires a card', () => {
    const { update } = setup([])
    update([ticketsStored()])
    act(() => {
      vi.advanceTimersByTime(10 * 60_000)
    })
    expect(screen.getByText('Ticket history')).toBeTruthy()
  })

  it('lets the drive-start card go by itself after a few seconds, the others staying', () => {
    const { update } = setup([])
    update([ticketsStored(), event('testdrive.url', 'drive up', NOW + 1_000)])
    expect(screen.getByText('Test drive running')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(DRIVE_NOTICE_MS)
    })
    expect(screen.queryByText('Test drive running')).toBeNull()
    expect(screen.getByText('Ticket history')).toBeTruthy()
  })

  describe('on a phone', () => {
    afterEach(() => vi.unstubAllGlobals())
    const READY = 'Ready to test. The test drive is on your computer; you can still talk here.'

    it('shows no notice that opens a drive, and keeps the ones that open a view', () => {
      atWidth(true)
      const { update, onView } = setup([])
      update([ticketsStored(), event('testdrive.url', 'drive up', NOW + 1_000)])
      expect(screen.queryByText('Test drive running')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: /View history/ }))
      expect(onView).toHaveBeenCalledWith('work')
    })

    it('says a feature ready to test has its drive on the computer', () => {
      atWidth(true)
      render(<FeatureNoticeDeck events={[]} active onView={() => {}} readyToTest />)
      expect(screen.getByText(READY)).toBeTruthy()
    })

    it('says nothing of it at desktop width, where the drive is', () => {
      atWidth(false)
      render(<FeatureNoticeDeck events={[]} active onView={() => {}} readyToTest />)
      expect(screen.queryByText(READY)).toBeNull()
    })
  })

  it('counts a burst up on one card instead of adding cards', () => {
    const first = ticketsStored()
    const { update } = setup([])
    update([first])
    update([first, ticketsStored()])
    expect(screen.getAllByText('Ticket history')).toHaveLength(1)
  })
})
