// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EventRow } from '@runcastle/core'
import { panelShowRequest } from '../src/lib/feature-ui/panel'
import { usePanelShow } from '../src/components/workspace/use-panel-show'

/** The agent's `show_panel` (design-mode decision 5): a `panel.show` opens that view, for this feature only. */
const event = (id: number, over: Partial<EventRow> = {}): EventRow => ({
  id,
  projectId: 'p1',
  featureId: 'f1',
  ts: id,
  type: 'panel.show',
  message: 'show the design',
  data: { view: 'design', path: '/preview/invites' },
  ...over,
})

describe('panelShowRequest', () => {
  it("reads this feature's request, path and all", () => {
    expect(panelShowRequest(event(1), 'f1')).toEqual({ view: 'design', path: '/preview/invites' })
    expect(panelShowRequest(event(1, { data: { view: 'body' } }), 'f1')).toEqual({ view: 'body' })
  })

  it("ignores another feature's request, another event, and a view it does not know", () => {
    expect(panelShowRequest(event(1, { featureId: 'f2' }), 'f1')).toBeNull()
    expect(panelShowRequest(event(1, { type: 'docs.changed' }), 'f1')).toBeNull()
    expect(panelShowRequest(event(1, { data: { view: 'map' } }), 'f1')).toBeNull()
    expect(panelShowRequest(event(1, { data: undefined }), 'f1')).toBeNull()
  })
})

describe('usePanelShow', () => {
  afterEach(cleanup)

  it('opens on each new request for this feature, never replaying history or another feature', () => {
    const onShow = vi.fn()
    const { rerender } = renderHook(({ events }) => usePanelShow(events, 'f1', onShow), {
      initialProps: { events: [event(1)] },
    })
    // The batch the log loads on mount is history.
    expect(onShow).not.toHaveBeenCalled()

    rerender({ events: [event(1), event(2, { featureId: 'f2' }), event(3, { data: { view: 'details' } })] })
    expect(onShow).toHaveBeenCalledTimes(1)
    expect(onShow).toHaveBeenCalledWith({ view: 'details' })

    // A refetch that brings nothing new raises nothing again.
    rerender({ events: [event(1), event(2, { featureId: 'f2' }), event(3, { data: { view: 'details' } })] })
    expect(onShow).toHaveBeenCalledTimes(1)
  })
})
