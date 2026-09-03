// @vitest-environment happy-dom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useHistorySync } from '../src/lib/use-history-sync'
import type { AppLocation } from '../src/lib/routes'

/**
 * Ticket 1 / decision 1 — the browser becomes a full citizen. Tier 2, because
 * none of this is visible in a rendered string: it is `pushState`, `popstate`
 * and the shape of the history stack. The path codec itself is tier 1
 * (`test/routes.test.ts`).
 */
describe('useHistorySync', () => {
  afterEach(cleanup)

  beforeEach(() => {
    window.history.replaceState(null, '', '/')
  })

  /** A location, an overlay, and a place to say what popstate handed back. */
  function Harness({ start = null }: { start?: AppLocation | null }) {
    const [location, setLocation] = useState<AppLocation | null>(start)
    // Stands in for the palette / Settings / DocPeek / Quick / the phase pin:
    // real UI state that is deliberately not addressable.
    const [overlay, setOverlay] = useState(false)
    const [popped, setPopped] = useState<string>('—')
    useHistorySync(location, (loc) => {
      setPopped(loc ? JSON.stringify(loc) : 'null')
      setLocation(loc)
    })
    return (
      <>
        <button onClick={() => setLocation({ kind: 'project', projectId: 'p1' })}>project</button>
        <button
          onClick={() => setLocation({ kind: 'feature', projectId: 'p1', featureSlug: 'alpha' })}
        >
          alpha
        </button>
        <button
          onClick={() => setLocation({ kind: 'feature', projectId: 'p1', featureSlug: 'beta' })}
        >
          beta
        </button>
        <button onClick={() => setOverlay((v) => !v)}>overlay</button>
        <span data-testid="overlay">{overlay ? 'open' : 'closed'}</span>
        <span data-testid="popped">{popped}</span>
      </>
    )
  }

  const go = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
  const path = () => window.location.pathname

  /** happy-dom's history has no real back stack, so a Back is simulated. */
  const back = (to: string) => {
    act(() => {
      window.history.replaceState(null, '', to)
      window.dispatchEvent(new Event('popstate'))
    })
  }

  it('normalizes the first location without adding a history entry', () => {
    const before = window.history.length
    render(<Harness start={{ kind: 'feature', projectId: 'p1', featureSlug: 'alpha' }} />)
    expect(path()).toBe('/p/p1/f/alpha')
    expect(window.history.length).toBe(before)
  })

  it('writes nothing at all while the location is still unknown', () => {
    render(<Harness />)
    expect(path()).toBe('/')
  })

  it('pushes an entry for every navigation after the first', () => {
    render(<Harness start={{ kind: 'project', projectId: 'p1' }} />)
    const afterNormalize = window.history.length

    go('alpha')
    expect(path()).toBe('/p/p1/f/alpha')
    go('beta')
    expect(path()).toBe('/p/p1/f/beta')
    expect(window.history.length).toBe(afterNormalize + 2)
  })

  it('drives the same setters on Back, and does not push the popped path again', () => {
    render(<Harness start={{ kind: 'project', projectId: 'p1' }} />)
    go('alpha')
    go('beta')
    const depth = window.history.length

    back('/p/p1/f/alpha')

    expect(screen.getByTestId('popped').textContent).toBe(
      JSON.stringify({ kind: 'feature', projectId: 'p1', featureSlug: 'alpha' }),
    )
    expect(path()).toBe('/p/p1/f/alpha')
    expect(window.history.length).toBe(depth)
  })

  it('hands a path the app does not own back as null rather than guessing', () => {
    render(<Harness start={{ kind: 'project', projectId: 'p1' }} />)
    back('/nonsense')
    expect(screen.getByTestId('popped').textContent).toBe('null')
  })

  it('never lets an overlay touch history — opening one is not going anywhere', () => {
    render(<Harness start={{ kind: 'feature', projectId: 'p1', featureSlug: 'alpha' }} />)
    const depth = window.history.length

    go('overlay')
    expect(screen.getByTestId('overlay').textContent).toBe('open')
    go('overlay')

    expect(window.history.length).toBe(depth)
    expect(path()).toBe('/p/p1/f/alpha')
  })

  it('stops listening once unmounted', () => {
    const { unmount } = render(<Harness start={{ kind: 'project', projectId: 'p1' }} />)
    unmount()
    // No act() warning and no crash: the listener is gone with the component.
    window.history.replaceState(null, '', '/p/p1/f/alpha')
    window.dispatchEvent(new Event('popstate'))
    expect(path()).toBe('/p/p1/f/alpha')
  })
})
