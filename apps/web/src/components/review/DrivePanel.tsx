import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Button, IconButton, StatusLabel, TextArea, cx } from '../../ui'
import { IconExternalLink, IconRefresh, IconSelectArea } from '../../icons'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import {
  cropRect,
  isCapturable,
  selectionRect,
  tabCaptureSupported,
  type Rect,
} from '../../lib/capture'
import { uploadProjectNoteScreenshot } from '../../lib/project-notes'
import { uploadScreenshot } from '../../lib/reviews'
import { saveAnnotatedNote } from '../../lib/walkthrough'
import { frameSize, readPreviewWidth, writePreviewWidth, type PreviewWidth } from '../../lib/preview-width'
import { WidthMenu } from './WidthMenu'

/**
 * The app itself, on the evidence stage, with the video's annotate-and-attach
 * loop pointed at it (decisions 7b, 17, 39).
 *
 * The dev server is a plain cross-origin iframe — no proxy — because the capture
 * reads *composited pixels*, which makes it agnostic to what the dev server is
 * (Vite, HMR sockets, absolute URLs: all irrelevant). What reads them is tab
 * self-capture: one native "share this tab" prompt per drive session, then every
 * drag-select crops the current stream frame and ships the PNG down the note
 * screenshot pipeline exactly as a walkthrough annotation's baked frame does.
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

/**
 * Where a capture lands: a feature drive writes the feature's test note, a
 * project drive writes a project note (project-level-test-drive decision 1),
 * and the design view sends it into the feature's live chat as a request
 * (design-mode decision 4) — never a note.
 */
type CaptureTarget =
  | { featureId: string; projectId?: undefined; sendTo?: 'note' | 'chat' }
  | { projectId: string; featureId?: undefined; sendTo?: undefined }

/** The words that differ between a drive, whose capture is a note, and the design view, whose capture is a message. */
const CAPTURE_COPY = {
  note: {
    frameTitle: 'the app on this branch',
    open: 'Open app',
    cannotCapture: 'This browser can’t capture its own tab — paste a screenshot into a note instead',
    cannotEmbed: 'Can’t embed? Open the app and paste a screenshot into a note.',
    askLabel: 'what’s wrong here?',
    ask: 'What’s wrong here? Optional — the picture is the note.',
    send: 'Save note',
    sending: 'Saving…',
    failed: 'the note could not be saved',
  },
  chat: {
    frameTitle: 'the design preview',
    open: 'Open in a new tab',
    cannotCapture: 'This browser can’t capture its own tab — tell the chat instead',
    cannotEmbed: 'Can’t embed? Open it in a new tab.',
    askLabel: 'what should change?',
    ask: 'What should change? Optional — the picture shows where.',
    send: 'Send to chat',
    sending: 'Sending…',
    failed: 'the selection could not be sent',
  },
} as const

/** The PNG as base64, the shape `design.sendCrop` takes it in. */
async function pngBase64(png: Blob): Promise<string> {
  const bytes = new Uint8Array(await png.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

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
  /** Looking back at a shipped feature: the app is shown, nothing is written. */
  readonly = false,
  frameKey = '',
  toolbar,
  toolbarPlacement = 'floating',
  width,
  ...target
}: CaptureTarget & {
  url: string
  agentDriving?: boolean
  readonly?: boolean
  /**
   * Remounts the frame when it changes — a scenario's landing id, so landing on
   * the same entry URL twice still reloads the app (drive-scenarios decision 7).
   */
  frameKey?: string
  /** More controls for the toolbar, after its own (the Scenario menu). */
  toolbar?: ReactNode
  /** Over the app's top-left corner (a drive), or in a bar above it that covers none of it (the design view). */
  toolbarPlacement?: 'floating' | 'bar'
  /** The screen width the agent asked to show (`show_panel`'s `width`), over the remembered one. */
  width?: number
}) {
  const toast = useToast()
  const copy = CAPTURE_COPY[target.sendTo ?? 'note']
  const utils = trpc.useUtils()
  const add = trpc.notes.add.useMutation()

  const panelRef = useRef<HTMLDivElement>(null)
  const frame = useFrameWidth(width, panelRef)
  // The capture stream, kept for the whole drive session: the prompt is the one
  // cost of reading cross-origin pixels, and paying it per capture would make
  // annotating the live app worse than annotating the video.
  const tapRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Capture writes a note, so a history view has no business offering it
  // (decision 33a) — and neither has a browser that cannot read its own tab.
  const [canCapture] = useState(
    () => !readonly && tabCaptureSupported(typeof navigator === 'undefined' ? undefined : navigator),
  )
  const [arming, setArming] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const anchor = useRef<{ x: number; y: number } | null>(null)
  const [shot, setShot] = useState<{ png: Blob; preview: string } | null>(null)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
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

  // One owner for the preview URL: whoever replaces or clears `shot` releases
  // the one it displaced, unmount included.
  useEffect(() => () => URL.revokeObjectURL(shot?.preview ?? ''), [shot])

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
    setText('')
    setShot({ png, preview: URL.createObjectURL(png) })
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

  const discard = (): void => {
    setShot(null)
    setText('')
  }

  const save = async (): Promise<void> => {
    if (!shot || saving) return
    setSaving(true)
    // Both stores require text; the picture is the observation here, so a
    // wordless capture still says what it is (the same floor the walkthrough
    // overlay takes, decision 24c).
    const noteText = text.trim() || 'Screenshot from the test drive'
    try {
      if (target.sendTo === 'chat') {
        // A request to the agent: the picture alone is a whole message.
        await utils.client.design.sendCrop.mutate({
          featureId: target.featureId,
          png: await pngBase64(shot.png),
          text: text.trim(),
        })
        discard()
        return
      }
      let saved: { uploadError?: string }
      if (target.projectId !== undefined) {
        const projectId = target.projectId
        saved = await saveAnnotatedNote({
          createNote: () => utils.client.projectNotes.add.mutate({ projectId, text: noteText }),
          uploadScreenshot: (noteId) => uploadProjectNoteScreenshot(noteId, shot.png),
        })
        void utils.projectNotes.invalidate()
      } else {
        const featureId = target.featureId
        saved = await saveAnnotatedNote({
          createNote: () => add.mutateAsync({ featureId, text: noteText }),
          uploadScreenshot: (noteId) => uploadScreenshot(noteId, shot.png),
        })
        void utils.notes.list.invalidate({ featureId })
      }
      if (saved.uploadError) {
        toast.push(`the note was saved, but its screenshot was not: ${saved.uploadError}`)
      }
      discard()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : copy.failed)
    } finally {
      setSaving(false)
    }
  }

  const floating = toolbarPlacement === 'floating'
  // Floating, each group is a raised chip over the app; in the bar they sit flat in it.
  const group = floating
    ? 'pointer-events-auto flex items-center gap-0.5 rounded-lg bg-surface-raised p-1 shadow-popover'
    : 'flex items-center gap-0.5'
  const notice = floating
    ? 'pointer-events-none rounded-md bg-surface-raised px-2 py-1 shadow-popover'
    : 'px-1'
  const controls = (
    <>
      <div className={group}>
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
        <IconButton label={copy.open} href={url} target="_blank" icon={<IconExternalLink />} tooltipSide="bottom" />
        <WidthMenu width={frame.chosen} scale={frame.size.scale} onPick={frame.pick} />
      </div>
      {toolbar && <div className={group}>{toolbar}</div>}
      {!canCapture && !readonly && <span className={cx(notice, 'text-xs text-text-tertiary')}>{copy.cannotCapture}</span>}
      {agentDriving && (
        <span className={notice}>
          <StatusLabel tone="live">Review agent driving — notes land as it finds things</StatusLabel>
        </span>
      )}
      {!loaded && slow && <span className={cx(notice, 'text-xs text-text-tertiary')}>{copy.cannotEmbed}</span>}
    </>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md bg-surface-inset">
      {/* The design view's toolbar sits in a bar above the preview: a small
          component renders exactly where a floating one would cover it. */}
      {!floating && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle bg-surface-raised p-1">
          {controls}
        </div>
      )}
      {/* The stage: the frame and every layer over it. The selection is
          measured against this box, so a crop is of the frame alone — and,
          since a crop reads on-screen pixels, of the frame as drawn, scaled. */}
      <div ref={panelRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
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
          title={copy.frameTitle}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          onLoad={() => setLoaded(true)}
        />

        {/* A drive's toolbar floats over the app rather than above it: the
            stage is 16:9 and every row of chrome is a row the app does not get. */}
        {floating && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-center gap-2 p-3">
            {controls}
          </div>
        )}

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

        {shot && (
          <div className="absolute inset-x-3 bottom-3 z-20 flex items-end gap-3 rounded-lg bg-surface-raised p-2 shadow-popover animate-rise-in">
            <img
              className="h-14 w-24 rounded-md bg-surface-inset object-contain"
              src={shot.preview}
              alt="the region you selected"
            />
            <TextArea
              rows={2}
              aria-label={copy.askLabel}
              className="min-w-0 flex-1 resize-none"
              placeholder={copy.ask}
              value={text}
              autoFocus
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.shiftKey) return
                e.preventDefault()
                void save()
              }}
            />
            <Button variant="ghost" onClick={discard}>
              Discard
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              {saving ? copy.sending : copy.send}
            </Button>
          </div>
        )}

        {/* The tab's own pixels, never shown: the panel reads frames off it. In
            the document rather than detached, because that is what the spike
            proved; absent entirely where there is nothing to capture from. */}
        {canCapture && <video ref={tapRef} muted playsInline className="hidden" />}
      </div>
    </div>
  )
}
