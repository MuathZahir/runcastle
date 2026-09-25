// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Frame, FrameProvider } from '../src/components/Frame'

/**
 * The frame (DESIGN.md §Frame): canvas | sidebar | content panel, the sidebar
 * collapsible with ⌘/Ctrl+B or its button, and the choice remembered. Tier 2:
 * the behaviour is key events on `window` and a remount.
 */
function mount() {
  return render(
    <FrameProvider notices={<div role="status">notice</div>}>
      <Frame sidebar={<div>sidebar body</div>}>
        <div>panel body</div>
      </Frame>
    </FrameProvider>,
  )
}

const state = () => document.querySelector('[data-sidebar]')?.getAttribute('data-sidebar')

describe('Frame', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

  it('puts the notices and the view inside the content panel', () => {
    mount()

    const main = screen.getByRole('main')
    expect(main.className).toContain('bg-surface')
    expect(main.className).toContain('rounded-lg')
    expect(main.textContent).toBe('noticepanel body')
  })

  it('collapses and expands on Ctrl+B, and remembers it', () => {
    mount()
    expect(state()).toBe('expanded')

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(state()).toBe('collapsed')

    cleanup()
    mount()
    expect(state()).toBe('collapsed')

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(state()).toBe('expanded')
  })

  it('offers a way back while collapsed', () => {
    mount()
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })

    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }))
    expect(state()).toBe('expanded')
  })

  it('leaves Ctrl+B to a focused terminal', () => {
    mount()
    const term = document.createElement('div')
    term.className = 'xterm'
    const input = document.createElement('textarea')
    term.appendChild(input)
    document.body.appendChild(term)

    fireEvent.keyDown(input, { key: 'b', ctrlKey: true })
    expect(state()).toBe('expanded')
    term.remove()
  })
})
