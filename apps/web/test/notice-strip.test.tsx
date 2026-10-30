// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoticeStrip } from '../src/components/chat/NoticeStrip'
import type { ChatNotice, StandingNotice } from '../src/lib/chat-notices'

/**
 * The strip of notices on the composer's top edge. Tier 2: folding the older
 * notices behind "+N more" and the row buttons are behaviour, not markup.
 */
const SPEC: ChatNotice = {
  kind: 'spec',
  hue: 'planning',
  title: 'Spec written',
  subtitle: 'spec.md',
  actionLabel: 'View spec',
  target: 'work',
  count: 1,
  eventId: 1,
}
const TICKETS: ChatNotice = {
  kind: 'tickets',
  hue: 'tickets',
  title: 'Tickets updated',
  subtitle: 'ticket 3 cancelled',
  actionLabel: 'View tickets',
  target: 'work',
  count: 3,
  eventId: 2,
}
const RUN: ChatNotice = {
  kind: 'run',
  hue: 'danger',
  title: 'Run finished with failures',
  subtitle: '4 of 6 landed',
  actionLabel: 'View run',
  target: 'work',
  count: 1,
  eventId: 3,
}

function renderStrip(notices: ChatNotice[] = [RUN, TICKETS, SPEC]) {
  const onAct = vi.fn()
  const onDismiss = vi.fn()
  const view = render(<NoticeStrip notices={notices} onAct={onAct} onDismiss={onDismiss} />)
  return { onAct, onDismiss, view }
}

describe('NoticeStrip', () => {
  afterEach(cleanup)

  it('is a polite live region', () => {
    renderStrip()
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite')
  })

  it('draws nothing with no notices', () => {
    const { view } = renderStrip([])
    expect(view.container.innerHTML).toBe('')
  })

  it('shows only the newest notice, with the older ones folded behind "+N more"', () => {
    renderStrip()
    expect(screen.getByText('+2 more')).toBeTruthy()
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'View run' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'View tickets' })).toBeNull()
  })

  it('offers no "+N more" for a single notice', () => {
    renderStrip([SPEC])
    expect(screen.queryByRole('button', { expanded: false })).toBeNull()
  })

  it('opens the older notices above the newest, oldest first, and folds them again', () => {
    renderStrip()
    const more = screen.getByRole('button', { name: '+2 more' })
    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('article').map((n) => within(n).getAllByRole('button')[0].textContent)).toEqual([
      'View spec',
      'View tickets',
      'Show less',
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })

  it("calls onAct and onDismiss with the notice's kind", () => {
    const { onAct, onDismiss } = renderStrip()
    fireEvent.click(screen.getByRole('button', { name: '+2 more' }))
    fireEvent.click(screen.getByRole('button', { name: 'View tickets' }))
    expect(onAct).toHaveBeenCalledWith('tickets')
    const spec = screen.getByText('Spec written').closest('article') as HTMLElement
    fireEvent.click(within(spec).getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledWith('spec')
  })

  describe('standing rows', () => {
    const CONFLICT: StandingNotice = {
      key: 'conflict',
      hue: 'danger',
      title: 'Merge conflict',
      subtitle: '2 files · main into feature/x',
      tooltip: 'a.ts\nb.ts',
      action: { label: 'Resolve with agent', onClick: vi.fn() },
    }
    const UNVERIFIED: StandingNotice = { key: 'unverified', hue: 'review', title: 'Nothing verified', subtitle: 'ask the agent' }

    function renderStanding(standing: StandingNotice[], notices: ChatNotice[] = [RUN, TICKETS, SPEC]) {
      const onAct = vi.fn()
      const onDismiss = vi.fn()
      render(<NoticeStrip notices={notices} standing={standing} onAct={onAct} onDismiss={onDismiss} />)
      return { onAct, onDismiss }
    }

    it('shows on its own, with no event notices', () => {
      renderStanding([UNVERIFIED], [])
      expect(screen.getAllByRole('article')).toHaveLength(1)
      expect(screen.getByText('Nothing verified')).toBeTruthy()
    })

    it('stands before the event notices and never folds behind "+N more"', () => {
      renderStanding([CONFLICT, UNVERIFIED])
      expect(screen.getAllByRole('article').map((a) => within(a).getAllByText(/./)[0].textContent)).toEqual([
        'Merge conflict',
        'Nothing verified',
        'Run finished with failures',
      ])
      expect(screen.getByText('+2 more')).toBeTruthy()
    })

    it('has its action only where given, no ✕ unless dismissible, and its tooltip', () => {
      const dismiss = vi.fn()
      renderStanding([CONFLICT, { ...UNVERIFIED, onDismiss: dismiss }], [])
      const conflict = screen.getByText('Merge conflict').closest('article') as HTMLElement
      expect(conflict.getAttribute('title')).toBe('a.ts\nb.ts')
      expect(within(conflict).queryByRole('button', { name: 'Dismiss' })).toBeNull()
      fireEvent.click(within(conflict).getByRole('button', { name: 'Resolve with agent' }))
      expect(CONFLICT.action?.onClick).toHaveBeenCalled()
      const unverified = screen.getByText('Nothing verified').closest('article') as HTMLElement
      expect(within(unverified).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Dismiss'])
      fireEvent.click(within(unverified).getByRole('button', { name: 'Dismiss' }))
      expect(dismiss).toHaveBeenCalled()
    })

    it('holds a disabled action', () => {
      renderStanding([{ ...CONFLICT, action: { label: 'Resolve with agent', onClick: vi.fn(), disabled: true } }], [])
      expect((screen.getByRole('button', { name: 'Resolve with agent' }) as HTMLButtonElement).disabled).toBe(true)
    })

    it('leaves the event notices acting by kind as before', () => {
      const { onAct } = renderStanding([CONFLICT])
      fireEvent.click(screen.getByRole('button', { name: 'View run' }))
      expect(onAct).toHaveBeenCalledWith('run')
    })
  })

  it('shows a burst count and wears each notice in its hue, on its glyph alone', () => {
    renderStrip([TICKETS, RUN])
    expect(screen.getByLabelText('3 times').textContent).toBe('×3')
    const notice = screen.getByText('Tickets updated').closest('article') as HTMLElement
    expect(notice.getAttribute('data-hue')).toBe('tickets')
    const glyph = notice.querySelector('[data-phase="tickets"]')!.parentElement as HTMLElement
    expect(glyph.getAttribute('class')).toContain('text-phase-tickets')
    expect(screen.getByRole('button', { name: 'View tickets' }).getAttribute('class')).not.toContain('text-phase-tickets')
  })
})
