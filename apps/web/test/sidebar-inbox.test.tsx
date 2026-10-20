// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeatureListItem } from '../src/lib/api'
import { listItem } from './fixtures'

/**
 * The sidebar's pinned Inbox above the Work lanes, rendered whole: the lanes
 * come from the feature list the sidebar polls, which a static string cannot
 * show.
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

function rail() {
  return render(
    <ToastProvider>
      <Sidebar
        projectId="proj_a"
        nav={nav}
        view="feature"
        selectedFeatureId={null}
        talk={{ state: 'none' } as never}
        onSelect={vi.fn()}
        onSelectProject={vi.fn()}
        onNewChat={() => {}}
        onDraft={() => {}}
        onOpenPreparation={() => {}}
      />
    </ToastProvider>,
  )
}

const inbox = () => screen.getByRole('region', { name: 'Inbox' })

afterEach(() => {
  cleanup()
  data.features = []
})

describe('the pinned Inbox', () => {
  it('holds the waiting features, and the Work lanes below it keep the rest', () => {
    data.features = [
      { ...listItem({ id: 'f1', phase: 'review' }), title: 'Coupons' },
      { ...listItem({ id: 'f2', phase: 'building' }), title: 'Order history' },
    ]
    rail()
    expect(within(inbox()).getByText('Coupons')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'In progress' }).textContent).toContain('Order history')
    expect(screen.queryByRole('region', { name: 'Needs you' })).toBeNull()
  })

  it('has no Work | Map switch and no Map tree', () => {
    rail()
    expect(screen.queryByRole('tab', { name: 'Map' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Map' })).toBeNull()
  })

  it('says Nothing needs you when nothing waits', () => {
    data.features = [listItem({ id: 'f2', phase: 'building' })]
    rail()
    expect(within(inbox()).getByText('Nothing needs you')).toBeTruthy()
  })
})
