// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadEntry } from '@runcastle/core'
import type { FeatureListItem, PrepView } from '../src/lib/api'
import type { DriveState } from '../src/lib/workspace'
import { listItem } from './fixtures'
import { openMenu } from './floating'

/**
 * The project sidebar rendered whole, over faked tRPC (DESIGN.md §Frame, the
 * project sidebar): the Orchestrator card, what needs you unheaded, the
 * Working shelf, the folded shelves and the foot's drive cards. The grouping
 * comes from the feature list the sidebar polls, which a static string cannot
 * show; the row-level words and dots are pinned in sidebar-row.test.ts.
 */

const PREPARED: PrepView = { prepared: true, pendingKeys: [], findings: [] } as unknown as PrepView

const data = vi.hoisted(() => ({
  features: [] as FeatureListItem[],
  prep: undefined as unknown,
  notes: 0,
  threads: [] as ThreadEntry[],
  archive: vi.fn(),
  unarchive: vi.fn(),
  stop: vi.fn(),
  useQueries: vi.fn(() => []),
}))

vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({ feature: { list: { invalidate: vi.fn() }, get: { invalidate: vi.fn() } } }),
    useQueries: data.useQueries,
    events: { listByProject: { useQuery: () => ({ data: undefined }) } },
    feature: {
      testDrive: { useMutation: () => ({ isPending: false, mutate: data.stop }) },
      list: { useQuery: () => ({ data: data.features, isLoading: false }) },
      archive: { useMutation: () => ({ mutate: data.archive }) },
      unarchive: { useMutation: () => ({ mutate: data.unarchive }) },
      delete: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
    },
    project: {
      prep: { useQuery: () => ({ data: data.prep }) },
      list: { useQuery: () => ({ data: [] }) },
    },
    projectNotes: { openCount: { useQuery: () => ({ data: data.notes }) } },
    thread: { list: { useQuery: () => ({ data: data.threads }) } },
  },
}))

let n = 0
const thread = (state: ThreadEntry['state'], updatedAt = 0): ThreadEntry => ({
  id: `th_${++n}`,
  title: 'New chat',
  role: 'project',
  state,
  updatedAt,
  runtime: 'claude-code',
})

const { Sidebar } = await import('../src/components/Sidebar')
const { ToastProvider } = await import('../src/lib/toast')

const nav = {
  projects: [{ id: 'proj_a', name: 'shop-app', repoPath: '/repo' }],
  loading: false,
  doctorError: null,
  recheckDoctor: () => {},
  view: 'project' as const,
  currentProjectId: 'proj_a',
  currentProject: { id: 'proj_a', name: 'shop-app', repoPath: '/repo' },
  goHome: () => {},
  enterProject: () => {},
  showOpen: () => {},
  cancelOpen: () => {},
}

function rail(
  over: {
    view?: 'feature' | 'project' | 'prepare'
    driving?: DriveState | null
    onOpenCmdk?: () => void
    onOpenPreparation?: () => void
  } = {},
) {
  return render(
    <ToastProvider>
      <Sidebar
        projectId="proj_a"
        nav={nav}
        view={over.view ?? 'feature'}
        selectedFeatureId={null}
        onSelect={vi.fn()}
        onSelectProject={vi.fn()}
        onNewChat={() => {}}
        onDraft={() => {}}
        onOpenPreparation={over.onOpenPreparation ?? (() => {})}
        onOpenCmdk={over.onOpenCmdk}
        driving={over.driving ?? null}
      />
    </ToastProvider>,
  )
}

const titled = (title: string, over: Parameters<typeof listItem>[0] = {}) => ({
  ...listItem({ id: title, ...over }),
  title,
})

const orchestrator = () => screen.getByRole('button', { name: /^Orchestrator/ })
/** The titles of a region's feature rows, in order. */
const titles = (region: HTMLElement) =>
  within(region)
    .queryAllByRole('button')
    .map((b) => b.getAttribute('title') ?? '')
    .filter((t) => t !== '')

afterEach(() => {
  cleanup()
  data.features = []
  data.prep = PREPARED
  data.notes = 0
  data.threads = []
  localStorage.clear()
  vi.clearAllMocks()
})
data.prep = PREPARED

describe('the head', () => {
  it('has a Search icon button, the Create menu and close — no search field row', () => {
    const onOpenCmdk = vi.fn()
    rail({ onOpenCmdk })
    fireEvent.click(screen.getByRole('button', { name: 'Search or jump to' }))
    expect(onOpenCmdk).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy()
    expect(screen.queryByText('Search')).toBeNull()
  })

  it('offers "Add to backlog" in the Create menu', () => {
    rail()
    openMenu(screen.getByRole('button', { name: 'Create' }))
    expect(screen.getByRole('menuitem', { name: /^Add to backlog/ })).toBeTruthy()
  })
})

describe('the Orchestrator card', () => {
  it('replaces the Project row, and is current while the project view is open', () => {
    rail({ view: 'project' })
    expect(orchestrator().getAttribute('aria-current')).toBe('page')
    expect(screen.queryByRole('button', { name: 'Project' })).toBeNull()
    cleanup()
    rail({ view: 'feature' })
    expect(orchestrator().getAttribute('aria-current')).toBeNull()
  })

  // Its state is its chats' (decision 14), as the project page's list and the switcher show them.
  it("says what the project's chats are doing, an empty new one not starting anything", () => {
    data.threads = [thread('idle'), thread('idle')]
    rail()
    expect(orchestrator().textContent).toContain('Plan, cut and ask')
    expect(orchestrator().querySelector('[data-progress]')).toBeNull()
    cleanup()
    data.threads = [thread('idle'), thread('working')]
    rail()
    expect(orchestrator().textContent).toContain('Working')
    expect(orchestrator().querySelector('[data-progress]')).not.toBeNull()
    expect(orchestrator().innerHTML).not.toContain('bg-warning')
  })

  it('waits amber while any of its chats waits on you, not only the newest', () => {
    data.threads = [thread('working', 2), thread('waiting', 1)]
    rail()
    expect(orchestrator().textContent).toContain('Waiting for you')
    expect(orchestrator().innerHTML).toContain('bg-warning')
  })

  it('holds Re-prepare in its menu once preparation is done', () => {
    const onOpenPreparation = vi.fn()
    rail({ onOpenPreparation })
    openMenu(screen.getByRole('button', { name: 'Project actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Re-prepare the project/ }))
    expect(onOpenPreparation).toHaveBeenCalledOnce()
    expect(screen.queryByText('Re-prepare project')).toBeNull()
  })
})

describe('what needs you', () => {
  it('lists preparation, then the waiting features, then the ones in progress — unheaded', () => {
    data.prep = { prepared: false, pendingKeys: ['a', 'b'], findings: [] }
    data.features = [
      titled('Order history', {
        ticketCounts: { total: 2, pending: 0, burning: 0, done: 1, failed: 1, cancelled: 0 },
      }),
      titled('Coupons', { waitingReason: 'ready to test' }),
      titled('Checkout', { waitingReason: 'stopped' }),
    ]
    rail()
    const needs = screen.getByRole('region', { name: 'Needs you' })
    expect(within(needs).getByText('Prepare this project')).toBeTruthy()
    expect(within(needs).getByText('2 to establish')).toBeTruthy()
    expect(needs.textContent!.indexOf('Prepare this project')).toBeLessThan(needs.textContent!.indexOf('Coupons'))
    expect(needs.textContent!.indexOf('Coupons')).toBeLessThan(needs.textContent!.indexOf('Checkout'))
    expect(needs.textContent!.indexOf('Checkout')).toBeLessThan(needs.textContent!.indexOf('Order history'))
    expect(within(needs).getByText('Ready to test')).toBeTruthy()
    expect(within(needs).getByText('Stopped')).toBeTruthy()
    expect(within(needs).getByText('In progress')).toBeTruthy()
    expect(within(needs).queryByRole('heading')).toBeNull()
  })

  it('keeps no lane headings, Project or Preparation rows, or runs elsewhere', () => {
    data.features = [
      titled('Coupons', { waitingReason: 'ready to test' }),
      titled('Order history', { waitingReason: 'stopped' }),
    ]
    rail()
    for (const gone of ['Inbox', 'In progress', 'Agent working', 'Drafts', 'Show archived'])
      expect(screen.queryByText(gone)).toBeNull()
    expect(screen.queryByText(/running elsewhere/)).toBeNull()
    expect(data.useQueries).not.toHaveBeenCalled()
  })
})

describe('the Working shelf', () => {
  it('holds the features with an agent at work, open in the bay', () => {
    data.features = [
      titled('Coupons', { waitingReason: 'ready to test' }),
      titled('Search', {
        activeRun: true,
        ticketCounts: { total: 7, pending: 4, burning: 0, done: 3, failed: 0, cancelled: 0 },
      }),
    ]
    rail()
    const working = screen.getByRole('region', { name: 'Working' })
    expect(titles(working)).toEqual(['Search'])
    expect(within(working).getByText('Working · 3/7')).toBeTruthy()
    expect(within(working).getByRole('button', { expanded: true })).toBeTruthy()
  })
})

describe('the folded shelves', () => {
  const shipped = Array.from({ length: 7 }, (_, i) => titled(`Shipped ${i}`, { status: 'shipped' }))

  it('count Backlog, Shipped and Archived while folded — archived included', () => {
    data.features = [
      titled('Idea', { status: 'draft' }),
      ...shipped,
      titled('Old', { status: 'archived' }),
      titled('Older', { status: 'archived' }),
    ]
    rail()
    for (const [name, n] of [['Backlog', '1'], ['Shipped', '7'], ['Archived', '2']] as const) {
      const shelf = screen.getByRole('region', { name })
      const head = within(shelf).getByRole('button', { expanded: false })
      expect(head.textContent).toBe(`${name}${n}`)
      expect(titles(shelf)).toEqual([])
    }
  })

  it('open Shipped on five rows, then "Show N more"', () => {
    data.features = shipped
    rail()
    const shelf = screen.getByRole('region', { name: 'Shipped' })
    fireEvent.click(within(shelf).getByRole('button', { expanded: false }))
    expect(titles(shelf)).toHaveLength(5)
    fireEvent.click(within(shelf).getByText('Show 2 more'))
    expect(titles(shelf)).toHaveLength(7)
  })

  it('start Archived open when it was left open', () => {
    localStorage.setItem('runcastle.sidebar.showArchived', '1')
    data.features = [titled('Old', { status: 'archived' })]
    rail()
    expect(titles(screen.getByRole('region', { name: 'Archived' }))).toEqual(['Old'])
  })

  it('remember the Archived shelf being opened', () => {
    data.features = [titled('Old', { status: 'archived' })]
    rail()
    fireEvent.click(within(screen.getByRole('region', { name: 'Archived' })).getByRole('button', { expanded: false }))
    expect(localStorage.getItem('runcastle.sidebar.showArchived')).toBe('1')
  })
})

describe('the row menus', () => {
  it('archive a feature and unarchive an archived one', () => {
    localStorage.setItem('runcastle.sidebar.showArchived', '1')
    data.features = [titled('Coupons', { id: 'f1' }), titled('Old', { id: 'f2', status: 'archived' })]
    rail()
    const [first, second] = screen.getAllByRole('button', { name: 'Feature actions' })
    openMenu(first!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))
    expect(data.archive).toHaveBeenCalledWith({ featureId: 'f1' })
    openMenu(second!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unarchive' }))
    expect(data.unarchive).toHaveBeenCalledWith({ featureId: 'f2' })
  })
})

describe('the foot', () => {
  it('shows a test drive as a card naming its feature, with Stop', () => {
    data.features = [titled('Coupons', { id: 'f1' })]
    rail({ driving: { featureId: 'f1', branch: 'feature/coupons' } as DriveState })
    const card = screen.getByRole('button', { name: /^Test drive/ })
    expect(card.textContent).toBe('Test driveCoupons')
    fireEvent.click(screen.getByRole('button', { name: 'Stop the test drive' }))
    expect(data.stop).toHaveBeenCalledWith({ featureId: 'f1', action: 'stop' })
  })
})
