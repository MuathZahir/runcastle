// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortfolioHome } from '../src/components/PortfolioHome'
import { ToastProvider } from '../src/lib/toast'
import { listItem } from './fixtures'
import type { FeatureListItem } from '../src/lib/api'
import type { ProjectNavApi } from '../src/lib/use-project-nav'

/**
 * The portfolio home (decision 7): the project list, and the one way off it
 * into a new project. The per-project `feature.list` queries and the cards' mutations are
 * stubbed — what is asserted here is the shape of the surface, not the wire.
 */

/** What each project's `feature.list` answers, in the order the projects are listed. */
const stub = vi.hoisted(() => ({ features: [] as unknown[][] }))

vi.mock('../src/lib/live', () => ({ useLivePoll: () => false as const, useLiveStatus: () => 'live' }))

vi.mock('../src/trpc', () => ({
  trpc: {
    useQueries: (build: (t: unknown) => unknown[]) =>
      build({ feature: { list: () => undefined } }).map((_, i) => ({ data: stub.features[i] ?? [] })),
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
  { id: 'p3', name: 'lighthouse', repoPath: '/home/you/code/lighthouse' },
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

/** A list's rows by their tooltip, top to bottom. */
const titles = (name: string) =>
  [...document.querySelectorAll(`[aria-label="${name}"] [title^="Open "]`)].map((row) => row.getAttribute('title'))

describe('PortfolioHome', () => {
  beforeEach(() => {
    vi.mocked(nav.enterProject).mockClear()
    vi.mocked(nav.showOpen).mockClear()
    stub.features = []
  })
  afterEach(cleanup)

  it('titles the page once, counts the projects beneath, and gives each one a row', () => {
    render(
      <ToastProvider>
        <PortfolioHome nav={nav} />
      </ToastProvider>,
    )

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Projects')
    expect(document.body.textContent).toContain('3projects open')
    expect(screen.getByTitle('Open runcastle')).toBeTruthy()
    expect(screen.getByTitle('Open sandcastle')).toBeTruthy()

    fireEvent.click(screen.getByTitle('Open sandcastle'))
    expect(nav.enterProject).toHaveBeenCalledWith('p2')
  })

  it('with nothing live, keeps one list in the order the projects are in', () => {
    render(
      <ToastProvider>
        <PortfolioHome nav={nav} />
      </ToastProvider>,
    )

    expect(document.querySelector('[aria-label="Live projects"]')).toBeNull()
    expect(titles('Open projects')).toEqual(['Open runcastle', 'Open sandcastle', 'Open lighthouse'])
  })

  it('sits live projects first in their own card, waiting before running', () => {
    const running: FeatureListItem = listItem({ activeRun: true })
    const waiting: FeatureListItem = listItem({ waitingReason: 'ready to test' })
    stub.features = [[], [running], [waiting]]
    render(
      <ToastProvider>
        <PortfolioHome nav={nav} />
      </ToastProvider>,
    )

    expect(titles('Live projects')).toEqual(['Open lighthouse', 'Open sandcastle'])
    expect(titles('Open projects')).toEqual(['Open runcastle'])
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
