import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { fmtClock } from '@runcastle/core'
import { Button, IconButton, Spinner } from '../ui'
import { IconPencil, IconPlay, IconRefresh } from '../icons'
import { IconPause } from './review/stage-icons'
import { trpc } from '../trpc'
import { uploadScreenshot } from '../lib/reviews'
import { fmtBytes } from '../lib/format'
import { useToast } from '../lib/toast'
import { AnnotationOverlay } from './review/AnnotationOverlay'
import { playableDuration, saveAnnotatedNote, seekTarget } from '../lib/walkthrough'
import { isTyping, useStageExpandKeys, type StageExpand } from '../lib/stage-expand'

/**
 * What the page outside this player can do to the recording on stage
 * (decision 25b): a note row seeks to its own moment, the triage step pauses
 * what is playing behind it, and both first ask which recording this *is* —
 * a timestamp only ever seeks the recording it was taken against (decision 22).
 *
 * Published into a ref the parent holds, and taken back down on unmount: a
 * handle left behind would be a click into a video element that no longer
 * exists.
 */
export interface WalkthroughHandle {
  seek: (seconds: number) => void
  pause: () => void
  getTicketId: () => string
}

/** One scrub-bar dot: a moment, and the notes that were taken at it. */
export interface WalkthroughMarker {
  at: number
  noteIds: string[]
}

/**
 * Playback speeds, and the one a walkthrough opens at (decision 23a). 1.5× is
 * the default because these recordings are an AI driving a browser: every click
 * is preceded by a think, and 1× is slower than anyone watches them.
 */
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const DEFAULT_SPEED = 1.5

/** Five seconds is the jump; a thirtieth is a frame at the recorder's rate. */
const JUMP_SECONDS = 5
const FRAME_SECONDS = 1 / 30

/** Wraps at both ends, so the on-screen `1.5×` control alone reaches them all. */
function cycleSpeed(current: number, delta: number): number {
  const index = SPEEDS.indexOf(current)
  const from = index === -1 ? SPEEDS.indexOf(DEFAULT_SPEED) : index
  return SPEEDS[(from + delta + SPEEDS.length) % SPEEDS.length]!
}

/**
 * The walkthrough player (decisions 23–24).
 *
 * The native `<video controls>` is gone, and not for looks: the browser's own
 * bar sits across the bottom of the frame — exactly where a human draws — and
 * swallows the pointer events an overlay needs. What replaces it is sized for
 * this recording's actual job (an agent's browser tour, watched fast and paused
 * on the exact frame of a defect): keyboard-first transport, frame-stepping,
 * a speed control, and note markers on the scrub bar so the video indexes its
 * own notes.
 *
 * The two states the walked player had no vocabulary for are explicit here. A
 * 20-minute recording still loading and a corrupt file rendered identically —
 * as a dead card — for as long as they took, so loading says it is loading and
 * how big the file is, and a decode error says the recording cannot be played
 * and offers a retry.
 *
 * Drawing lives in {@link AnnotationOverlay}, a sibling rather than more of this
 * component; the Annotate button is never disabled, because a control that is
 * greyed out with a tooltip is the pattern this redesign removes — clicking it
 * while the recording plays pauses on the frame and opens the overlay in one
 * act.
 */
export function WalkthroughPlayer({
  url,
  featureId,
  ticketId,
  passKind,
  readonly,
  frameClassName,
  expand,
  markers = [],
  onMarkerClick,
  onAnnotationSaved,
  onDuration,
  handleRef,
}: {
  url: string
  featureId: string
  /** The review ticket whose pass recorded this — what a note binds itself to. */
  ticketId: string
  /** Whether this recording is a first review or a verification pass. */
  passKind: 'review' | 'verification'
  /** Looking back at a shipped feature — the recording plays, nothing is captured. */
  readonly: boolean
  /**
   * The box the frame sits in, sized by the stage above (collapsed 16:9, or the
   * flex fill of the expanded overlay) — one class string for both sides of the
   * swap, so the expanded sizing exists once rather than once per player.
   */
  frameClassName: string
  /**
   * The stage's expand, which this player's F key now toggles. Absent where the
   * page has nowhere to expand into (the shipped record), and then F does
   * nothing rather than something else.
   */
  expand?: StageExpand
  /** Clustered note moments for THIS recording ({@link clusterMarkers}). */
  markers?: readonly WalkthroughMarker[]
  onMarkerClick?: (noteIds: string[]) => void
  /** A note has just been captured, so the list below can scroll to it. */
  onAnnotationSaved?: (noteId: string) => void
  /**
   * How long the recording turns out to be, as soon as the element can say —
   * the stage header above puts it in the identity line (`Walkthrough · 12:34`),
   * and only the element knows it (decision 41b). Fires again as a live
   * recorder's WebM reveals more of itself.
   */
  onDuration?: (seconds: number) => void
  /** Filled with this player's {@link WalkthroughHandle} while it is mounted. */
  handleRef?: RefObject<WalkthroughHandle | null>
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const videoRef = useRef<HTMLVideoElement>(null)

  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)
  const [span, setSpan] = useState(0)
  const [speed, setSpeed] = useState(DEFAULT_SPEED)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [bytes, setBytes] = useState<number | null>(null)
  const [annotating, setAnnotating] = useState(false)
  const [hover, setHover] = useState<number | null>(null)

  const add = trpc.notes.add.useMutation({ onError: (e) => toast.push(e.message) })

  // How big the file being waited on is, so "loading" is a measured wait rather
  // than an indefinite one. Best effort: a HEAD that fails just leaves the copy
  // shorter.
  useEffect(() => {
    let live = true
    void fetch(url, { method: 'HEAD' })
      .then((res) => {
        const length = Number(res.headers.get('content-length'))
        if (live && Number.isFinite(length) && length > 0) setBytes(length)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [url])

  const seek = useCallback(
    (seconds: number): void => {
      const video = videoRef.current
      if (!video) return
      const target = seekTarget(seconds, { playable: playableDuration(video), annotating })
      if (target === null) return
      video.currentTime = target
      setAt(target)
    },
    [annotating],
  )

  /**
   * Jump to this moment (decision 25b): the playhead goes there and STOPS —
   * the human clicked a note to look at the frame it is about, and a player
   * that carried on would have moved past it before they arrived.
   */
  const jumpTo = useCallback(
    (seconds: number): void => {
      videoRef.current?.pause()
      seek(seconds)
    },
    [seek],
  )

  useEffect(() => {
    if (!handleRef) return
    handleRef.current = {
      seek: jumpTo,
      pause: () => videoRef.current?.pause(),
      getTicketId: () => ticketId,
    }
    return () => {
      handleRef.current = null
    }
  }, [handleRef, jumpTo, ticketId])

  const togglePlay = useCallback((): void => {
    const video = videoRef.current
    if (!video || annotating || phase !== 'ready') return
    if (video.paused) {
      void video.play().catch(() => toast.push('the browser refused to play this recording'))
    } else {
      video.pause()
    }
  }, [annotating, phase, toast])

  /** Coarse transport: ±5s, playing or paused. */
  const jump = useCallback((delta: number): void => {
    const video = videoRef.current
    if (video) seek(video.currentTime + delta)
  }, [seek])

  /**
   * Frame accuracy, and only while paused (decision 23a): stepping a thirtieth
   * of a second under a running playhead lands nowhere in particular.
   */
  const frameStep = useCallback((delta: number): void => {
    const video = videoRef.current
    if (video?.paused) seek(video.currentTime + delta)
  }, [seek])

  const applySpeed = useCallback((next: number): void => {
    setSpeed(next)
    const video = videoRef.current
    if (video) video.playbackRate = next
  }, [])

  /**
   * Open the overlay on the frame that is showing, pausing first if it is
   * moving (decision 24a). One act, from a control that is never disabled.
   */
  const startAnnotating = (): void => {
    if (phase !== 'ready') return
    videoRef.current?.pause()
    setAnnotating(true)
  }

  // The stage's expand, on the same terms the transport has: F while the
  // recording is what the stage is showing, silent while the overlay is drawing
  // on it. The native fullscreen this key used to call is gone (decision 4) —
  // it showed the frame alone, without the transport bar or the notes rail.
  useStageExpandKeys(expand, !annotating)

  // Keyboard-first transport (decision 23a). On `window` rather than the stage
  // so the keys work while the eye is on the frame and the focus is wherever the
  // last click left it; the overlay owns the keyboard while it is open.
  useEffect(() => {
    if (annotating) return
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      const handled = (): void => e.preventDefault()
      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          handled()
          return togglePlay()
        case 'j':
        case 'J':
        case 'ArrowLeft':
          handled()
          return jump(-JUMP_SECONDS)
        case 'l':
        case 'L':
        case 'ArrowRight':
          handled()
          return jump(JUMP_SECONDS)
        case ',':
          handled()
          return frameStep(-FRAME_SECONDS)
        case '.':
          handled()
          return frameStep(FRAME_SECONDS)
        case '<':
          handled()
          return applySpeed(cycleSpeed(speed, -1))
        case '>':
          handled()
          return applySpeed(cycleSpeed(speed, 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [annotating, togglePlay, jump, frameStep, applySpeed, speed])

  const retry = (): void => {
    setPhase('loading')
    videoRef.current?.load()
  }

  const saveAnnotation = async (png: Blob, text: string): Promise<void> => {
    const video = videoRef.current
    if (!video) return
    const moment = video.currentTime
    const saved = await saveAnnotatedNote({
      // `notes.add` requires text (decision 24c leaves it optional here), so a
      // drawing-only note says what it is: the picture and the moment are the
      // observation, and the human can type over it from the list.
      createNote: () =>
        add.mutateAsync({
          featureId,
          text: text || `Annotated ${fmtClock(moment)}`,
          videoTimestamp: moment,
          reviewTicketId: ticketId,
        }),
      uploadScreenshot: (noteId) => uploadScreenshot(noteId, png),
    })
    // The upload emits a note event and the stream invalidates this key on it —
    // asking here as well is what keeps the thumbnail from depending on the
    // stream being up at the moment of the save.
    void utils.notes.list.invalidate({ featureId })
    if (saved.uploadError) {
      toast.push(`the note was saved, but its annotated frame was not: ${saved.uploadError}`)
    }
    setAnnotating(false)
    onAnnotationSaved?.(saved.note.id)
  }

  /**
   * How long the recording is, from the only thing that knows: the element. A
   * WebM written by a live recorder reveals its length as it loads, so this is
   * read at every event that can move it, and the stage header is told each time.
   */
  const readSpan = (video: HTMLVideoElement): void => {
    const seconds = playableDuration(video)
    setSpan(seconds)
    onDuration?.(seconds)
  }

  const scrubbable = span > 0 && !annotating && phase === 'ready'
  const hint = bytes === null ? 'Loading the recording' : `Loading the recording — ${fmtBytes(bytes)}`

  return (
    // The frame and its bar are one unit that fits the viewport together
    // (decision 23e): annotating never pushes the frame off the top of the page,
    // and expanding grows the frame with the bar still under it. The unit takes
    // the height the stage gives it, which is the whole overlay while expanded.
    // It fades in on mount, so a recording swapped for another cross-fades
    // rather than cutting (the stage keys the player on the recording).
    <div className="flex min-h-0 flex-1 flex-col gap-2 animate-fade-in">
      <div className={frameClassName}>
        <video
          ref={videoRef}
          // Letterboxed inside the stage's inset ground. It takes the frame's
          // height whether that height is a 16:9 box or the expanded fill.
          className="min-h-0 w-full flex-1 cursor-pointer object-contain"
          src={url}
          preload="metadata"
          aria-label={passKind === 'verification' ? 'verification walkthrough' : 'review walkthrough'}
          onClick={togglePlay}
          onLoadedMetadata={(e) => {
            const video = e.currentTarget
            readSpan(video)
            video.playbackRate = speed
            // WebM written by a live recorder carries no poster frame, so the
            // first frame is decoded by nudging off zero — otherwise the stage
            // is black behind the loading copy.
            if (video.currentTime === 0) video.currentTime = 0.01
          }}
          onDurationChange={(e) => readSpan(e.currentTarget)}
          onProgress={(e) => readSpan(e.currentTarget)}
          onCanPlay={() => setPhase((p) => (p === 'error' ? p : 'ready'))}
          onError={() => setPhase('error')}
          onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />

        {phase === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-inset/70 animate-fade-in">
            <Spinner />
            <span className="text-sm text-text-secondary">{hint}</span>
          </div>
        )}

        {phase === 'error' && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-surface-inset px-6 text-center animate-fade-in"
            role="alert"
          >
            <span className="text-base font-medium text-text">This recording can’t be played</span>
            <span className="text-sm text-text-tertiary">The file may be corrupt.</span>
            <code className="max-w-full truncate font-mono text-xs text-text-tertiary">{url}</code>
            <Button className="mt-2" icon={<IconRefresh />} onClick={retry}>
              Retry
            </Button>
          </div>
        )}

        {annotating && videoRef.current && (
          <AnnotationOverlay
            video={videoRef.current}
            timestamp={at}
            onSave={saveAnnotation}
            onCancel={() => setAnnotating(false)}
          />
        )}
      </div>

      <div className="flex h-(--control-lg) items-center gap-3">
        <IconButton
          label={playing ? 'pause' : 'play'}
          kbd="K"
          icon={playing ? <IconPause /> : <IconPlay />}
          disabled={annotating || phase !== 'ready'}
          onClick={togglePlay}
        />

        <span className="shrink-0 font-mono text-xs text-text-secondary tabular-nums">{fmtClock(at)}</span>

        <div
          className="relative flex h-full flex-1 items-center"
          onMouseMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect()
            if (box.width <= 0 || span <= 0) return
            setHover(((e.clientX - box.left) / box.width) * span)
          }}
          onMouseLeave={() => setHover(null)}
        >
          <input
            type="range"
            className="h-1 w-full cursor-pointer accent-accent disabled:cursor-default disabled:opacity-50"
            min={0}
            // Coarse navigation only — a given second is reached with `,`/`.`
            // (decision 23b), not by hunting for it on a 20-minute slider.
            step={1}
            max={span || 1}
            value={Math.min(at, span || 1)}
            disabled={!scrubbable}
            aria-label="scrub the walkthrough"
            onChange={(e) => seek(Number(e.target.value))}
          />
          {hover !== null && (
            <span
              className="pointer-events-none absolute -top-5 -translate-x-1/2 rounded-sm bg-surface-raised px-1.5 font-mono text-xs text-text-secondary tabular-nums shadow-popover"
              style={{ left: `${Math.min(100, Math.max(0, (hover / (span || 1)) * 100))}%` }}
            >
              {fmtClock(hover)}
            </span>
          )}
          {span > 0 &&
            markers.map((marker) => (
              <button
                key={marker.at}
                type="button"
                className={
                  marker.noteIds.length > 1
                    ? 'absolute top-1/2 flex size-4 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-accent text-xs leading-none text-on-primary transition-transform duration-(--dur-1) ease-app hover:scale-110'
                    : 'absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full bg-accent ring-2 ring-surface transition-transform duration-(--dur-1) ease-app hover:scale-125'
                }
                style={{ left: `${Math.min(100, (marker.at / span) * 100)}%` }}
                aria-label={`${marker.noteIds.length} note${marker.noteIds.length > 1 ? 's' : ''} at ${fmtClock(marker.at)}`}
                title={`${marker.noteIds.length} note${marker.noteIds.length > 1 ? 's' : ''} at ${fmtClock(marker.at)}`}
                onClick={() => {
                  jumpTo(marker.at)
                  onMarkerClick?.(marker.noteIds)
                }}
              >
                {marker.noteIds.length > 1 ? marker.noteIds.length : ''}
              </button>
            ))}
        </div>

        <span className="shrink-0 font-mono text-xs text-text-tertiary tabular-nums">{fmtClock(span)}</span>

        <Button
          size="sm"
          variant="ghost"
          className="font-mono tabular-nums"
          aria-label={`playback speed ${speed}×`}
          title="Playback speed (< and >)"
          onClick={() => applySpeed(cycleSpeed(speed, 1))}
        >
          {speed}×
        </Button>

        {!readonly && !annotating && (
          <Button size="sm" icon={<IconPencil />} onClick={startAnnotating}>
            Annotate
          </Button>
        )}
      </div>
    </div>
  )
}
