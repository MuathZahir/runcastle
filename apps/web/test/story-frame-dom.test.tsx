// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StoryFrame } from '../src/components/review/StoryFrame'
import { setThemePreference } from '../src/lib/theme'
import { MAP_FRAME } from './fixtures'

/**
 * StoryFrame's page variant (the map shows every page and its states,
 * decisions 6 and 9), tier 2: a whole page drawn at 1440 × 900 and scaled to
 * the frame's width, mounting only once it scrolls into view, at most three
 * loading at once, in runcastle's theme, and opening larger from a click. The
 * browser's observers are the boundary: the test says when a frame is in view
 * and how wide it is.
 */

type Observed = { cb: (entries: unknown[]) => void; el: Element[] }
const intersections = new Set<Observed>()
const resizes = new Set<Observed>()

function observer(registry: Set<Observed>) {
  return class {
    private entry: Observed
    constructor(cb: (entries: unknown[]) => void) {
      this.entry = { cb, el: [] }
      registry.add(this.entry)
    }
    observe(el: Element) {
      this.entry.el.push(el)
    }
    disconnect() {
      registry.delete(this.entry)
    }
  }
}

function scrollIntoView(): void {
  act(() => {
    for (const { cb, el } of [...intersections]) cb(el.map((target) => ({ target, isIntersecting: true })))
  })
}

function resizeTo(width: number): void {
  act(() => {
    for (const { cb, el } of [...resizes]) cb(el.map((target) => ({ target, contentRect: { width } })))
  })
}

const frames = (): HTMLIFrameElement[] => [...document.querySelectorAll('iframe')]

function pages(n: number, onOpen = vi.fn()) {
  render(
    <>
      {Array.from({ length: n }, (_, i) => (
        <StoryFrame key={i} page frameTitle={`State ${i}`} url={`${MAP_FRAME}state-${i}`} onOpen={onOpen} />
      ))}
    </>,
  )
  return onOpen
}

beforeEach(() => {
  ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = observer(intersections)
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = observer(resizes)
})
afterEach(() => {
  cleanup()
  intersections.clear()
  resizes.clear()
  setThemePreference('dark')
})

describe('a page frame', () => {
  it('holds a 16:10 placeholder until it scrolls into view', () => {
    pages(1)
    expect(frames()).toHaveLength(0)
    const box = document.querySelector('[data-page-frame]')
    expect(box?.className).toContain('aspect-[16/10]')
    expect(box?.querySelector('[data-frame-placeholder]')).toBeTruthy()
    scrollIntoView()
    expect(frames()).toHaveLength(1)
  })

  it('draws the page at 1440 × 900, scaled to the frame’s width, taking no pointer', () => {
    pages(1)
    scrollIntoView()
    resizeTo(720)
    const frame = frames()[0]
    expect(frame?.style.width).toBe('1440px')
    expect(frame?.style.height).toBe('900px')
    expect(frame?.style.transform).toBe('scale(0.5)')
    expect(frame?.className).toContain('pointer-events-none')
    resizeTo(1080)
    expect(frame?.style.transform).toBe('scale(0.75)')
  })

  it('passes runcastle’s theme to the catalogue as its globals', () => {
    pages(1)
    scrollIntoView()
    expect(frames()[0]?.getAttribute('src')).toBe(`${MAP_FRAME}state-0?globals=theme:dark`)
    act(() => setThemePreference('light'))
    expect(frames()[0]?.getAttribute('src')).toBe(`${MAP_FRAME}state-0?globals=theme:light`)
  })

  it('adds the theme after a query that is already there', () => {
    render(<StoryFrame page frameTitle="Review" url={`${MAP_FRAME}iframe.html?id=x&viewMode=story`} onOpen={vi.fn()} />)
    scrollIntoView()
    expect(frames()[0]?.getAttribute('src')).toBe(`${MAP_FRAME}iframe.html?id=x&viewMode=story&globals=theme:dark`)
  })

  it('opens from a click anywhere on it', () => {
    const onOpen = pages(1)
    fireEvent.click(screen.getByRole('button', { name: 'Open State 0 larger' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})

describe('page frames in view together', () => {
  it('load at most three at once, the next starting as one finishes loading', () => {
    pages(5)
    scrollIntoView()
    expect(frames().map((f) => f.title)).toEqual(['State 0', 'State 1', 'State 2'])

    fireEvent.load(frames()[1] as HTMLIFrameElement)
    expect(frames().map((f) => f.title)).toEqual(['State 0', 'State 1', 'State 2', 'State 3'])

    // A frame that has loaded already holds no turn: loading it again frees nothing.
    fireEvent.load(frames()[1] as HTMLIFrameElement)
    expect(frames()).toHaveLength(4)

    fireEvent.load(frames()[0] as HTMLIFrameElement)
    expect(frames()).toHaveLength(5)
  })

  it('give their turns back when they go away', () => {
    pages(3)
    scrollIntoView()
    cleanup()
    pages(3)
    scrollIntoView()
    expect(frames()).toHaveLength(3)
  })
})
