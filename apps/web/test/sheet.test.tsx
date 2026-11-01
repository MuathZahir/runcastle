// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sheet, SheetRow } from '../src/ui'

/**
 * The phone's menu runs through Dialog's mechanics (phone ticket 1): a portal
 * into <body>, Escape, a tap on the backdrop, focus on open. Tier 2 — none of
 * that is in a markup string.
 */
describe('Sheet', () => {
  afterEach(cleanup)

  function Harness({ onClose, onPick }: { onClose: () => void; onPick: () => void }) {
    return (
      <div data-testid="page">
        <Sheet open onClose={onClose} title="Threads">
          <SheetRow icon={null} label="Plan the round" hint="Waiting for you" onClick={onPick} />
        </Sheet>
      </div>
    )
  }

  it('opens as a named modal dialog outside the page, focused, and offers its rows', () => {
    const onPick = vi.fn()
    render(<Harness onClose={() => undefined} onPick={onPick} />)
    const sheet = screen.getByRole('dialog', { name: 'Threads' })
    expect(sheet.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByTestId('page').contains(sheet)).toBe(false)
    expect(document.activeElement).toBe(sheet)
    fireEvent.click(screen.getByRole('button', { name: /Plan the round/ }))
    expect(onPick).toHaveBeenCalledOnce()
  })

  it('closes on Escape and on a tap outside it, never on a tap inside', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} onPick={() => undefined} />)
    const sheet = screen.getByRole('dialog')
    fireEvent.mouseDown(sheet)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(sheet.parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalledOnce()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('renders nothing while closed', () => {
    render(
      <Sheet open={false} onClose={() => undefined} label="New">
        <SheetRow icon={null} label="New chat" onClick={() => undefined} />
      </Sheet>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
