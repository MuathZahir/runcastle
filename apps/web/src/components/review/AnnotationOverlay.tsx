import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { fmtClock } from '@runcastle/core'
import type { ReactNode } from 'react'
import { Button, Dialog, DialogFooter, DialogHeader, IconButton, TextArea } from '../../ui'
import { IconArrowTool, IconPen, IconRect, IconRedo, IconTrash, IconUndo } from '../../icons'
import {
  beginShape,
  canSave,
  clear,
  commitShape,
  emptyAnnotation,
  extendShape,
  isDirty,
  redo,
  setText,
  setTool,
  undo,
  type AnnotationState,
  type Tool,
} from '../../lib/annotation'
import { captureAnnotation, framePoint, paintShapes, type Point } from '../../lib/walkthrough'

/**
 * The capture surface over a paused frame (decision 24).
 *
 * It is a sibling of the player rather than more of it, because the two answer
 * different questions: the player is transport, this is a drawing tool that
 * happens to be pointed at a video frame.
 *
 * The whole of the drawing state is `lib/annotation.ts`, reduced here and
 * painted from an effect. That is not tidiness — it is the fix for the walked
 * crash (decision 3): the old surface read `e.currentTarget` from *inside* a
 * lazily-run state updater, so React's second invocation of the updater saw a
 * pooled event whose target was gone and the second stroke on a frame took the
 * whole feature view to the error boundary. Pointer handlers here read the
 * canvas from a ref and hand the reducer a plain `Point`, so there is nothing
 * left for a re-run to lose.
 */

type Action =
  | { kind: 'begin'; point: Point }
  | { kind: 'extend'; point: Point }
  | { kind: 'commit' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'clear' }
  | { kind: 'tool'; tool: Tool }
  | { kind: 'text'; text: string }

function reduce(state: AnnotationState, action: Action): AnnotationState {
  switch (action.kind) {
    case 'begin':
      return beginShape(state, action.point)
    case 'extend':
      return extendShape(state, action.point)
    case 'commit':
      return commitShape(state)
    case 'undo':
      return undo(state)
    case 'redo':
      return redo(state)
    case 'clear':
      return clear(state)
    case 'tool':
      return setTool(state, action.tool)
    case 'text':
      return setText(state, action.text)
  }
}

const TOOLS: { tool: Tool; label: string; key: string; icon: ReactNode }[] = [
  { tool: 'pen', label: 'Pen', key: 'P', icon: <IconPen /> },
  { tool: 'arrow', label: 'Arrow', key: 'A', icon: <IconArrowTool /> },
  { tool: 'rect', label: 'Rect', key: 'R', icon: <IconRect /> },
]

/** The floating toolbar's ground: a raised surface, as anything that floats is. */
const FLOAT = 'pointer-events-auto flex items-center gap-0.5 rounded-lg bg-surface-raised p-1 shadow-popover'

/** The tool a bare letter selects, so the overlay's keys live in one place. */
const TOOL_KEYS: Record<string, Tool> = { p: 'pen', a: 'arrow', r: 'rect' }

export function AnnotationOverlay({
  video,
  timestamp,
  onSave,
  onCancel,
}: {
  /** The paused element the frame is read from at save. */
  video: HTMLVideoElement
  /** Where in the recording this frame sits, for the note it becomes. */
  timestamp: number
  /** Bake done: the composited PNG and whatever was typed with it. */
  onSave: (png: Blob, text: string) => void | Promise<void>
  onCancel: () => void
}) {
  const [state, dispatch] = useReducer(reduce, undefined, () => emptyAnnotation())
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Whether the pointer that went down is still drawing. A ref, not state: the
  // move handler reads it on every frame and changing it must not re-render.
  const drawing = useRef(false)

  /**
   * Intrinsic frame pixels per on-screen pixel. Strokes are recorded and baked
   * at the recording's own resolution, so a 6px pen has to be multiplied up by
   * this to *look* like 6px on a player laid out smaller than the recording.
   */
  const paintScale = (canvas: HTMLCanvasElement): number => {
    const rect = canvas.getBoundingClientRect()
    return rect.width > 0 ? canvas.width / rect.width : 1
  }

  // The canvas is a rendering of `state.shapes` and never the record, which is
  // what makes undo, redo and clear one dispatch each.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    paintShapes(ctx, state.shapes, paintScale(canvas))
  }, [state.shapes, video])

  const pointIn = (e: ReactPointerEvent<HTMLCanvasElement>): Point | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    return framePoint(
      canvas.getBoundingClientRect(),
      { width: canvas.width, height: canvas.height },
      { x: e.clientX, y: e.clientY },
    )
  }

  const startShape = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const point = pointIn(e)
    if (!point) return
    canvasRef.current?.setPointerCapture?.(e.pointerId)
    drawing.current = true
    dispatch({ kind: 'begin', point })
  }

  // Capture means the pointer may leave the frame mid-shape and come back, so
  // only the newest shape ever grows.
  const growShape = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!drawing.current) return
    const point = pointIn(e)
    if (point) dispatch({ kind: 'extend', point })
  }

  const endShape = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!drawing.current) return
    drawing.current = false
    const canvas = canvasRef.current
    if (canvas?.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    dispatch({ kind: 'commit' })
  }

  const dismiss = (): void => {
    if (isDirty(state)) setConfirming(true)
    else onCancel()
  }

  const save = async (): Promise<void> => {
    const canvas = canvasRef.current
    if (!canSave(state) || busy || !canvas) return
    setBusy(true)
    setFailed(null)
    try {
      const png = await captureAnnotation(
        document.createElement('canvas'),
        video,
        state.shapes,
        paintScale(canvas),
      )
      await onSave(png, state.text.trim())
    } catch (e) {
      // The overlay stays open on a failure: the shapes live only here, so
      // closing would throw away what the human just drew.
      setFailed(e instanceof Error ? e.message : 'the annotated frame could not be saved')
    } finally {
      setBusy(false)
    }
  }

  // Escape answers wherever the focus is, the textarea included — the walked bug
  // was Escape bound inside the note field, which discarded a drawing silently.
  // The tool letters stay out of the way of typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (confirming) setConfirming(false)
        else dismiss()
        return
      }
      const target = e.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      const tool = TOOL_KEYS[e.key.toLowerCase()]
      if (tool) {
        e.preventDefault()
        dispatch({ kind: 'tool', tool })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirming, state, onCancel])

  return (
    <div className="absolute inset-0 z-20" data-testid="annotation-overlay">
      <canvas
        ref={canvasRef}
        aria-label="draw on this frame"
        className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
        onPointerDown={startShape}
        onPointerMove={growShape}
        onPointerUp={endShape}
        onPointerCancel={endShape}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-center gap-2 p-3 animate-fade-in">
        <div className={FLOAT}>
          {/* The selected tool is its pressed state, not a coloured fill. */}
          {TOOLS.map(({ tool, label, key, icon }) => (
            <IconButton
              key={tool}
              label={label}
              kbd={key}
              icon={icon}
              active={state.tool === tool}
              tooltipSide="bottom"
              onClick={() => dispatch({ kind: 'tool', tool })}
            />
          ))}
          <span aria-hidden className="mx-1 h-4 w-px bg-border" />
          <IconButton
            label="Undo"
            icon={<IconUndo />}
            tooltipSide="bottom"
            disabled={state.shapes.length === 0}
            onClick={() => dispatch({ kind: 'undo' })}
          />
          <IconButton
            label="Redo"
            icon={<IconRedo />}
            tooltipSide="bottom"
            disabled={state.redo.length === 0}
            onClick={() => dispatch({ kind: 'redo' })}
          />
          <IconButton
            label="Clear"
            icon={<IconTrash />}
            tooltipSide="bottom"
            disabled={state.shapes.length === 0}
            onClick={() => dispatch({ kind: 'clear' })}
          />
        </div>
        <span className="pointer-events-none rounded-md bg-surface-raised px-2 py-1 font-mono text-xs text-text-secondary tabular-nums shadow-popover">
          {fmtClock(timestamp)}
        </span>
      </div>

      <div className="absolute inset-x-3 bottom-3 flex flex-col gap-2 rounded-lg bg-surface-raised p-2 shadow-popover animate-rise-in">
        {failed && (
          <p className="m-0 px-1 text-sm text-danger" role="alert">
            {failed}
          </p>
        )}
        <div className="flex items-end gap-2">
          <TextArea
            rows={2}
            aria-label="what’s wrong in this frame?"
            className="min-w-0 flex-1 resize-none"
            placeholder="What’s wrong in this frame? A drawing alone saves too."
            value={state.text}
            autoFocus
            onChange={(e) => dispatch({ kind: 'text', text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey) return
              e.preventDefault()
              void save()
            }}
          />
          <Button variant="ghost" onClick={dismiss}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!canSave(state)} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save note'}
          </Button>
        </div>
      </div>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        size="sm"
        label="Discard this annotation?"
      >
        <DialogHeader title="Discard this annotation?" description="The drawing and the words go with it." />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Keep editing
          </Button>
          <Button variant="danger" onClick={onCancel}>
            Discard
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
