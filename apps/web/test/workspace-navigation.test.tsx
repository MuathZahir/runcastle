// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useWorkspace } from '../src/lib/workspace'

describe('feature selection persistence', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('forgets a deleted feature when navigation clears the selection', () => {
    const projectId = 'project-delete-navigation'
    const selectionKey = `runcastle.selected.v1:${projectId}`
    localStorage.setItem(selectionKey, 'feat_deleted')

    const { result } = renderHook(() => useWorkspace(projectId))

    act(() => {
      result.current.select(null)
      result.current.selectProject()
    })

    expect(result.current.selectedFeatureId).toBeNull()
    expect(result.current.projectSelected).toBe(true)
    expect(localStorage.getItem(selectionKey)).toBeNull()
  })
})
