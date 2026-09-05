// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnnotationOverlay } from '../src/components/review/AnnotationOverlay'

/**
 * The capture surface (decision 24), tier 2 because none of it is visible in a
 * rendered string: the shapes only exist as pointer events reduced into the
 * model, the save gate is a button's disabled state, and the discard question is
 * a portalled dialog.
 *
 * The canvas is the one true system boundary here and is the only thing stubbed
 * — what `onSave` is HANDED is the assertion, never rasterised pixels
 * (decision 36).
 */

/** What was drawn, in order — a 2d context's only observable. */
function fakeContext() {
  const ops: string[] = []
  return {
    ops,
    ctx: {
      set lineWidth(_v: number) {},
      lineCap: '',
      lineJoin: '',
      set strokeStyle(_v: string) {},
      clearRect: () => ops.push('clear'),
      drawImage: () => ops.push('drawImage'),
      beginPath: () => ops.push('beginPath'),
      moveTo: (x: number, y: number) => ops.push(`moveTo(${x},${y})`),
      lineTo: (x: number, y: number) => ops.push(`lineTo(${x},${y})`),
      rect: () => ops.push('rect'),
      stroke: () => ops.push('stroke'),
    } as unknown as CanvasRenderingContext2D,
  }
}

const PNG = new Blob([new Uint8Array([1])], { type: 'image/png' })

/** The recording's frame: 1920×1080, rendered 960 wide, so the scale is 2. */
function fakeVideo(): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperty(video, 'videoWidth', { value: 1920 })
  Object.defineProperty(video, 'videoHeight', { value: 1080 })
  return video
}

let drawn: string[] = []

beforeEach(() => {
  const { ctx, ops } = fakeContext()
  drawn = ops
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) {
    ;(cb as (b: Blob | null) => void)(PNG)
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 960,
    height: 540,
  } as DOMRect)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function mount(
  overrides: { onSave?: (png: Blob, text: string) => Promise<void>; onCancel?: () => void } = {},
) {
  const onSave = vi.fn(overrides.onSave ?? (async () => undefined))
  const onCancel = vi.fn(overrides.onCancel ?? (() => undefined))
  render(<AnnotationOverlay video={fakeVideo()} timestamp={42} onSave={onSave} onCancel={onCancel} />)
  return { onSave, onCancel }
}

const canvas = (): HTMLCanvasElement => screen.getByLabelText('draw on this frame') as HTMLCanvasElement
const save = (): HTMLButtonElement => screen.getByRole('button', { name: /save note/i }) as HTMLButtonElement

/** One gesture: down, a couple of moves, up. */
function draw(from = 10, to = 40): void {
  const surface = canvas()
  fireEvent.pointerDown(surface, { clientX: from, clientY: from, pointerId: 1 })
  fireEvent.pointerMove(surface, { clientX: to, clientY: to, pointerId: 1 })
  fireEvent.pointerUp(surface, { clientX: to, clientY: to, pointerId: 1 })
}

describe('AnnotationOverlay', () => {
  // Decision 3's walked crash: the second stroke on a frame took the whole
  // feature view to the error boundary. Ten in a row is the regression.
  it('survives shape after shape after shape', () => {
    mount()
    for (let i = 0; i < 10; i++) draw(i * 5, i * 5 + 20)

    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false)
    expect(save().disabled).toBe(false)
    // Ten shapes, each its own path on the last repaint.
    const lastRepaint = drawn.lastIndexOf('clear')
    expect(drawn.slice(lastRepaint).filter((op) => op === 'beginPath')).toHaveLength(10)
  })

  // The canvas is sized to the recording (1920) and laid out at 960, so a click
  // at 10 CSS px is a stroke at frame pixel 20 — full quality however small the
  // player is rendered.
  it('records a gesture in the frame’s own pixels', () => {
    mount()
    draw(10, 40)

    expect(drawn.slice(drawn.lastIndexOf('clear'))).toEqual([
      'clear',
      'beginPath',
      'moveTo(20,20)',
      'lineTo(80,80)',
      'stroke',
    ])
  })

  it('switches tools by click and by letter', () => {
    mount()
    const rect = screen.getByRole('button', { name: /rect/i })

    fireEvent.click(screen.getByRole('button', { name: /arrow/i }))
    expect(screen.getByRole('button', { name: /arrow/i }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.keyDown(document.body, { key: 'r' })
    expect(rect.getAttribute('aria-pressed')).toBe('true')
  })

  it('undoes and redoes a shape', () => {
    mount()
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(save().disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(save().disabled).toBe(false)
  })

  // Decision 24c: the save gate flipped — a drawing alone is enough, text alone
  // is still legal, and only an empty overlay cannot be saved.
  it('saves on a drawing alone, with no text', async () => {
    const { onSave } = mount()
    expect(save().disabled).toBe(true)

    draw()
    expect(save().disabled).toBe(false)
    await act(async () => void fireEvent.click(save()))

    expect(onSave).toHaveBeenCalledWith(PNG, '')
  })

  it('saves on text alone, with nothing drawn', async () => {
    const { onSave } = mount()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'the header jumps' } })
    await act(async () => void fireEvent.click(save()))

    expect(onSave).toHaveBeenCalledWith(PNG, 'the header jumps')
  })

  it('takes Enter as save and Shift+Enter as a newline', async () => {
    const { onSave } = mount()
    const note = screen.getByRole('textbox')
    fireEvent.change(note, { target: { value: 'first line' } })

    fireEvent.keyDown(note, { key: 'Enter', shiftKey: true })
    expect(onSave).not.toHaveBeenCalled()

    await act(async () => void fireEvent.keyDown(note, { key: 'Enter' }))
    expect(onSave).toHaveBeenCalledWith(PNG, 'first line')
  })

  it('closes silently when nothing has been drawn or typed', () => {
    const { onCancel } = mount()
    fireEvent.keyDown(document.body, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks before discarding a drawing', () => {
    const { onCancel } = mount()
    draw()

    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog').textContent).toContain('Discard this annotation?')

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('keeps the annotation when the discard question is declined', () => {
    const { onCancel } = mount()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'typed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(onCancel).not.toHaveBeenCalled()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('typed')
  })

  // The strokes live only here, so a failed save must not close over them.
  it('stays open and says why when the save fails', async () => {
    mount({
      onSave: async () => {
        throw new Error('notes.add refused')
      },
    })
    draw()
    await act(async () => void fireEvent.click(save()))

    expect(screen.getByRole('alert').textContent).toContain('notes.add refused')
    expect(save().disabled).toBe(false)
  })
})
