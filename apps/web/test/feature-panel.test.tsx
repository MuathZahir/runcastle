// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureView } from '../src/lib/routes'
import { FeaturePanel, PanelSplit, PanelStrip, usePanel } from '../src/components/workspace/FeaturePanel'

/**
 * The panel's behaviour a static string cannot show (design-mode decision 5):
 * the divider's drag and double-click, the fold, and the size surviving a
 * reload and a storage that throws.
 */
function Page({ start = 'body' as FeatureView }) {
  const [view, setView] = useState<FeatureView>(start)
  const panel = usePanel(view === 'chat' ? null : view, setView)
  const shown = panel.state.view
  return (
    <PanelSplit
      chat={<div>the chat</div>}
      panel={
        shown && (
          <FeaturePanel
            view={shown}
            views={['body', 'details']}
            label={(v) => v}
            onSwitch={(v) => panel.dispatch({ type: 'switch', view: v })}
            onCollapse={() => panel.dispatch({ type: 'collapse' })}
            onClose={() => panel.dispatch({ type: 'close' })}
          >
            the body
          </FeaturePanel>
        )
      }
      share={panel.state.share}
      collapsed={panel.state.collapsed}
      strip={
        shown && (
          <PanelStrip
            label="Body"
            onExpand={() => panel.dispatch({ type: 'expand' })}
            onClose={() => panel.dispatch({ type: 'close' })}
          />
        )
      }
      onResize={(share) => panel.dispatch({ type: 'setWidth', share })}
      onToggleFull={() => panel.dispatch({ type: 'toggleFull' })}
    />
  )
}

const panelWidth = () => (document.querySelector('[data-panel]') as HTMLElement | null)?.style.width
const divider = () => screen.getByRole('separator', { name: 'Resize the panel' })

/** Drag the divider from x=500 to `to` over a 1000px row. */
function drag(to: number) {
  fireEvent.mouseDown(divider(), { clientX: 500 })
  fireEvent.mouseMove(document, { clientX: to })
  fireEvent.mouseUp(document)
}

describe('the feature panel', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1000 } as DOMRect)
  })
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('opens at an even split beside the chat', () => {
    render(<Page />)
    expect(screen.getByText('the chat')).toBeTruthy()
    expect(panelWidth()).toBe('50%')
  })

  it('drags either side down to nothing, and no further', () => {
    render(<Page />)
    drag(800)
    expect(panelWidth()).toBe('20%')
    drag(1700)
    expect(panelWidth()).toBe('0%')
    drag(-900)
    expect(panelWidth()).toBe('100%')
  })

  it('toggles an even split and the panel full on double-click', () => {
    render(<Page />)
    drag(800)
    fireEvent.doubleClick(divider())
    expect(panelWidth()).toBe('100%')
    fireEvent.doubleClick(divider())
    expect(panelWidth()).toBe('50%')
  })

  it('folds to a strip and unfolds at the size it had', () => {
    render(<Page />)
    drag(700)
    fireEvent.click(screen.getByRole('button', { name: 'Fold the panel' }))
    expect(screen.queryByRole('separator')).toBeNull()
    expect(screen.queryByText('the body')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Unfold body' }))
    expect(panelWidth()).toBe('30%')
  })

  it('closes to the chat alone', () => {
    render(<Page />)
    fireEvent.click(screen.getByRole('button', { name: 'Close the panel' }))
    expect(screen.queryByText('the body')).toBeNull()
    expect(screen.getByText('the chat')).toBeTruthy()
  })

  it('remembers the size across a reload', () => {
    const first = render(<Page />)
    drag(800)
    first.unmount()
    render(<Page />)
    expect(panelWidth()).toBe('20%')
  })

  it('still opens and drags when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    render(<Page />)
    expect(panelWidth()).toBe('50%')
    drag(600)
    expect(panelWidth()).toBe('40%')
  })
})
