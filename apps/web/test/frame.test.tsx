// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectRailContext, type ProjectRailApi } from '../src/components/ProjectRail'
import type { RailTile } from '../src/lib/project-rail'
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

/**
 * The project rail (a-better-way-to-move-between-projects): left of the
 * sidebar, on every screen with one, and still there with the sidebar closed.
 * The shell's data is handed in as a plain value.
 */
describe('Frame — the project rail', () => {
  const tiles: RailTile[] = [
    { id: 'p1', name: 'runcastle', initials: 'R', needsYou: false, shortcut: 1 },
    { id: 'p2', name: 'clawflow', initials: 'C', needsYou: false, shortcut: 2 },
    { id: 'p3', name: 'JanaLearn_Updated', initials: 'JL', needsYou: true, shortcut: 3 },
  ]
  let rail: ProjectRailApi
  beforeEach(() => {
    localStorage.clear()
    rail = { tiles, currentId: 'p1', enter: vi.fn(), goHome: vi.fn(), open: vi.fn(), reorder: vi.fn() }
  })
  afterEach(cleanup)

  function mountWithRail(sidebar = true, withRail?: boolean) {
    return render(
      <ProjectRailContext.Provider value={rail}>
        <FrameProvider>
          <Frame sidebar={sidebar ? <div>sidebar body</div> : undefined} rail={withRail}>
            <div>panel body</div>
          </Frame>
        </FrameProvider>
      </ProjectRailContext.Provider>,
    )
  }
  const railNav = () => screen.queryByRole('navigation', { name: 'Switch project' })
  const tile = (name: string) => within(railNav()!).getByRole('button', { name })

  it('sits left of the sidebar, its tiles in rail order, and stays when the sidebar closes', () => {
    mountWithRail()
    const nav = railNav()!
    expect(nav.compareDocumentPosition(document.querySelector('[data-sidebar]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const names = within(nav).getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual(['All projects', 'runcastle', 'clawflow', 'JanaLearn_Updated', 'Open a project'])
    expect(tile('runcastle').getAttribute('aria-current')).toBe('true')

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(state()).toBe('closed')
    expect(railNav()).not.toBeNull()
    expect(tile('clawflow')).toBeTruthy()
  })

  it('All projects asks for the rail with no sidebar; a bare frame has neither', () => {
    mountWithRail(false, true)
    expect(railNav()).not.toBeNull()
    expect(document.querySelector('[data-sidebar]')).toBeNull()
    cleanup()
    mountWithRail(false)
    expect(railNav()).toBeNull()
  })

  it('dots a project that needs you', () => {
    mountWithRail()
    expect(within(tile('JanaLearn_Updated')).getByRole('img', { name: 'Needs you' })).toBeTruthy()
    expect(within(tile('clawflow')).queryByRole('img')).toBeNull()
  })

  it('switches on a click; the top icon goes to All projects and "+" opens a project', () => {
    mountWithRail()
    fireEvent.click(tile('clawflow'))
    expect(rail.enter).toHaveBeenCalledWith('p2')
    fireEvent.click(tile('All projects'))
    expect(rail.goHome).toHaveBeenCalled()
    fireEvent.click(tile('Open a project'))
    expect(rail.open).toHaveBeenCalled()
  })

  it('selects the top icon on All projects', () => {
    rail = { ...rail, currentId: null }
    mountWithRail()
    expect(tile('All projects').getAttribute('aria-current')).toBe('true')
    expect(tile('runcastle').getAttribute('aria-current')).toBeNull()
  })

  it('reorders on a drag and does not switch', () => {
    mountWithRail()
    // happy-dom lays nothing out: every slot measures at 0, so any drag lands on the first.
    fireEvent.pointerDown(tile('JanaLearn_Updated'), { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 20, clientY: 200 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 20, clientY: 150 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 20, clientY: 10 })
    const live = within(railNav()!).getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(live.slice(1, 4)).toEqual(['JanaLearn_Updated', 'runcastle', 'clawflow'])
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 20, clientY: 10 })
    fireEvent.click(tile('JanaLearn_Updated'))

    expect(rail.reorder).toHaveBeenCalledWith(['p3', 'p1', 'p2'])
    expect(rail.enter).not.toHaveBeenCalled()
  })

  it('a press that does not travel is a click, and saves no order', () => {
    mountWithRail()
    fireEvent.pointerDown(tile('clawflow'), { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 20, clientY: 100 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 21, clientY: 101 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 21, clientY: 101 })
    fireEvent.click(tile('clawflow'))

    expect(rail.reorder).not.toHaveBeenCalled()
    expect(rail.enter).toHaveBeenCalledWith('p2')
  })

  it('shows no rail on a screen without a sidebar, or outside the shell', () => {
    mountWithRail(false)
    expect(railNav()).toBeNull()
    cleanup()
    mount()
    expect(railNav()).toBeNull()
  })
})
