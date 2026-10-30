// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureView } from '../src/lib/routes'
import { FeaturePanel, PanelSplit, PanelStrip, usePanel } from '../src/components/workspace/FeaturePanel'

/**
 * The panel's behaviour a static string cannot show (design-mode decision 5):
 * the divider's drag and double-click, the fold, and the size surviving a
 * reload and a storage that throws.
 */
function Page({ start = 'work' as FeatureView }) {
  const [view, setView] = useState<FeatureView>(start)
  const panel = usePanel(view === 'chat' ? null : view, setView)
  const shown = panel.state.view
  return (
    <PanelSplit
      chat={
        <div>
          the chat
          {/* The address bar, history: the shell changing the view without the panel. */}
          <button type="button" onClick={() => setView('details')}>Go to details</button>
          <button type="button" onClick={() => setView('work')}>Go to work</button>
        </div>
      }
      panel={
        shown && (
          <FeaturePanel
            view={shown}
            views={['work', 'details']}
            label={(v) => v}
            onSwitch={(v) => panel.dispatch({ type: 'switch', view: v })}
            onCollapse={() => panel.dispatch({ type: 'collapse' })}
            onClose={() => panel.dispatch({ type: 'close' })}
          >
            the body
            {panel.state.doc ? (
              <p>reading {panel.state.doc}</p>
            ) : (
              <button type="button" onClick={() => panel.dispatch({ type: 'openDoc', doc: 'spec.md' })}>
                Read the spec
              </button>
            )}
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

  it('switches views by tabs naming every offered view, each with its icon (decision 3)', () => {
    render(<Page />)
    const tabs = within(screen.getByRole('tablist', { name: 'Panel views' })).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['work', 'details'])
    expect(tabs.every((tab) => tab.querySelector('svg'))).toBe(true)
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'details' }))
    expect(screen.getByRole('tab', { name: 'details' }).getAttribute('aria-selected')).toBe('true')
  })

  it('names a tab whose word a narrow panel hides in a tooltip, the word still its accessible name', async () => {
    render(<Page />)
    const details = screen.getByRole('tab', { name: 'details' })
    fireEvent.focus(details)
    expect((await screen.findByRole('tooltip')).textContent).toBe('details')
  })

  it('reads a doc in the view it was opened in, and leaves it behind when the shell shows another', () => {
    render(<Page />)
    fireEvent.click(screen.getByRole('button', { name: 'Read the spec' }))
    expect(screen.getByText('reading spec.md')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Go to details' }))
    fireEvent.click(screen.getByRole('button', { name: 'Go to work' }))
    expect(screen.queryByText('reading spec.md')).toBeNull()
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
