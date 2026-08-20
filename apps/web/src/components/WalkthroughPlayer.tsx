import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { fmtClock } from '@runcastle/core'
import { Button } from '../ui'
import { trpc } from '../trpc'
import { uploadScreenshot } from '../lib/reviews'
import { useToast } from '../lib/toast'
import {
  captureAnnotation,
  framePoint,
  paintStrokes,
  playableDuration,
  saveAnnotatedNote,
  type Point,
  type Stroke,
} from '../lib/walkthrough'

/**
 * The walkthrough player and its annotation surface (video-annotation
 * decisions #6).
 *
 * The native `<video controls>` is gone, and not for looks: the browser's own
 * bar sits across the bottom of the frame — exactly where a human draws — and
 * swallows the pointer events an overlay needs. What replaces it is the minimum
 * a silent screencast wants: play/pause, a scrub bar, and where you are in it.
 * `preload="metadata"` stays as it was: a walkthrough is evidence to reach for,
 * not something to fetch in full every time the review screen opens.
 *
 * Annotating is offered only on a paused frame, and while it is on, play and
 * scrub are dead: a frame that moves under a drawing would leave the strokes
 * pointing at nothing. The overlay canvas is sized to the recording's INTRINSIC
 * resolution and scaled down by CSS, so what is captured is full quality however
 * small the player happens to be laid out.
 *
 * Saving is two steps ({@link saveAnnotatedNote}) and produces an ordinary test
 * note: it lands in the list below with the same lifecycle as one typed by hand,
 * carrying the moment it was taken from and a thumbnail of the frame.
 */
/** Why Annotate is greyed out, said on hover rather than left to be guessed. */
function annotateHint(playing: boolean, ready: boolean): string | undefined {
  if (playing) return 'pause on the frame you want to draw on'
  if (!ready) return 'the recording has not loaded a frame to draw on yet'
  return undefined
}

export function WalkthroughPlayer({
  url,
  featureId,
  readonly,
}: {
  url: string
  featureId: string
  /** Looking back at a shipped feature — the recording plays, nothing is captured. */
  readonly: boolean
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)

  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)
  const [span, setSpan] = useState(0)
  // Whether there is a decoded frame to draw on and to capture. Metadata-only
  // preloading has the dimensions long before it has pixels, and `drawImage` of
  // a video with no current frame silently draws NOTHING — so annotating before
  // this is true would bake a blank PNG.
  const [ready, setReady] = useState(false)
  const [annotating, setAnnotating] = useState(false)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  // Whether the pointer that went down on the canvas is still drawing. A ref, not
  // state: it is read inside the move handler and changing it must never re-render.
  const drawing = useRef(false)

  const add = trpc.notes.add.useMutation({ onError: (e) => toast.push(e.message) })

  // Repaint the overlay from the stroke list — the list is the record, the canvas
  // only ever a rendering of it, which is what makes undo and clear one-liners.
  // Sizing lives here too: the canvas mounts with the annotation, by which point
  // the video's intrinsic dimensions are known.
  useEffect(() => {
    const canvas = overlayRef.current
    const video = videoRef.current
    if (!canvas || !video) return

    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    paintStrokes(ctx, strokes)
  }, [strokes, annotating])

  const togglePlay = (): void => {
    const video = videoRef.current
    if (!video || annotating) return
    if (video.paused) {
      void video.play().catch(() => toast.push('the browser refused to play this recording'))
    } else {
      video.pause()
    }
  }

  const seek = (seconds: number): void => {
    const video = videoRef.current
    if (!video || annotating) return
    video.currentTime = seconds
    setAt(seconds)
  }

  const startAnnotating = (): void => {
    videoRef.current?.pause()
    setStrokes([])
    setText('')
    setAnnotating(true)
  }

  const stopAnnotating = (): void => {
    setAnnotating(false)
    setStrokes([])
    setText('')
  }

  const pointIn = (e: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const canvas = e.currentTarget
    return framePoint(
      canvas.getBoundingClientRect(),
      { width: canvas.width, height: canvas.height },
      { x: e.clientX, y: e.clientY },
    )
  }

  const startStroke = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    setStrokes((s) => [...s, [pointIn(e)]])
  }

  // Capture means the pointer can leave the frame mid-stroke and come back, so
  // only the newest stroke ever grows.
  const extendStroke = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!drawing.current) return
    const point = pointIn(e)
    setStrokes((s) => s.map((stroke, i) => (i === s.length - 1 ? [...stroke, point] : stroke)))
  }

  const endStroke = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    drawing.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const save = async (): Promise<void> => {
    const video = videoRef.current
    const body = text.trim()
    if (!video || !body || saving) return
    setSaving(true)

    let png: Blob
    try {
      png = await captureAnnotation(document.createElement('canvas'), video, strokes)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'the annotated frame could not be captured')
      setSaving(false)
      return
    }

    try {
      const saved = await saveAnnotatedNote({
        createNote: () =>
          add.mutateAsync({ featureId, text: body, videoTimestamp: video.currentTime }),
        uploadScreenshot: (noteId) => uploadScreenshot(noteId, png),
      })
      // The upload emits a note event, and the stream invalidates this key on it
      // — asking here as well is what keeps the thumbnail from depending on the
      // stream being up at the moment of the save.
      void utils.notes.list.invalidate({ featureId })
      if (saved.uploadError) {
        toast.push(`the note was saved, but its annotated frame was not: ${saved.uploadError}`)
      }
      stopAnnotating()
    } catch {
      // `notes.add` failed and has already said why. The overlay stays open: the
      // strokes live only in this component, so closing would throw them away.
    } finally {
      setSaving(false)
    }
  }

  const scrubbable = span > 0 && !annotating

  return (
    <div className="walkthrough-player">
      <div className="player-stage">
        <video
          ref={videoRef}
          className="walkthrough-video"
          src={url}
          preload="metadata"
          onLoadedMetadata={(e) => setSpan(playableDuration(e.currentTarget))}
          onDurationChange={(e) => setSpan(playableDuration(e.currentTarget))}
          onProgress={(e) => setSpan(playableDuration(e.currentTarget))}
          onLoadedData={() => setReady(true)}
          onCanPlay={() => setReady(true)}
          onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
        {annotating && (
          <canvas
            ref={overlayRef}
            className="player-canvas"
            onPointerDown={startStroke}
            onPointerMove={extendStroke}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
          />
        )}
      </div>

      <div className="player-bar">
        <button
          type="button"
          className="btn btn-xs btn-ghost player-play"
          disabled={annotating}
          aria-label={playing ? 'pause' : 'play'}
          onClick={togglePlay}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <input
          type="range"
          className="player-scrub"
          min={0}
          max={span || 1}
          step={0.05}
          value={Math.min(at, span || 1)}
          disabled={!scrubbable}
          aria-label="scrub the walkthrough"
          onChange={(e) => seek(Number(e.target.value))}
        />
        <span className="player-clock mono">
          {fmtClock(at)} / {fmtClock(span)}
        </span>
        {!readonly && !annotating && (
          <Button
            variant="ghost"
            className="player-annotate"
            disabled={playing || !ready}
            title={annotateHint(playing, ready)}
            onClick={startAnnotating}
          >
            Annotate
          </Button>
        )}
      </div>

      {annotating && (
        <>
          <div className="annotate-bar">
            <input
              className="notes-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save()
                if (e.key === 'Escape') stopAnnotating()
              }}
              placeholder="What’s wrong in this frame?"
              autoFocus
            />
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              disabled={strokes.length === 0}
              onClick={() => setStrokes((s) => s.slice(0, -1))}
            >
              Undo
            </button>
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              disabled={strokes.length === 0}
              onClick={() => setStrokes([])}
            >
              Clear
            </button>
            <Button variant="ghost" disabled={!text.trim() || saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save note'}
            </Button>
            <button type="button" className="btn btn-xs btn-ghost" onClick={stopAnnotating}>
              Cancel
            </button>
          </div>
          <div className="notes-hint">
            Draw on the frame, then say what you saw — it lands in the notes below as an ordinary
            note, carrying this moment ({fmtClock(at)}) and a picture of it.
          </div>
        </>
      )}
    </div>
  )
}
