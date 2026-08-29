// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortfolioHome } from '../src/components/PortfolioHome'
import { ToastProvider } from '../src/lib/toast'
import type { ProjectNavApi } from '../src/lib/use-project-nav'

/**
 * The portfolio home (decision 7): the grid, and the one way off it into a new
 * project. The per-project `feature.list` queries and the cards' mutations are
 * stubbed — what is asserted here is the shape of the surface, not the wire.
 */

vi.mock('../src/trpc', () => ({
  trpc: {
    useQueries: (build: (t: unknown) => unknown[]) =>
      build({ feature: { list: () => undefined } }).map(() => ({ data: [] })),
    useUtils: () => ({ project: { list: { invalidate: async () => undefined } } }),
    project: {
      rename: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
      close: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
    },
  },
}))

const projects = [
  { id: 'p1', name: 'runcastle', repoPath: '/home/you/code/runcastle' },
  { id: 'p2', name: 'sandcastle', repoPath: '/home/you/code/sandcastle' },
]

const nav: ProjectNavApi = {
  projects,
  loading: false,
  view: 'home',
  currentProjectId: null,
  currentProject: undefined,
  goHome: vi.fn(),
  enterProject: vi.fn(),
  showOpen: vi.fn(),
  cancelOpen: vi.fn(),
}

describe('PortfolioHome', () => {
  beforeEach(() => {
    vi.mocked(nav.enterProject).mockClear()
    vi.mocked(nav.showOpen).mockClear()
  })
  afterEach(cleanup)

  it('counts the projects in its heading and gives each one a card', () => {
    render(
      <ToastProvider>
        <PortfolioHome nav={nav} />
      </ToastProvider>,
    )

    expect(screen.getByRole('heading').textContent).toBe('Projects (2)')
    expect(screen.getByTitle('Open runcastle')).toBeTruthy()
    expect(screen.getByTitle('Open sandcastle')).toBeTruthy()

    fireEvent.click(screen.getByTitle('Open sandcastle'))
    expect(nav.enterProject).toHaveBeenCalledWith('p2')
  })

  it('offers exactly one way to open a project — the card at the end of the grid', () => {
    render(
      <ToastProvider>
        <PortfolioHome nav={nav} />
      </ToastProvider>,
    )

    const opens = screen
      .getAllByRole('button')
      .filter((el) => el.textContent?.startsWith('Open a project'))
    expect(opens).toHaveLength(1)

    fireEvent.click(opens[0])
    expect(nav.showOpen).toHaveBeenCalled()
  })
})
