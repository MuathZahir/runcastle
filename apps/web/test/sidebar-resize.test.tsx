// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SidebarResizeHandle } from '../src/components/Sidebar'
import {
  SIDEBAR_DEFAULT_W,
  SIDEBAR_MAX_W,
  SIDEBAR_MIN_W,
  readSidebarWidth,
  useSidebarWidth,
} from '../src/lib/sidebar-width'

/**
 * The rail's drag handle (decision 10). Tier-2 because the whole behaviour is
 * events on `document` — a static string cannot show a drag.
 *
 * The seam under test is the pair the shell wires together: `useSidebarWidth`
 * holds and persists the width, the handle turns pointer movement into new
 * widths. happy-dom reports every element as 0×0, which is exactly why the drag
 * is measured as a delta from where it started rather than from the rail's edge.
 */
function Harness() {
  const { width, setWidth } = useSidebarWidth()
  return (
    <>
      <span data-testid="width">{width}</span>
      <SidebarResizeHandle width={width} onResize={setWidth} />
    </>
  )
}

function drag(from: number, to: number): void {
  fireEvent.mouseDown(screen.getByRole('separator'), { clientX: from })
  fireEvent.mouseMove(document, { clientX: to })
  fireEvent.mouseUp(document)
}

const widthNow = () => Number(screen.getByTestId('width').textContent)

describe('sidebar resize handle', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

  it('starts at the default width when nothing is stored', () => {
    render(<Harness />)

    expect(widthNow()).toBe(SIDEBAR_DEFAULT_W)
  })

  it('resizes by how far the pointer moved, not where it landed', () => {
    render(<Harness />)

    drag(600, 640)

    expect(widthNow()).toBe(SIDEBAR_DEFAULT_W + 40)
  })

  it('clamps a drag past either end', () => {
    render(<Harness />)

    drag(0, 5000)
    expect(widthNow()).toBe(SIDEBAR_MAX_W)

    drag(0, -5000)
    expect(widthNow()).toBe(SIDEBAR_MIN_W)
  })

  it('stops following the pointer once the drag is released', () => {
    render(<Harness />)

    drag(0, 40)
    fireEvent.mouseMove(document, { clientX: 400 })

    expect(widthNow()).toBe(SIDEBAR_DEFAULT_W + 40)
  })

  it('persists the width globally, and restores it on the next mount', () => {
    render(<Harness />)
    drag(0, 60)
    cleanup()

    expect(readSidebarWidth()).toBe(SIDEBAR_DEFAULT_W + 60)
    render(<Harness />)
    expect(widthNow()).toBe(SIDEBAR_DEFAULT_W + 60)
  })

  it('reads a stored width from outside the clamp back inside it', () => {
    localStorage.setItem('runcastle.sidebar.w', '9000')

    expect(readSidebarWidth()).toBe(SIDEBAR_MAX_W)
  })

  it('releases the text-selection block when the drag ends', () => {
    render(<Harness />)

    fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 0 })
    expect(document.body.style.userSelect).toBe('none')

    fireEvent.mouseUp(document)
    expect(document.body.style.userSelect).toBe('')
  })
})
