// @vitest-environment happy-dom
import { useState } from 'react'
import type { RefObject } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Dialog } from '../src/ui'
import { DeleteFeatureDialog } from '../src/components/DeleteFeatureDialog'
import { FeatureActionsMenu } from '../src/components/FeatureActionsMenu'

/**
 * The mechanics five overlays used to each own a copy of (apps/web/STYLE.md).
 * Tier 2, because none of this is visible in a rendered string: the panel is in
 * a portal, the Escape guard reads `document.activeElement`, and the whole point
 * of the focus restore is where the caret lands after the dialog is gone.
 */
describe('Dialog', () => {
  afterEach(cleanup)

  /** Opener button + dialog, so the focus restore has somewhere to restore to. */
  function Harness({ dirty = false, inline = false }: { dirty?: boolean; inline?: boolean }) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          dirty={dirty}
          inline={inline}
          label="Test dialog"
        >
          <button>Inside</button>
        </Dialog>
      </>
    )
  }

  function open(): HTMLElement {
    const opener = screen.getByRole('button', { name: 'Open' })
    opener.focus()
    fireEvent.click(opener)
    return opener
  }

  it('renders through a portal, outside the tree it was rendered into', () => {
    const { container } = render(<Harness />)
    open()

    const panel = screen.getByRole('dialog')
    expect(container.contains(panel)).toBe(false)
    expect(document.body.contains(panel)).toBe(true)
    expect(panel.getAttribute('aria-modal')).toBe('true')
    expect(panel.getAttribute('aria-label')).toBe('Test dialog')
  })

  it('closes on Escape when the focus is inside it', () => {
    render(<Harness />)
    open()

    fireEvent.keyDown(screen.getByRole('button', { name: 'Inside' }), { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ignores Escape while something outside owns the focus', () => {
    render(
      <>
        <button>Palette</button>
        <Harness />
      </>,
    )
    open()

    const outside = screen.getByRole('button', { name: 'Palette' })
    outside.focus()
    fireEvent.keyDown(outside, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeNull()
  })

  it('takes the focus on open, but never from a child that asked for it', () => {
    render(<Harness />)
    open()
    expect(document.activeElement).toBe(screen.getByRole('dialog'))

    cleanup()
    render(
      <Dialog open onClose={() => {}} label="Autofocus">
        <input autoFocus aria-label="slug" />
      </Dialog>,
    )

    expect(document.activeElement).toBe(screen.getByLabelText('slug'))
  })

  it('restores the focus to the opener when it closes', () => {
    render(<Harness />)
    const opener = open()
    expect(document.activeElement).not.toBe(opener)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(document.activeElement).toBe(opener)
  })

  it('returns focus to feature actions when Delete opened from its transient menu item', () => {
    function DeleteHarness() {
      const [returnFocusRef, setReturnFocusRef] = useState<RefObject<HTMLButtonElement | null> | null>(null)
      return (
        <>
          <FeatureActionsMenu
            actions={[{ key: 'delete', label: 'Delete…', onSelect: setReturnFocusRef }]}
          />
          {returnFocusRef && (
            <DeleteFeatureDialog
              title="Draft feature"
              slug="draft-feature"
              busy={false}
              onConfirm={() => {}}
              onCancel={() => setReturnFocusRef(null)}
              returnFocusRef={returnFocusRef}
            />
          )}
        </>
      )
    }

    render(<DeleteHarness />)
    const actions = screen.getByRole('button', { name: 'feature actions' })
    fireEvent.click(actions)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }))

    expect(document.activeElement).toBe(screen.getByPlaceholderText('draft-feature'))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(actions)
  })

  it('closes on backdrop mousedown without letting its default action steal restored focus', () => {
    render(<Harness />)
    const opener = open()

    const backdrop = screen.getByRole('dialog').parentElement
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    fireEvent(backdrop!, mouseDown)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mouseDown.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(opener)
  })

  it('stays open for a mousedown inside the panel', () => {
    render(<Harness />)
    open()

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Inside' }))

    expect(screen.queryByRole('dialog')).not.toBeNull()
  })

  it('asks before discarding when it is dirty, and closes once the answer is Discard', () => {
    render(<Harness dirty />)
    open()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.getByRole('alert').textContent).toContain('Discard what you have typed?')
    expect(screen.queryByRole('dialog')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('answers a second Escape with the question, not the dismissal', () => {
    render(<Harness dirty />)
    open()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeNull()
  })

  it('renders in place and claims no modality when it is inline', () => {
    const { container } = render(<Harness inline />)
    open()

    const panel = screen.getByRole('dialog')
    expect(container.contains(panel)).toBe(true)
    expect(panel.getAttribute('aria-modal')).toBeNull()
  })
})
