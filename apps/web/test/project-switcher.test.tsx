// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectSwitcher } from '../src/components/ProjectSwitcher'
import type { ProjectNavApi } from '../src/lib/use-project-nav'
import { openMenu } from './floating'

/**
 * The titlebar switcher (decision 8). It takes nothing but the navigation API,
 * so it needs no tRPC stub — only a DOM, for the rows the menu drops and the
 * second line that tells two projects with the same name apart. Dismissal is
 * the `DropdownMenu` primitive's now, and is tested there.
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
function showMenu(nav = navApi()) {
  const view = render(<ProjectSwitcher nav={nav} />)
  openMenu(screen.getByRole('button', { name: /runcastle/ }))
  return { ...view, nav }
}

describe('ProjectSwitcher', () => {
  afterEach(cleanup)

  it('lists every open project over its repo folder, then the two fixed rows', () => {
    showMenu()

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
    const { nav } = showMenu()
    const [current, other] = screen.getAllByRole('menuitem')

    expect(current.getAttribute('aria-current')).toBe('true')
    expect(other.getAttribute('aria-current')).toBeNull()

    fireEvent.click(other)
    expect(nav.enterProject).toHaveBeenCalledWith('p2')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('goes home and to the open screen from the fixed rows', () => {
    const { nav } = showMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'All projects' }))
    expect(nav.goHome).toHaveBeenCalled()

    openMenu(screen.getByRole('button', { name: /runcastle/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open a project…' }))
    expect(nav.showOpen).toHaveBeenCalled()
  })

  it('resets the user-agent button styles on the trigger', () => {
    // There is no Tailwind preflight yet (STYLE.md), so a button that names no
    // background renders as `buttonface` grey under near-white theme text, and
    // one that names no border draws the agent's outset ring.
    showMenu()

    // The trigger keeps a transparent border to fade in on hover.
    const trigger = screen.getByRole('button', { name: /runcastle/ })
    expect(trigger.className).toContain('bg-transparent')
    expect(trigger.className).toContain('border-transparent')
  })

  it('drops its rows at the app body scale, not the menu default', () => {
    // 11px is reserved for the uppercase micro-labels (STYLE.md); a project row
    // reads at the 14px the rest of the interface does.
    showMenu()

    for (const item of screen.getAllByRole('menuitem')) {
      expect(item.className).toContain('text-base')
    }
    // Stated on the row, and not on the surface: the surface already carries the
    // primitive's own `text-xs`, which Tailwind emits last, so a size passed
    // down beside it would lose. The family is safe there — `font-sans` sorts
    // after `font-mono`.
    const menu = screen.getByRole('menu')
    expect(menu.className).toContain('font-sans')
    expect(menu.className).not.toContain('text-base')
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
