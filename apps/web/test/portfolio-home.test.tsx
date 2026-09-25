// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortfolioHome } from '../src/components/PortfolioHome'
import { ToastProvider } from '../src/lib/toast'
import type { ProjectNavApi } from '../src/lib/use-project-nav'

/**
 * The portfolio home (decision 7): the project list, and the one way off it
 * into a new project. The per-project `feature.list` queries and the cards' mutations are
 * stubbed — what is asserted here is the shape of the surface, not the wire.
 */

vi.mock('../src/lib/live', () => ({ useLivePoll: () => false as const, useLiveStatus: () => 'live' }))

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
  doctorError: null,
  recheckDoctor: vi.fn(),
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

  it('titles the page once, counts the projects beneath, and gives each one a row', () => {
    render(
      <ToastProvider>
        <PortfolioHome nav={nav} />
      </ToastProvider>,
    )

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Projects')
    expect(document.body.textContent).toContain('2projects open')
    expect(screen.getByTitle('Open runcastle')).toBeTruthy()
    expect(screen.getByTitle('Open sandcastle')).toBeTruthy()

    fireEvent.click(screen.getByTitle('Open sandcastle'))
    expect(nav.enterProject).toHaveBeenCalledWith('p2')
  })

  it('makes Open a project the page’s one primary', () => {
    render(
      <ToastProvider>
        <PortfolioHome nav={nav} />
      </ToastProvider>,
    )

    const primaries = document.querySelectorAll('[data-variant="primary"]')
    expect(primaries).toHaveLength(1)
    expect(primaries[0].textContent).toBe('Open a project')

    fireEvent.click(primaries[0])
    expect(nav.showOpen).toHaveBeenCalled()
  })

  it('sits in the frame beside a minimal sidebar', () => {
    render(
      <ToastProvider>
        <PortfolioHome nav={nav} />
      </ToastProvider>,
    )

    const sidebar = screen.getByRole('navigation', { name: 'Projects' })
    expect(sidebar.textContent).toContain('All projects')
    expect(screen.getByRole('main')).toBeTruthy()
  })
})
