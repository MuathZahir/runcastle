// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const deleteMutation = vi.hoisted(() => ({
  onSuccess: undefined as undefined | ((result: unknown, variables: { featureId: string }) => void),
}))

vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({ feature: { list: { invalidate: vi.fn() } } }),
    feature: {
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
  },
}))

import { Sidebar } from '../src/components/Sidebar'
import { ToastProvider } from '../src/lib/toast'

describe('Sidebar delete navigation', () => {
  afterEach(cleanup)

  it('leaves a feature route after the selected feature is deleted', () => {
    const onSelect = vi.fn()
    const onSelectProject = vi.fn()

    render(
      <ToastProvider>
        <Sidebar
          projectId="project-1"
          selectedFeatureId="feat_deleted"
          projectSelected={false}
          width={300}
          talk={{ state: 'none' } as never}
          onSelect={onSelect}
          onSelectProject={onSelectProject}
          onNewChat={() => {}}
          onQuickChange={() => {}}
          onOpenPreparation={() => {}}
          onResize={() => {}}
        />
      </ToastProvider>,
    )

    act(() => deleteMutation.onSuccess?.({}, { featureId: 'feat_deleted' }))

    expect(onSelect).toHaveBeenCalledWith(null)
    expect(onSelectProject).toHaveBeenCalledOnce()
  })
})
