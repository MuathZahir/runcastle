// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectorCollapsedForPhase, useWorkspace } from '../src/lib/workspace'

describe('useWorkspace — pane preferences', () => {
  afterEach(() => {
    localStorage.clear()
    cleanup()
  })

  it('distinguishes a never-written inspector preference from an explicit choice', () => {
    const { result } = renderHook(() => useWorkspace('proj_1'))
    expect(result.current.inspectorPreference).toBeNull()
    act(() => result.current.toggleInspector())
    expect(result.current.inspectorPreference).toBe(true)
    expect(localStorage.getItem('runcastle.inspector.collapsed')).toBe('1')
  })

  it('persists the artifact pane collapse choice', () => {
    const { result } = renderHook(() => useWorkspace('proj_1'))
    expect(result.current.artifactPaneCollapsed).toBe(false)
    act(() => result.current.toggleArtifactPane())
    expect(result.current.artifactPaneCollapsed).toBe(true)
    expect(localStorage.getItem('runcastle.artifact.collapsed')).toBe('1')
  })

  it('defaults Details closed only during ideation through tickets', () => {
    expect(inspectorCollapsedForPhase(null, 'ideation')).toBe(true)
    expect(inspectorCollapsedForPhase(null, 'spec')).toBe(true)
    expect(inspectorCollapsedForPhase(null, 'tickets')).toBe(true)
    expect(inspectorCollapsedForPhase(null, 'implementation')).toBe(false)
    expect(inspectorCollapsedForPhase(null, 'review')).toBe(false)
    expect(inspectorCollapsedForPhase(true, 'review')).toBe(true)
    expect(inspectorCollapsedForPhase(false, 'ideation')).toBe(false)
  })
})

/**
 * Settings is a place, not a flag (flow-redesign-settings, decision 9): the
 * dialog has four pages and rows worth linking to, so what the shell holds is
 * where settings is open — and every opener says where it wants to land.
 */
describe('useWorkspace — settings', () => {
  afterEach(cleanup)

  it('starts closed', () => {
    const { result } = renderHook(() => useWorkspace('proj_1'))
    expect(result.current.settings).toBeNull()
  })

  it('opens on General when the caller does not care where', () => {
    const { result } = renderHook(() => useWorkspace('proj_1'))
    act(() => result.current.openSettings())
    expect(result.current.settings).toEqual({ page: 'general' })
  })

  it('lands on the page and the row an error message pointed at', () => {
    const { result } = renderHook(() => useWorkspace('proj_1'))
    act(() => result.current.openSettings({ page: 'burns', field: 'sandcastle-image' }))
    expect(result.current.settings).toEqual({ page: 'burns', field: 'sandcastle-image' })
  })

  // Only one overlay is up at a time; the palette is where most opens come from.
  it('closes the command palette on the way in', () => {
    const { result } = renderHook(() => useWorkspace('proj_1'))
    act(() => result.current.setCmdk(true))
    act(() => result.current.openSettings({ page: 'models' }))
    expect(result.current.cmdkOpen).toBe(false)
  })

  it('closes back to whatever was underneath', () => {
    const { result } = renderHook(() => useWorkspace('proj_1'))
    act(() => result.current.openSettings({ page: 'project' }))
    act(() => result.current.closeSettings())
    expect(result.current.settings).toBeNull()
  })
})
