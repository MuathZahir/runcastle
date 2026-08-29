// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectSwitcher } from '../src/components/ProjectSwitcher'
import type { ProjectNavApi } from '../src/lib/use-project-nav'

/**
 * The titlebar switcher (decision 8). It takes nothing but the navigation API,
 * so it needs no tRPC stub — only a DOM, for the menu's open/close, its
 * outside-click and Escape, and the second line that tells two projects with
 * the same name apart.
 */

const projects = [
  { id: 'p1', name: 'runcastle', repoPath: '/home/you/code/runcastle' },
  { id: 'p2', name: 'runcastle', repoPath: 'C:\\Users\\you\\forks\\runcastle-fork\\' },
]

const navApi = (over: Partial<ProjectNavApi> = {}): ProjectNavApi => ({
  projects,
  loading: false,
  view: 'project',
  currentProjectId: 'p1',
  currentProject: projects[0],
  goHome: vi.fn(),
  enterProject: vi.fn(),
  showOpen: vi.fn(),
  cancelOpen: vi.fn(),
  ...over,
})

/** Render the switcher and drop its menu open. */
function openMenu(nav = navApi()) {
  const view = render(<ProjectSwitcher nav={nav} />)
  fireEvent.click(screen.getByRole('button', { name: /runcastle/ }))
  return { ...view, nav }
}

describe('ProjectSwitcher', () => {
  afterEach(cleanup)

  it('lists every open project over its repo folder, then the two fixed rows', () => {
    openMenu()

    const items = screen.getAllByRole('menuitem')
    // Both projects are called "runcastle"; the folder beneath is the only thing
    // that tells the fork from the original.
    expect(items.map((el) => el.textContent)).toEqual([
      'runcastleruncastle',
      'runcastleruncastle-fork',
      'All projects',
      'Open a project…',
    ])
  })

  it('marks the current project and switches to another', () => {
    const { nav } = openMenu()
    const [current, other] = screen.getAllByRole('menuitem')

    expect(current.getAttribute('aria-current')).toBe('true')
    expect(other.getAttribute('aria-current')).toBeNull()

    fireEvent.click(other)
    expect(nav.enterProject).toHaveBeenCalledWith('p2')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('goes home and to the open screen from the fixed rows', () => {
    const { nav } = openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'All projects' }))
    expect(nav.goHome).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /runcastle/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open a project…' }))
    expect(nav.showOpen).toHaveBeenCalled()
  })

  it('closes on Escape and on a click outside itself', () => {
    openMenu()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /runcastle/ }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('truncates a long project name rather than widening the titlebar', () => {
    const long = { id: 'p3', name: 'a-project-name-long-enough-to-swallow-the-row', repoPath: '/r' }
    render(<ProjectSwitcher nav={navApi({ currentProjectId: 'p3', currentProject: long })} />)

    const label = screen.getByTitle(long.name)
    expect(label.className).toContain('truncate')
    expect(label.className).toContain('min-w-0')
    expect(label.className).toMatch(/max-w-/)
  })
})
