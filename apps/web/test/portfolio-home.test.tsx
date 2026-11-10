// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortfolioHome } from '../src/components/PortfolioHome'
import { ToastProvider } from '../src/lib/toast'
import { listItem, need } from './fixtures'
import { atWidth } from './phone-width'
import type { FeatureListItem } from '../src/lib/api'
import type { ProjectNavApi } from '../src/lib/use-project-nav'

/**
 * All projects (a-better-way-to-move-between-projects, decision 4): a card for
 * each project something waits or runs in, one line for each quiet one, all in
 * the order the projects are given (the rail's). The per-project `feature.list`
 * queries and the cards' mutations are stubbed — what is asserted here is the
 * shape of the page, not the wire.
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
  { id: 'p1', name: 'runcastle', repoPath: '/home/you/code/runcastle', position: 0 },
  { id: 'p2', name: 'sandcastle', repoPath: '/home/you/code/sandcastle', position: 1 },
  { id: 'p3', name: 'lighthouse', repoPath: '/home/you/code/lighthouse', position: 2 },
  { id: 'p4', name: 'harbour', repoPath: '/home/you/code/harbour', position: 3 },
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

const running = (title: string, slug = title): FeatureListItem => ({ ...listItem({ id: slug, slug, workersWorking: 1 }), title })
const waiting = (title: string, words: string, slug = title): FeatureListItem => ({
  ...listItem({ id: slug, slug, need: need('test', words) }),
  title,
})

/** The projects a section shows, top to bottom, by the button that opens each. */
const opened = (section: HTMLElement) =>
  [...section.querySelectorAll('[title^="Open "]')]
    .map((el) => el.getAttribute('title')!)
    .filter((t) => projects.some((p) => t === `Open ${p.name}`))

const page = () =>
  render(
    <ToastProvider>
      <PortfolioHome nav={nav} />
    </ToastProvider>,
  )

const busy = () => screen.getByRole('region', { name: 'Busy projects' })
const quiet = () => screen.getByRole('region', { name: 'Quiet' })

describe('PortfolioHome', () => {
  beforeEach(() => {
    vi.mocked(nav.enterProject).mockClear()
    vi.mocked(nav.showOpen).mockClear()
    stub.features = []
  })
  afterEach(cleanup)

  it('titles the page once and counts the projects, what runs and what waits', () => {
    stub.features = [[running('Faster start')], [], [waiting('Lesson streaks', 'Ready to test')], []]
    page()

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Projects')
    expect(document.body.textContent).toContain('4projects open')
    expect(document.body.textContent).toContain('1running')
    expect(document.body.textContent).toContain('1needs you')
  })

  it('gives busy projects a card and quiet ones a line, each in the order given', () => {
    // Waiting on the third, running on the first: the order stays the rail's,
    // never waiting-first.
    stub.features = [[running('Faster start')], [], [waiting('Lesson streaks', 'Ready to test')], [listItem()]]
    page()

    expect(opened(busy())).toEqual(['Open runcastle', 'Open lighthouse'])
    expect(opened(quiet())).toEqual(['Open sandcastle', 'Open harbour'])
  })

  it('lists what waits on you in a card, and what runs where nothing waits', () => {
    stub.features = [
      [running('Faster start')],
      [],
      [waiting('Lesson streaks', 'Ready to test · Streak resets at midnight'), running('Quiz timer')],
      [],
    ]
    page()

    const cards = within(busy())
    const lighthouse = cards.getByTitle('Open Lesson streaks').closest('.card') as HTMLElement
    expect(lighthouse.textContent).toContain('Ready to test')
    expect(lighthouse.textContent).not.toContain('Streak resets')
    // Running stays a count in the foot where something waits.
    expect(lighthouse.textContent).not.toContain('Quiz timer')
    expect(lighthouse.textContent).toContain('1running')

    const runcastle = cards.getByTitle('Open Faster start').closest('.card') as HTMLElement
    expect(runcastle.textContent).toContain('runcastle')
  })

  it('enters the project from a card or a quiet line, and opens a feature from its line', () => {
    stub.features = [[], [], [waiting('Lesson streaks', 'Ready to test', 'lesson-streaks')], []]
    page()

    fireEvent.click(screen.getByTitle('Open lighthouse'))
    expect(nav.enterProject).toHaveBeenLastCalledWith('p3')

    fireEvent.click(screen.getByTitle('Open sandcastle'))
    expect(nav.enterProject).toHaveBeenLastCalledWith('p2')

    fireEvent.click(screen.getByTitle('Open Lesson streaks'))
    expect(nav.enterProject).toHaveBeenLastCalledWith('p3', 'lesson-streaks')
  })

  it('with nothing waiting or running, says so and lists every project as a quiet line', () => {
    page()

    expect(screen.queryByRole('region', { name: 'Busy projects' })).toBeNull()
    expect(document.body.textContent).toContain('Nothing needs you and nothing is running.')
    expect(opened(quiet())).toEqual(['Open runcastle', 'Open sandcastle', 'Open lighthouse', 'Open harbour'])
  })

  it('makes Open a project the page’s one primary', () => {
    page()

    const primaries = document.querySelectorAll('[data-variant="primary"]')
    expect(primaries).toHaveLength(1)
    expect(primaries[0].textContent).toBe('Open a project')

    fireEvent.click(primaries[0])
    expect(nav.showOpen).toHaveBeenCalled()
  })

  it('sits in the frame beside a minimal sidebar with no project switcher', () => {
    page()

    const sidebar = screen.getByRole('navigation', { name: 'Projects' })
    expect(sidebar.textContent).toContain('All projects')
    expect(within(sidebar).queryByRole('button', { name: /switch project|runcastle/i })).toBeNull()
    expect(screen.getByRole('main')).toBeTruthy()
  })
})

/** runcastle-on-your-phone: the home fits a phone, to pick another project. */
describe('PortfolioHome on a phone', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('is the page alone, and a line opens its project', () => {
    stub.features = []
    atWidth(true)
    page()
    expect(screen.queryByRole('navigation', { name: 'Projects' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open a project' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'sandcastle actions' })).toBeNull()
    fireEvent.click(screen.getByTitle('Open sandcastle'))
    expect(nav.enterProject).toHaveBeenCalledWith('p2')
  })
})
