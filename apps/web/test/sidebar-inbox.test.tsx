// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadEntry } from '@runcastle/core'
import type { FeatureListItem } from '../src/lib/api'
import type { DriveState } from '../src/lib/workspace'
import { listItem, need } from './fixtures'
import { openMenu } from './floating'

/**
 * The project sidebar rendered whole, over faked tRPC (DESIGN.md §Frame, the
 * project sidebar): the epic list, Other features,
 * the folded shelves and the foot's drive cards. The grouping
 * comes from the feature list the sidebar polls, which a static string cannot
 * show; the row-level words and dots are pinned in sidebar-row.test.ts.
 */

const data = vi.hoisted(() => ({
  features: [] as FeatureListItem[],
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
      list: { useQuery: () => ({ data: [] }) },
    },
    projectNotes: { openCount: { useQuery: () => ({ data: data.notes }) } },
    thread: {
      list: { useQuery: () => ({ data: data.threads }) },
      // The sidebar thread rows' Rename (threads-in-the-sidebar decision 5).
      rename: { useMutation: () => ({ mutate: () => {} }) },
    },
  },
}))

let n = 0
const thread = (state: ThreadEntry['state'], updatedAt = 0): ThreadEntry => ({
  id: `th_${++n}`,
  title: 'New chat',
  role: 'project',
  state,
  createdAt: updatedAt,
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
    view?: 'feature' | 'project'
    driving?: DriveState | null
    onOpenCmdk?: () => void
    onOpenChat?: (threadId: string) => void
    onOpenConversations?: () => void
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
        onOpenCmdk={over.onOpenCmdk}
        driving={over.driving ?? null}
        {...(over.onOpenChat ? { onOpenChat: over.onOpenChat } : {})}
        {...(over.onOpenConversations ? { onOpenConversations: over.onOpenConversations } : {})}
      />
    </ToastProvider>,
  )
}

const titled = (title: string, over: Parameters<typeof listItem>[0] = {}) => ({
  ...listItem({ id: title, ...over }),
  // The fixture keeps only the fields it knows; the origin chat and holder ride along.
  ...('chatId' in over ? { chatId: over.chatId } : {}),
  ...('heldBy' in over ? { heldBy: over.heldBy } : {}),
  title,
})

/** An orchestrator chat with a name, an epic. */
const epic = (id: string, title: string, over: Partial<ThreadEntry> = {}): ThreadEntry => ({
  ...thread('idle'),
  id,
  title,
  ...over,
})
const epics = () => screen.getByRole('region', { name: 'Epics' })
/** An epic's row: the door to its chat. */
const epicRow = (title: string) => document.querySelector(`[data-epic] > button[title^="${title}"]`) as HTMLButtonElement
/** The titles of a region's feature rows, in order. */
const titles = (region: HTMLElement) =>
  within(region)
    .queryAllByRole('button')
    .map((b) => b.getAttribute('title') ?? '')
    .filter((t) => t !== '')

afterEach(() => {
  cleanup()
  data.features = []
  data.notes = 0
  data.threads = []
  localStorage.clear()
  vi.clearAllMocks()
})

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

describe('the epics (orchestrator-chats-become-epics)', () => {
  it('lists the epics on a feature page, with no card and no lanes, and opens a chat from its row', () => {
    const onOpenChat = vi.fn()
    data.threads = [epic('pay', 'Payment System', { state: 'working' })]
    data.features = [titled('Retry policy', { chatId: 'pay', heldBy: 'pay' })]
    rail({ view: 'feature', onOpenChat })
    expect(within(epics()).getByText('Payment System')).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Payment System' })).getByText('Retry policy')).toBeTruthy()
    for (const gone of ['Needs you', 'Working', 'Up next'])
      expect(screen.queryByRole('region', { name: gone })).toBeNull()
    expect(screen.queryByText(/Orchestrator/)).toBeNull()
    fireEvent.click(epicRow('Payment System'))
    expect(onOpenChat).toHaveBeenCalledWith('pay')
  })

  it('names another chat that runs a nested feature, in its own words, and keeps a permission prompt yellow', () => {
    data.threads = [epic('pay', 'Payment System', { state: 'working' }), epic('notes', 'Notes triage', { state: 'working' })]
    data.features = [
      titled('Billing emails', {
        chatId: 'pay',
        heldBy: 'notes',
        need: need('test', 'With Notes triage · Ready to test · Invoices', { held: true }),
      }),
      titled('Export to CSV', { chatId: 'pay', heldBy: 'pay', need: need('permission', 'Needs permission · Bash: git push') }),
    ]
    rail()
    const nested = screen.getByRole('group', { name: 'Payment System' })
    expect(within(nested).getByText('With Notes triage · Ready to test · Invoices')).toBeTruthy()
    expect(within(nested).getByText('Needs permission · Bash: git push')).toBeTruthy()
    // Needs you first inside the epic (decision 8).
    expect(nested.textContent!.indexOf('Export to CSV')).toBeLessThan(nested.textContent!.indexOf('Billing emails'))
  })

  it('puts a feature with no epic under Other features', () => {
    data.features = [titled('Loose', { need: need('test', 'Ready to test') })]
    rail()
    expect(within(screen.getByRole('group', { name: 'Other features' })).getByText('Loose')).toBeTruthy()
  })

  it('leaves a quiet chat out, for "All N epics"', () => {
    const onOpenConversations = vi.fn()
    data.threads = [epic('pay', 'Payment System', { state: 'waiting' }), epic('old', 'Old idea')]
    rail({ onOpenConversations })
    expect(epicRow('Payment System')).toBeTruthy()
    expect(epicRow('Old idea')).toBeNull()
    fireEvent.click(within(epics()).getByText('All 2 epics'))
    expect(onOpenConversations).toHaveBeenCalledOnce()
  })

  it('keeps no lane headings, Project or Preparation rows, or runs elsewhere', () => {
    data.features = [
      titled('Coupons', { need: need('test', 'Ready to test') }),
      titled('Order history', { need: need('stopped', 'Stopped · you stopped it') }),
    ]
    rail()
    for (const gone of ['Inbox', 'Agent working', 'Drafts', 'Show archived'])
      expect(screen.queryByText(gone)).toBeNull()
    expect(screen.queryByText(/running elsewhere/)).toBeNull()
    expect(data.useQueries).not.toHaveBeenCalled()
  })
})

describe('the folded shelves', () => {
  it('name each row’s epic quietly (decision 21)', () => {
    localStorage.setItem('runcastle.sidebar.showArchived', '1')
    data.threads = [epic('pay', 'Payment System')]
    data.features = [titled('Receipts', { status: 'archived', chatId: 'pay' })]
    rail()
    expect(within(screen.getByRole('region', { name: 'Archived' })).getByText('Payment System')).toBeTruthy()
  })

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
