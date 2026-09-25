// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const deleteMutation = vi.hoisted(() => ({
  onSuccess: undefined as undefined | ((result: unknown, variables: { featureId: string }) => void),
}))

vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({ feature: { list: { invalidate: vi.fn() }, get: { invalidate: vi.fn() } } }),
    useQueries: () => [],
    events: { listByProject: { useQuery: () => ({ data: undefined }) } },
    feature: {
      testDrive: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      list: { useQuery: () => ({ data: [], isLoading: false }) },
      archive: { useMutation: () => ({ mutate: vi.fn() }) },
      unarchive: { useMutation: () => ({ mutate: vi.fn() }) },
      delete: {
        useMutation: (options: typeof deleteMutation) => {
          deleteMutation.onSuccess = options.onSuccess
          return { isPending: false, mutate: vi.fn() }
        },
      },
    },
    project: {
      prep: { useQuery: () => ({ data: { prepared: true, pendingKeys: [], findings: [] } }) },
      list: { useQuery: () => ({ data: [{ id: 'project-1', name: 'Project' }] }) },
    },
    projectNotes: { openCount: { useQuery: () => ({ data: 0 }) } },
  },
}))

import { Sidebar } from '../src/components/Sidebar'
import { ToastProvider } from '../src/lib/toast'
import type { ProjectNavApi } from '../src/lib/use-project-nav'

const nav: ProjectNavApi = {
  projects: [{ id: 'project-1', name: 'Project', repoPath: '/repo' }],
  loading: false,
  doctorError: null,
  recheckDoctor: vi.fn(),
  view: 'project',
  currentProjectId: 'project-1',
  currentProject: { id: 'project-1', name: 'Project', repoPath: '/repo' },
  goHome: vi.fn(),
  enterProject: vi.fn(),
  showOpen: vi.fn(),
  cancelOpen: vi.fn(),
}

describe('Sidebar delete navigation', () => {
  afterEach(cleanup)

  it('leaves a feature route after the selected feature is deleted', () => {
    const onSelect = vi.fn()
    const onSelectProject = vi.fn()

    render(
      <ToastProvider>
        <Sidebar
          projectId="project-1"
          nav={nav}
          view="feature"
          selectedFeatureId="feat_deleted"
          talk={{ state: 'none' } as never}
          onSelect={onSelect}
          onSelectProject={onSelectProject}
          onNewChat={() => {}}
          onDraft={() => {}}
          onOpenPreparation={() => {}}
        />
      </ToastProvider>,
    )

    act(() => deleteMutation.onSuccess?.({}, { featureId: 'feat_deleted' }))

    expect(onSelect).toHaveBeenCalledWith(null)
    expect(onSelectProject).toHaveBeenCalledOnce()
  })
})
