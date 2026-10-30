import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { IconButton, StatusLabel, cx } from '../../ui'
import { IconExternalLink, IconRefresh, IconSelectArea } from '../../icons'
import { useToast } from '../../lib/toast'
import {
  cropRect,
  isCapturable,
  selectionRect,
  tabCaptureSupported,
  type Rect,
} from '../../lib/capture'
import { frameSize, readPreviewWidth, writePreviewWidth, type PreviewWidth } from '../../lib/preview-width'
import { WidthMenu } from './WidthMenu'

/**
 * The app itself, in the drive's window, with the video's annotate-and-attach
 * loop pointed at it (decisions 7b, 17, 39).
 *
 * The dev server is a plain cross-origin iframe — no proxy — because the capture
 * reads *composited pixels*, which makes it agnostic to what the dev server is
 * (Vite, HMR sockets, absolute URLs: all irrelevant). What reads them is tab
 * self-capture: one native "share this tab" prompt per drive session, then every
 * drag-select crops the current stream frame and hands the PNG to `onCapture`:
 * the note box on a drive, the chat's composer on the design view.
 *
 * Chromium-only, and that is designed for rather than worked around: elsewhere —
 * and when an app refuses to embed at all — the panel is `Open app ↗` beside the
 * paste-a-screenshot floor (decision 7a), under this same chrome.
 */

/** How long an iframe gets to load before the panel offers the way out. */
const EMBED_TIMEOUT_MS = 6000

/** The compositor's settle when a browser cannot say which frame is fresh. */
const FRAME_SETTLE_MS = 120

/**
 * The next frame the capture stream actually decodes.
 *
 * `requestVideoFrameCallback` answers this exactly and is available on every
 * browser this path runs in; the timeout is the spike's measured settle, kept as
 * the fallback so a missing API costs a slower capture rather than a marquee
 * baked into the shot.
 */
function nextStreamFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => resolve())
      return
    }
    setTimeout(resolve, FRAME_SETTLE_MS)
  })
}

/** The words that differ between a drive and the design view. */
const CAPTURE_COPY = {
  note: {
    frameTitle: 'the app on this branch',
    open: 'Open app',
    cannotCapture: 'This browser can’t capture its own tab — paste a screenshot into a note instead',
    cannotEmbed: 'Can’t embed? Open the app and paste a screenshot into a note.',
  },
  chat: {
    frameTitle: 'the design preview',
    open: 'Open in a new tab',
    cannotCapture: 'This browser can’t capture its own tab — tell the chat instead',
    cannotEmbed: 'Can’t embed? Open it in a new tab.',
  },
} as const

/**
 * The screen width the frame lays out at, and the pane it is scaled into
 * (design-mode ticket 19). The human's pick is remembered per browser; a width
 * the agent asked for wins for as long as it asks, and is not remembered.
 */
function useFrameWidth(asked: number | undefined, stageRef: RefObject<HTMLDivElement | null>) {
  const [chosen, setChosen] = useState<PreviewWidth>(() => asked ?? readPreviewWidth())
  useEffect(() => {
    if (asked !== undefined) setChosen(asked)
  }, [asked])
  const pick = (width: PreviewWidth): void => {
    setChosen(width)
    writePreviewWidth(width)
  }

  const [pane, setPane] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setPane({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [stageRef])

  return { chosen, pick, size: frameSize(chosen, pane) }
}

export function DrivePanel({
  url,
  /** The review agent is holding this drive — the human watches (decision 20). */
  agentDriving = false,
  frameKey = '',
  leading,
  toolbar,
  trailing,
  strip,
  cover,
  footer,
  width,
  onCapture,
  copy = 'note',
}: {
  url: string
  agentDriving?: boolean
  /**
   * Remounts the frame when it changes — a scenario's landing id, so landing on
   * the same entry URL twice still reloads the app (drive-scenarios decision 7).
   */
  frameKey?: string
  /** Controls first in the toolbar (the design view's Back). */
  leading?: ReactNode
  /** What the page is on, at the toolbar's left after `leading` (the scenario control, App | API). */
  toolbar?: ReactNode
  /** Controls after the page tools, at the toolbar's far right (the design server's menu). */
  trailing?: ReactNode
  /** Under the toolbar, above the page: a scenario's progress or failure, a hint (decision 4). */
  strip?: ReactNode
  /** Shown in the page's place, the page kept mounted under it and its tools put away (the API view). */
  cover?: ReactNode
  /** Under the page, inside the window: the drive's status line and its output. */
  footer?: ReactNode
  /** The screen width the agent asked to show (`show_panel`'s `width`), over the remembered one. */
  width?: number
  /** Where a selected area goes. Without it there is no Select area. */
  onCapture?: (png: Blob) => void
  /** Which words the frame says things in. */
  copy?: keyof typeof CAPTURE_COPY
}) {
  const toast = useToast()
  const words = CAPTURE_COPY[copy]

  const panelRef = useRef<HTMLDivElement>(null)
  const frame = useFrameWidth(width, panelRef)
  // The capture stream, kept for the whole drive session: the prompt is the one
  // cost of reading cross-origin pixels, and paying it per capture would make
  // annotating the live app worse than annotating the video.
  const tapRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // A browser that cannot read its own tab has nothing to offer.
  const [canCapture] = useState(
    () => !!onCapture && tabCaptureSupported(typeof navigator === 'undefined' ? undefined : navigator),
  )
  const [arming, setArming] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const anchor = useRef<{ x: number; y: number } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [slow, setSlow] = useState(false)
  // The iframe reloads by remount: `location.reload()` across origins throws,
  // and re-setting `src` on a navigated frame pushes history entries.
  const [generation, setGeneration] = useState(0)

  // An app sending `X-Frame-Options`/`frame-ancestors: deny` fails to embed with
  // nothing observable from here — no error event, no reachable document. A
  // frame that has not loaded by now gets the fallback said out loud; the
  // `Open app ↗` beside it was always there.
  useEffect(() => {
    setLoaded(false)
    setSlow(false)
    const timer = setTimeout(() => setSlow(true), EMBED_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [url, frameKey, generation])

  // The stream outlives every capture and dies with the panel — a drive that
  // ended still sharing the tab is a browser indicator over nothing.
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    },
    [],
  )

  /** Attach the stream if this is the session's first capture, then arm the drag. */
  const armSelection = async (): Promise<void> => {
    if (!streamRef.current) {
      setArming(true)
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          // `preferCurrentTab` makes the picker one click AND guarantees the
          // captured surface is this viewport, which is what makes the
          // selection → stream-pixel mapping exact rather than approximate.
          video: { displaySurface: 'browser' },
          audio: false,
          preferCurrentTab: true,
          selfBrowserSurface: 'include',
          // The last two are Chromium options the DOM typings do not carry;
          // {@link tabCaptureSupported} is what keeps them from reaching a
          // browser that would ignore them.
        } as DisplayMediaStreamOptions)
        streamRef.current = stream
        // Chrome's own "stop sharing" ends the track without telling this
        // component, and a dead stream draws a frozen frame. Dropping the
        // reference makes the next Select area ask again, which is the honest
        // behaviour — one prompt per SESSION, not one per capture.
        stream.getVideoTracks().forEach((track) => {
          track.addEventListener('ended', () => {
            if (streamRef.current === stream) streamRef.current = null
          })
        })
        const tap = tapRef.current
        if (tap) {
          tap.srcObject = stream
          await tap.play()
        }
      } catch (e) {
        toast.push(
          e instanceof Error && e.name === 'NotAllowedError'
            ? 'tab sharing was declined — nothing to capture from'
            : `tab capture failed: ${e instanceof Error ? e.message : String(e)}`,
        )
        return
      } finally {
        setArming(false)
      }
    }
    setSelecting(true)
  }

  const grab = async (selection: Rect): Promise<void> => {
    const panel = panelRef.current
    const tap = tapRef.current
    if (!panel || !tap) return
    // Two frames with the marquee and the dim already gone, so the selection
    // chrome never bakes into the shot the human is selecting — then the first
    // stream frame decoded after that paint, which is the frame that actually
    // shows the app without the overlay on it.
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    await nextStreamFrame(tap)

    if (!tap.videoWidth) {
      toast.push('the tab is no longer being shared — click Select area again')
      streamRef.current = null
      return
    }
    const box = panel.getBoundingClientRect()
    const crop = cropRect(selection, box, tap.videoWidth, window.innerWidth)
    const canvas = document.createElement('canvas')
    canvas.width = crop.width
    canvas.height = crop.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(tap, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!png) {
      toast.push('the selected region could not be turned into a picture')
      return
    }
    onCapture?.(png)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const box = panelRef.current?.getBoundingClientRect()
    if (!box) return
    anchor.current = { x: e.clientX - box.left, y: e.clientY - box.top }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const box = panelRef.current?.getBoundingClientRect()
    if (!anchor.current || !box) return
    setMarquee(selectionRect(anchor.current, { x: e.clientX - box.left, y: e.clientY - box.top }))
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    const box = panelRef.current?.getBoundingClientRect()
    const from = anchor.current
    anchor.current = null
    if (!from || !box) return
    const selection = selectionRect(from, { x: e.clientX - box.left, y: e.clientY - box.top })
    setSelecting(false)
    setMarquee(null)
    if (isCapturable(selection)) void grab(selection)
  }

  const notice = 'min-w-0 truncate px-1.5 text-xs text-text-tertiary'

  return (
    // The drive's window (test-drive-looks-the-part decisions 2, 12): flush with
    // what surrounds it, the head above the page at the full height left, and
    // whatever the caller puts above the page (`strip`) and under it (`footer`).
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Every control in one bar above the page, covering none of it
          (design-mode decision 12's one-row rule): what the page is on the
          left, the tools that act on it on the right. The bar never wraps; the
          left side's words give way first (decision 10). */}
      <div
        role="toolbar"
        aria-label="Page controls"
        className="flex h-(--topbar-h) shrink-0 items-center gap-1 border-b border-border-subtle px-2"
      >
        {leading}
        {toolbar && <div className="flex min-w-0 shrink items-center gap-1">{toolbar}</div>}
        {agentDriving && (
          <span className="min-w-0 truncate px-1.5">
            <StatusLabel tone="live">Review agent driving</StatusLabel>
          </span>
        )}
        {!cover && onCapture && !canCapture && <span className={notice}>{words.cannotCapture}</span>}
        {!cover && !loaded && slow && <span className={notice}>{words.cannotEmbed}</span>}
        <span className="flex-1" />
        {!cover && (
          <div className="flex shrink-0 items-center gap-0.5">
            {canCapture ? (
              <IconButton
                label={arming ? 'Sharing…' : selecting ? 'Drag a region' : 'Select area'}
                icon={<IconSelectArea />}
                active={selecting}
                disabled={arming}
                tooltipSide="bottom"
                onClick={() => void armSelection()}
              />
            ) : null}
            <IconButton
              label="Reload"
              icon={<IconRefresh />}
              tooltipSide="bottom"
              onClick={() => setGeneration((g) => g + 1)}
            />
            <WidthMenu width={frame.chosen} scale={frame.size.scale} onPick={frame.pick} />
            <IconButton label={words.open} href={url} target="_blank" icon={<IconExternalLink />} tooltipSide="bottom" />
          </div>
        )}
        {trailing}
      </div>
      {strip}
      {cover}
      {/* The stage: the frame and every layer over it. The selection is
          measured against this box, so a crop is of the frame alone — and,
          since a crop reads on-screen pixels, of the frame as drawn, scaled. */}
      <div
        ref={panelRef}
        className={cx('relative min-h-0 flex-1 flex-col overflow-hidden bg-surface-inset', cover ? 'hidden' : 'flex')}
      >
        {/* At a screen width the page lays out at that width and is drawn
            shrunk to the pane, so it wraps as it would on that screen; at Fit
            it lays out at the pane's own width. */}
        <iframe
          key={`${frameKey}:${generation}`}
          className={frame.chosen === 'fit' ? 'min-h-0 flex-1 border-0' : 'absolute top-0 origin-top-left border-0'}
          style={
            frame.chosen === 'fit'
              ? undefined
              : {
                  left: frame.size.left,
                  width: frame.size.width,
                  height: frame.size.height,
                  transform: `scale(${frame.size.scale})`,
                }
          }
          src={url}
          title={words.frameTitle}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          onLoad={() => setLoaded(true)}
        />

        {selecting && (
          <div
            className="absolute inset-0 z-10 cursor-crosshair touch-none bg-scrim/20 animate-fade-in"
            aria-label="drag over the part of the app that needs fixing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {marquee && (
              <div
                className="absolute rounded-sm border-2 border-accent bg-accent-subtle/40"
                style={{
                  left: marquee.x,
                  top: marquee.y,
                  width: marquee.width,
                  height: marquee.height,
                }}
              />
            )}
          </div>
        )}

        {/* The tab's own pixels, never shown: the panel reads frames off it. In
            the document rather than detached, because that is what the spike
            proved; absent entirely where there is nothing to capture from. */}
        {canCapture && <video ref={tapRef} muted playsInline className="hidden" />}
      </div>
      {footer}
    </div>
  )
}
