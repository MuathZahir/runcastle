// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestNote } from '@runcastle/core'
import { RailResizeHandle } from '../src/components/RailResizeHandle'
import {
  NOTES_RAIL_DEFAULT_W,
  NOTES_RAIL_MAX_W,
  NOTES_RAIL_MIN_W,
  clampNotesRailWidth,
  useNotesRailWidth,
} from '../src/lib/notes-rail-width'

/**
 * The notes rail's two behaviours a static string cannot show: the drag that
 * sizes it, and the jump that brings a row into view.
 *
 * Both are the rail's whole reason for existing. It is permanent (decision 2),
 * so its width is the one thing about it a human still chooses; and a spotlit
 * row has to arrive by scrolling the RAIL, because the failure the rail was
 * built to end is a note reached at the cost of the stage.
 */
vi.mock('../src/trpc', () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
  return {
    trpc: {
      useUtils: () => ({
        notes: { list: { invalidate: vi.fn() } },
        findings: { listByFeature: { invalidate: vi.fn() } },
      }),
      notes: {
        add: { useMutation: mutation },
        edit: { useMutation: mutation },
        remove: { useMutation: mutation },
        toggle: { useMutation: mutation },
        reopen: { useMutation: mutation },
      },
      findings: { dismiss: { useMutation: mutation }, reopen: { useMutation: mutation } },
    },
  }
})
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))

const { NotesRail } = await import('../src/components/review/NotesRail')
const { rowElementId } = await import('../src/components/review/NoteRow')

afterEach(cleanup)

/** The rail's drag handle, wired to the width state exactly as the rail wires it. */
function WidthHarness() {
  const { width, setWidth } = useNotesRailWidth()
  return (
    <>
      <span data-testid="width">{width}</span>
      <RailResizeHandle
        width={width}
        side="right"
        label="Resize the notes rail"
        clamp={clampNotesRailWidth}
        onResize={setWidth}
      />
    </>
  )
}

function drag(from: number, to: number): void {
  fireEvent.mouseDown(screen.getByRole('separator'), { clientX: from })
  fireEvent.mouseMove(document, { clientX: to })
  fireEvent.mouseUp(document)
}

const widthNow = () => Number(screen.getByTestId('width').textContent)

describe('the notes rail’s width', () => {
  beforeEach(() => localStorage.clear())

  it('starts at the default when nothing is stored', () => {
    render(<WidthHarness />)

    expect(widthNow()).toBe(NOTES_RAIL_DEFAULT_W)
  })

  /** The rail is on the RIGHT, so it widens as the pointer travels left. */
  it('widens leftward and narrows rightward, by how far the pointer moved', () => {
    render(<WidthHarness />)

    drag(900, 860)
    expect(widthNow()).toBe(NOTES_RAIL_DEFAULT_W + 40)

    drag(900, 950)
    expect(widthNow()).toBe(NOTES_RAIL_DEFAULT_W - 10)
  })

  it('clamps a drag past either end', () => {
    render(<WidthHarness />)

    drag(900, 2000)
    expect(widthNow()).toBe(NOTES_RAIL_MIN_W)

    drag(900, -2000)
    expect(widthNow()).toBe(NOTES_RAIL_MAX_W)
  })

  it('persists the width, and comes back at it', () => {
    const first = render(<WidthHarness />)
    drag(900, 800)
    expect(widthNow()).toBe(NOTES_RAIL_DEFAULT_W + 100)

    first.unmount()
    render(<WidthHarness />)

    expect(widthNow()).toBe(NOTES_RAIL_DEFAULT_W + 100)
  })
})

const NOTE: TestNote = {
  id: 'note_1',
  featureId: 'ftr_1',
  lap: 1,
  text: 'the gate chip wraps to two lines at the default rail width',
  status: 'open',
  author: 'human',
  createdAt: 10,
  updatedAt: 10,
} as TestNote

describe('the marker-to-note spotlight', () => {
  /** Every element the effect tried to scroll, and how. happy-dom lays nothing
   *  out and implements neither call, so both are recorded rather than run. */
  let scrolledBy: HTMLElement[]
  let scrolledIntoView: HTMLElement[]

  beforeEach(() => {
    scrolledBy = []
    scrolledIntoView = []
    HTMLElement.prototype.scrollBy = function scrollBy(this: HTMLElement) {
      scrolledBy.push(this)
    }
    HTMLElement.prototype.scrollIntoView = function scrollIntoView(this: HTMLElement) {
      scrolledIntoView.push(this)
    }
  })

  it('is the one aside: the Aside primitive, titled and closable', () => {
    render(
      <NotesRail
        featureId="ftr_1"
        lap={1}
        rows={[{ lap: 1, item: { kind: 'note', note: NOTE }, open: true }]}
        readonly={false}
        onStage={null}
        onClose={() => undefined}
      />,
    )
    expect(screen.getByRole('complementary')).toBeTruthy()
    expect(screen.getByText('Needs attention')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(screen.getByLabelText(/what did you just see/i)).toBeTruthy()
  })

  it('scrolls the rail’s own scroller, and never an ancestor of the stage', () => {
    render(
      <NotesRail
        featureId="ftr_1"
        lap={1}
        rows={[{ lap: 1, item: { kind: 'note', note: NOTE }, open: true }]}
        readonly={false}
        onStage={null}
        highlight={[NOTE.id]}
        scrollTo={NOTE.id}
        onClose={() => undefined}
      />,
    )

    const row = document.getElementById(rowElementId(NOTE.id))
    expect(row).not.toBeNull()
    // `scrollIntoView` walks every scrollable ancestor, which is how a note used
    // to take the page with it. Nothing calls it here.
    expect(scrolledIntoView).toEqual([])
    expect(scrolledBy).toHaveLength(1)
    const scroller = scrolledBy[0]!
    expect(scroller.className).toContain('overflow-y-auto')
    expect(scroller.contains(row)).toBe(true)
  })

  it('scrolls nothing at all when no row is spotlit', () => {
    render(
      <NotesRail
        featureId="ftr_1"
        lap={1}
        rows={[{ lap: 1, item: { kind: 'note', note: NOTE }, open: true }]}
        readonly={false}
        onStage={null}
        scrollTo={null}
        onClose={() => undefined}
      />,
    )

    expect(scrolledBy).toEqual([])
    expect(scrolledIntoView).toEqual([])
  })
})
