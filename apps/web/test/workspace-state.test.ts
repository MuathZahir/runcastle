// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialTab, rememberedView, useWorkspace } from '../src/lib/workspace'

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
  const none = { stored: null, isDraft: false }

  it('lands a first visit on the chat alone: nothing opens the panel by itself', () => {
    expect(initialTab(none)).toBe('chat')
  })

  it('restores the remembered view', () => {
    expect(initialTab({ ...none, stored: 'chat' })).toBe('chat')
    expect(initialTab({ ...none, stored: 'details' })).toBe('details')
    expect(initialTab({ ...none, stored: 'drive' })).toBe('drive')
  })

  it('reopens a feature left on the retired Overview or Tickets tab on its body', () => {
    expect(initialTab({ ...none, stored: 'overview' })).toBe('body')
    expect(initialTab({ ...none, stored: 'tickets' })).toBe('body')
  })

  it('always lands a draft on its body, which is its page', () => {
    expect(initialTab({ stored: 'chat', isDraft: true })).toBe('body')
    expect(initialTab({ ...none, isDraft: true })).toBe('body')
  })

  it('treats an unrecognised stored value as nothing remembered', () => {
    expect(initialTab({ ...none, stored: 'board' })).toBe('chat')
    expect(initialTab({ ...none, stored: '' })).toBe('chat')
  })
})

describe('useWorkspace — per-feature view memory', () => {
  afterEach(() => {
    localStorage.clear()
    cleanup()
    vi.restoreAllMocks()
  })

  const active = { status: 'active' }

  it('remembers the view each feature was left on, per feature', () => {
    const { result } = renderHook(() => useWorkspace('proj_1'))
    act(() => result.current.select('feat_a', rememberedView('feat_a', active)))
    expect(result.current.featureView).toBe('chat')
    act(() => result.current.selectView('body'))
    act(() => result.current.select('feat_b', rememberedView('feat_b', active)))
    expect(result.current.featureView).toBe('chat')
    act(() => result.current.selectView('details'))

    act(() => result.current.select('feat_a', rememberedView('feat_a', active)))
    expect(result.current.featureView).toBe('body')
    act(() => result.current.select('feat_b', rememberedView('feat_b', active)))
    expect(result.current.featureView).toBe('details')
  })

  it('selects the chat alone when a selection names no view', () => {
    const { result } = renderHook(() => useWorkspace('proj_1'))
    act(() => result.current.select('feat_a', 'body'))
    act(() => result.current.select('feat_a'))
    expect(result.current.featureView).toBe('chat')
  })

  it('starts on the restored feature’s remembered view across a reload', () => {
    localStorage.setItem('runcastle.selected.v1:proj_1', 'feat_a')
    localStorage.setItem('runcastle.feature.tab:feat_a', 'preview')
    const { result } = renderHook(() => useWorkspace('proj_1'))
    expect(result.current.selectedFeatureId).toBe('feat_a')
    expect(result.current.featureView).toBe('preview')
    // Mounting is not a choice: nothing remembered is overwritten by it.
    expect(localStorage.getItem('runcastle.feature.tab:feat_a')).toBe('preview')
  })

  it('still navigates when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(rememberedView('feat_a', active)).toBe('chat')
    const { result } = renderHook(() => useWorkspace('proj_1'))
    act(() => result.current.select('feat_a', 'body'))
    expect(result.current.featureView).toBe('body')
  })
})
