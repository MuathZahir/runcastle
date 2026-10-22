// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Frame, FrameProvider } from '../src/components/Frame'
import { PageTopbar } from '../src/ui'

/**
 * The frame (DESIGN.md §Frame): canvas | sidebar | content panel, the sidebar
 * closed and reopened with ⌘/Ctrl+B or the page header's button, and the
 * choice remembered. One closed state, no icon rail (design-mode decision 12).
 * Tier 2: the behaviour is key events on `window` and a remount.
 */
function mount() {
  return render(
    <FrameProvider notices={<div role="status">notice</div>}>
      <Frame sidebar={<div>sidebar body</div>}>
        <section>
          <PageTopbar crumbs={[{ label: 'Page' }]} />
          <div>panel body</div>
        </section>
      </Frame>
    </FrameProvider>,
  )
}

const state = () => document.querySelector('[data-sidebar]')?.getAttribute('data-sidebar')
const sidebarWidth = () => (document.querySelector('[data-sidebar]') as HTMLElement | null)?.style.width

describe('Frame', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

  it('puts the notices and the view inside the content panel', () => {
    mount()

    const main = screen.getByRole('main')
    expect(main.className).toContain('bg-surface')
    expect(main.className).toContain('rounded-lg')
    expect(main.textContent).toBe('noticePagepanel body')
  })

  it('closes and reopens on Ctrl+B, and remembers it', () => {
    mount()
    expect(state()).toBe('open')

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(state()).toBe('closed')

    cleanup()
    mount()
    expect(state()).toBe('closed')

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(state()).toBe('open')
  })

  it('closed is zero width with no rail; the page header holds the way back', () => {
    mount()
    expect(screen.queryByRole('button', { name: 'Show sidebar' })).toBeNull()
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })

    expect(sidebarWidth()).toBe('0px')
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull()
    const door = screen.getByRole('button', { name: 'Show sidebar' })
    expect(door.closest('header')).not.toBeNull()

    fireEvent.click(door)
    expect(state()).toBe('open')
    expect(screen.queryByRole('button', { name: 'Show sidebar' })).toBeNull()
  })

  it('opens a browser that left the old collapsed rail as closed', () => {
    localStorage.setItem('runcastle.sidebar.collapsed', '1')
    mount()

    expect(state()).toBe('closed')
    expect(sidebarWidth()).toBe('0px')
  })

  it('a drag under half the minimum width closes the sidebar rather than leaving a rail', () => {
    mount()
    fireEvent.mouseDown(screen.getByRole('separator', { name: 'Resize the sidebar' }), { clientX: 300 })
    fireEvent.mouseMove(document, { clientX: 100 })
    fireEvent.mouseUp(document)

    expect(state()).toBe('closed')
  })

  it('a drag to the minimum keeps it open at the minimum', () => {
    mount()
    fireEvent.mouseDown(screen.getByRole('separator', { name: 'Resize the sidebar' }), { clientX: 300 })
    fireEvent.mouseMove(document, { clientX: 250 })
    fireEvent.mouseUp(document)

    expect(state()).toBe('open')
    expect(sidebarWidth()).toBe('220px')
  })

  it('leaves Ctrl+B to a focused terminal', () => {
    mount()
    const term = document.createElement('div')
    term.className = 'xterm'
    const input = document.createElement('textarea')
    term.appendChild(input)
    document.body.appendChild(term)

    fireEvent.keyDown(input, { key: 'b', ctrlKey: true })
    expect(state()).toBe('open')
    term.remove()
  })
})
