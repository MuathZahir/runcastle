// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialTab, inspectorCollapsedForPhase, rememberedView, useWorkspace } from '../src/lib/workspace'

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

  it('defaults Details closed in every phase until the human opens it', () => {
    expect(inspectorCollapsedForPhase(null, 'planning')).toBe(true)
    expect(inspectorCollapsedForPhase(null, 'planning')).toBe(true)
    expect(inspectorCollapsedForPhase(null, 'planning')).toBe(true)
    expect(inspectorCollapsedForPhase(null, 'building')).toBe(true)
    expect(inspectorCollapsedForPhase(null, 'review')).toBe(true)
    expect(inspectorCollapsedForPhase(null, 'shipped')).toBe(true)
    expect(inspectorCollapsedForPhase(true, 'review')).toBe(true)
    expect(inspectorCollapsedForPhase(false, 'planning')).toBe(false)
  })

  it('opens a phase-defaulted collapsed inspector on the first toggle', () => {
    const { result } = renderHook(() => useWorkspace('proj_1'))
    act(() => result.current.toggleInspector(true))
    expect(result.current.inspectorPreference).toBe(false)
    expect(localStorage.getItem('runcastle.inspector.collapsed')).toBe('0')
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

/**
 * one-chat-layout-everywhere decision 8 — each feature reopens on the view it
 * was left on. `initialTab` is the pure rule; the hook is where the choice is
 * remembered.
 */
describe('initialTab — which view a feature opens on', () => {
  const none = { stored: null, hasLiveSession: false, isDraft: false }

  it('lands a first visit on Overview, or on Chat when a session is live', () => {
    expect(initialTab(none)).toBe('overview')
    expect(initialTab({ ...none, hasLiveSession: true })).toBe('chat')
  })

  it('restores the remembered view, whatever is live', () => {
    expect(initialTab({ ...none, stored: 'tickets' })).toBe('tickets')
    expect(initialTab({ ...none, stored: 'overview', hasLiveSession: true })).toBe('overview')
    expect(initialTab({ ...none, stored: 'chat' })).toBe('chat')
  })

  it('never lands a draft on Chat', () => {
    expect(initialTab({ stored: 'chat', hasLiveSession: true, isDraft: true })).toBe('overview')
    expect(initialTab({ ...none, hasLiveSession: true, isDraft: true })).toBe('overview')
  })

  it('treats an unrecognised stored value as nothing remembered', () => {
    expect(initialTab({ ...none, stored: 'drive' })).toBe('overview')
    expect(initialTab({ ...none, stored: '', hasLiveSession: true })).toBe('chat')
  })
})

describe('useWorkspace — per-feature view memory', () => {
  afterEach(() => {
    localStorage.clear()
    cleanup()
    vi.restoreAllMocks()
  })

  const live = { status: 'active', liveSession: { status: 'live' } }
  const quiet = { status: 'active', liveSession: null }

  it('remembers the view each feature was left on, per feature', () => {
    const { result } = renderHook(() => useWorkspace('proj_1'))
    act(() => result.current.select('feat_a', rememberedView('feat_a', quiet)))
    expect(result.current.featureView).toBe('overview')
    act(() => result.current.selectView('tickets'))
    act(() => result.current.select('feat_b', rememberedView('feat_b', live)))
    expect(result.current.featureView).toBe('chat')
    act(() => result.current.selectView('overview'))

    act(() => result.current.select('feat_a', rememberedView('feat_a', quiet)))
    expect(result.current.featureView).toBe('tickets')
    act(() => result.current.select('feat_b', rememberedView('feat_b', live)))
    expect(result.current.featureView).toBe('overview')
  })

  it('selects Overview when a selection names no view', () => {
    const { result } = renderHook(() => useWorkspace('proj_1'))
    act(() => result.current.select('feat_a', 'chat'))
    act(() => result.current.select('feat_a'))
    expect(result.current.featureView).toBe('overview')
  })

  it('starts on the restored feature’s remembered view across a reload', () => {
    localStorage.setItem('runcastle.selected.v1:proj_1', 'feat_a')
    localStorage.setItem('runcastle.feature.tab:feat_a', 'chat')
    const { result } = renderHook(() => useWorkspace('proj_1'))
    expect(result.current.selectedFeatureId).toBe('feat_a')
    expect(result.current.featureView).toBe('chat')
    // Mounting is not a choice: nothing remembered is overwritten by it.
    expect(localStorage.getItem('runcastle.feature.tab:feat_a')).toBe('chat')
  })

  it('still navigates when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(rememberedView('feat_a', live)).toBe('chat')
    const { result } = renderHook(() => useWorkspace('proj_1'))
    act(() => result.current.select('feat_a', 'tickets'))
    expect(result.current.featureView).toBe('tickets')
  })
})
