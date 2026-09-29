// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoticeDeck } from '../src/components/chat/NoticeDeck'
import type { ChatNotice } from '../src/lib/chat-notices'

/**
 * The Chat tab's notice deck. Tier 2: collapsing, fanning out on hover and on
 * keyboard focus, and the card buttons are all behaviour, not markup.
 */
const SPEC: ChatNotice = {
  kind: 'spec',
  hue: 'planning',
  title: 'Spec written',
  subtitle: 'spec.md',
  actionLabel: 'View spec',
  target: 'overview',
  count: 1,
  eventId: 1,
}
const TICKETS: ChatNotice = {
  kind: 'tickets',
  hue: 'tickets',
  title: 'Tickets updated',
  subtitle: 'ticket 3 cancelled',
  actionLabel: 'View tickets',
  target: 'tickets',
  count: 3,
  eventId: 2,
}
const RUN: ChatNotice = {
  kind: 'run',
  hue: 'danger',
  title: 'Run finished with failures',
  subtitle: '4 of 6 landed',
  actionLabel: 'View run',
  target: 'overview',
  count: 1,
  eventId: 3,
}

function renderDeck(notices: ChatNotice[] = [RUN, TICKETS, SPEC]) {
  const onAct = vi.fn()
  const onDismiss = vi.fn()
  render(<NoticeDeck notices={notices} onAct={onAct} onDismiss={onDismiss} />)
  return { onAct, onDismiss, deck: screen.getByRole('status') }
}

describe('NoticeDeck', () => {
  afterEach(cleanup)

  it('is a polite live region', () => {
    const { deck } = renderDeck()
    expect(deck.getAttribute('aria-live')).toBe('polite')
  })

  it('collapsed, only the newest card is readable, the rest peek behind it with a count hint', () => {
    renderDeck()
    expect(screen.getByText('3 notifications')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: /View run/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /View tickets/ })).toBeNull()
    // The older cards are still there, as edges.
    expect(screen.getAllByRole('article', { hidden: true })).toHaveLength(3)
  })

  it('shows no hint for a single card', () => {
    renderDeck([SPEC])
    expect(screen.queryByText(/notifications$/)).toBeNull()
  })

  it('fans every card out on hover, and collapses again when the pointer leaves', () => {
    const { deck } = renderDeck()
    fireEvent.mouseEnter(deck)
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(3)
    expect(screen.queryByText('3 notifications')).toBeNull()
    fireEvent.mouseLeave(deck)
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(1)
  })

  it('fans out when keyboard focus moves into it, and collapses when it leaves', () => {
    render(
      <>
        <button>Outside</button>
        <NoticeDeck notices={[RUN, TICKETS, SPEC]} onAct={() => {}} onDismiss={() => {}} />
      </>,
    )
    act(() => screen.getByRole('button', { name: /View run/ }).focus())
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(3)
    act(() => screen.getByRole('button', { name: 'Outside' }).focus())
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(1)
  })

  it("calls onAct and onDismiss with the card's kind", () => {
    const { deck, onAct, onDismiss } = renderDeck()
    fireEvent.mouseEnter(deck)
    fireEvent.click(screen.getByRole('button', { name: /View tickets/ }))
    expect(onAct).toHaveBeenCalledWith('tickets')
    const specCard = screen.getByText('Spec written').closest('article') as HTMLElement
    fireEvent.click(within(specCard).getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledWith('spec')
  })

  it('shows a burst count and wears each card in its hue', () => {
    const { deck } = renderDeck()
    fireEvent.mouseEnter(deck)
    expect(screen.getByLabelText('3 times').textContent).toBe('×3')
    const hues = screen.getAllByRole('article').map((card) => card.getAttribute('data-hue'))
    expect(hues).toEqual(['danger', 'tickets', 'planning'])
    const ticketsCard = screen.getByText('Tickets updated').closest('article') as HTMLElement
    expect(ticketsCard.innerHTML).toContain('text-phase-tickets')
    expect(ticketsCard.querySelector('[data-phase="tickets"]')).not.toBeNull()
  })
})
