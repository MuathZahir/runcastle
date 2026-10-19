// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAP_UNGROUPED } from '@runcastle/core'
import type { FeatureListItem } from '../src/lib/api'
import { listItem } from './fixtures'

/**
 * The sidebar's pinned Inbox and its Work | Map switch (the-map-of-stories-
 * and-scenarios decisions 2, 3). Tier 2: the mode is state remembered in
 * localStorage and moved by clicks, which a static string cannot show.
 */

const data = vi.hoisted(() => ({ features: [] as FeatureListItem[] }))

vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({ feature: { list: { invalidate: vi.fn() }, get: { invalidate: vi.fn() } } }),
    useQueries: () => [],
    events: { listByProject: { useQuery: () => ({ data: undefined }) } },
    feature: {
      testDrive: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      list: { useQuery: () => ({ data: data.features, isLoading: false }) },
      archive: { useMutation: () => ({ mutate: vi.fn() }) },
      unarchive: { useMutation: () => ({ mutate: vi.fn() }) },
      delete: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
    },
    project: {
      prep: { useQuery: () => ({ data: { prepared: true, pendingKeys: [], findings: [] } }) },
      list: { useQuery: () => ({ data: [] }) },
      map: {
        useQuery: () => ({
          data: {
            groups: [
              { id: 'checkout', name: 'Checkout', components: [], scenarios: [] },
              { id: 'checkout/coupons', name: 'Coupons', parentId: 'checkout', components: [], scenarios: [] },
              { id: MAP_UNGROUPED, name: 'Ungrouped', components: [], scenarios: [] },
            ],
          },
        }),
      },
    },
    projectNotes: { openCount: { useQuery: () => ({ data: 0 }) } },
  },
}))

const { Sidebar } = await import('../src/components/Sidebar')
const { ToastProvider } = await import('../src/lib/toast')

const nav = {
  projects: [],
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

function rail(over: { projectId?: string; mapSelection?: string | null; onOpenMap?: (g: string | null) => void } = {}) {
  const onSelect = vi.fn()
  const onSelectProject = vi.fn()
  const onOpenMap = over.onOpenMap ?? vi.fn()
  const view = (props: typeof over) => (
    <ToastProvider>
      <Sidebar
        projectId={props.projectId ?? 'proj_a'}
        nav={nav}
        view="feature"
        selectedFeatureId={null}
        talk={{ state: 'none' } as never}
        onSelect={onSelect}
        onSelectProject={onSelectProject}
        mapSelection={props.mapSelection}
        onOpenMap={onOpenMap}
        onNewChat={() => {}}
        onDraft={() => {}}
        onOpenPreparation={() => {}}
      />
    </ToastProvider>
  )
  const r = render(view(over))
  return { ...r, onSelect, onSelectProject, onOpenMap, rerenderWith: (p: typeof over) => r.rerender(view(p)) }
}

const tab = (name: 'Work' | 'Map') => screen.getByRole('tab', { name })
const inbox = () => screen.getByRole('region', { name: 'Inbox' })

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
  data.features = []
})

describe('the pinned Inbox', () => {
  it('holds the waiting features in both modes, and Work keeps the other lanes', () => {
    data.features = [
      { ...listItem({ id: 'f1', phase: 'review' }), title: 'Coupons' },
      { ...listItem({ id: 'f2', phase: 'building' }), title: 'Order history' },
    ]
    rail()
    expect(within(inbox()).getByText('Coupons')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'In progress' }).textContent).toContain('Order history')
    expect(screen.queryByRole('region', { name: 'Needs you' })).toBeNull()

    fireEvent.click(tab('Map'))
    expect(within(inbox()).getByText('Coupons')).toBeTruthy()
    expect(screen.queryByText('Order history')).toBeNull()
  })

  it('says Nothing needs you when nothing waits', () => {
    data.features = [listItem({ id: 'f2', phase: 'building' })]
    rail()
    expect(within(inbox()).getByText('Nothing needs you')).toBeTruthy()
  })
})

describe('the Work | Map switch', () => {
  it('starts in Work, and remembers the choice per project', () => {
    const r = rail()
    expect(tab('Work').getAttribute('aria-selected')).toBe('true')
    fireEvent.click(tab('Map'))
    expect(screen.getByRole('region', { name: 'Map' })).toBeTruthy()
    expect(localStorage.getItem('runcastle.sidebarMode.proj_a')).toBe('map')

    r.rerenderWith({ projectId: 'proj_b' })
    expect(tab('Work').getAttribute('aria-selected')).toBe('true')
    r.rerenderWith({ projectId: 'proj_a' })
    expect(tab('Map').getAttribute('aria-selected')).toBe('true')
  })

  it('changes only the sidebar, never the content panel', () => {
    const r = rail()
    fireEvent.click(tab('Map'))
    fireEvent.click(tab('Work'))
    expect(r.onOpenMap).not.toHaveBeenCalled()
    expect(r.onSelect).not.toHaveBeenCalled()
    expect(r.onSelectProject).not.toHaveBeenCalled()
  })

  it('still renders and switches when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    rail()
    expect(tab('Work').getAttribute('aria-selected')).toBe('true')
    fireEvent.click(tab('Map'))
    expect(tab('Map').getAttribute('aria-selected')).toBe('true')
  })

  it('is forced to Map at a map address, whatever was remembered', () => {
    localStorage.setItem('runcastle.sidebarMode.proj_a', 'work')
    const r = rail()
    expect(tab('Work').getAttribute('aria-selected')).toBe('true')
    r.rerenderWith({ mapSelection: null })
    expect(tab('Map').getAttribute('aria-selected')).toBe('true')
    // Leaving the map for a feature keeps the explorer open beside it.
    r.rerenderWith({ mapSelection: undefined })
    expect(tab('Map').getAttribute('aria-selected')).toBe('true')
  })
})

describe('the Map tree', () => {
  it('opens the Overview or a group by its id, and highlights the open one', () => {
    const onOpenMap = vi.fn()
    rail({ mapSelection: 'checkout/coupons', onOpenMap })
    const tree = screen.getByRole('region', { name: 'Map' })
    expect(within(tree).getByRole('button', { name: 'Coupons' }).getAttribute('aria-current')).toBeTruthy()

    fireEvent.click(within(tree).getByRole('button', { name: 'Overview' }))
    fireEvent.click(within(tree).getByRole('button', { name: 'Checkout' }))
    fireEvent.click(within(tree).getByRole('button', { name: 'Ungrouped' }))
    expect(onOpenMap.mock.calls).toEqual([[null], ['checkout'], [MAP_UNGROUPED]])
  })
})
