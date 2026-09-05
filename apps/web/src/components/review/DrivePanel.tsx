import { useEffect, useRef, useState } from 'react'
import { Button } from '../../ui'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import {
  cropRect,
  isCapturable,
  selectionRect,
  tabCaptureSupported,
  type Rect,
} from '../../lib/capture'
import { uploadScreenshot } from '../../lib/reviews'
import { saveAnnotatedNote } from '../../lib/walkthrough'

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

export function DrivePanel({
  featureId,
  url,
  /** The review agent is holding this drive — the human watches (decision 20). */
  agentDriving = false,
}: {
  featureId: string
  url: string
  agentDriving?: boolean
}) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const add = trpc.notes.add.useMutation()

  const panelRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  // The capture stream, kept for the whole drive session: the prompt is the one
  // cost of reading cross-origin pixels, and paying it per capture would make
  // annotating the live app worse than annotating the video.
  const tapRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [supported] = useState(() =>
    tabCaptureSupported(typeof navigator === 'undefined' ? undefined : navigator),
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
  }, [url, generation])

  // The stream outlives every capture and dies with the panel — a drive that
  // ended still sharing the tab is a browser indicator over nothing.
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    },
    [],
  )

  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.preview) }, [shot])

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
        } as DisplayMediaStreamOptions)
        streamRef.current = stream
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
    // chrome never bakes into the shot the human is selecting.
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)

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
    if (shot) URL.revokeObjectURL(shot.preview)
    setShot(null)
    setText('')
  }

  const save = async (): Promise<void> => {
    if (!shot || saving) return
    setSaving(true)
    try {
      const saved = await saveAnnotatedNote({
        // `notes.add` requires text; the picture is the observation here, so a
        // wordless capture still says what it is (the same floor the walkthrough
        // overlay takes, decision 24c).
        createNote: () =>
          add.mutateAsync({ featureId, text: text.trim() || 'Screenshot from the test drive' }),
        uploadScreenshot: (noteId) => uploadScreenshot(noteId, shot.png),
      })
      void utils.notes.list.invalidate({ featureId })
      if (saved.uploadError) {
        toast.push(`the note was saved, but its screenshot was not: ${saved.uploadError}`)
      }
      discard()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'the note could not be saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div ref={panelRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-hairline bg-black">
      <iframe
        key={generation}
        ref={frameRef}
        className="min-h-0 flex-1 border-0 bg-white"
        src={url}
        title="the app on this branch"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        onLoad={() => setLoaded(true)}
      />

      {/* The toolbar sits over the app rather than above it: the stage is 16:9
          and every row of chrome is a row the app does not get. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-center gap-2 p-2">
        <div className="pointer-events-auto flex items-center gap-1 rounded-md border border-hairline bg-panel/90 p-1">
          {supported ? (
            <Button
              className="px-2"
              aria-pressed={selecting}
              disabled={arming}
              onClick={() => void armSelection()}
            >
              {arming ? 'Sharing…' : selecting ? 'Drag a region' : 'Select area'}
            </Button>
          ) : (
            <span className="px-2 font-mono text-xs text-text-3">
              this browser can’t capture its own tab — paste a screenshot into a note instead
            </span>
          )}
          <Button className="px-2" onClick={() => setGeneration((g) => g + 1)}>
            Reload
          </Button>
          <a
            className="inline-flex h-8 items-center rounded-md border border-hairline px-2 font-mono text-xs text-text-2 no-underline hover:border-hairline-strong hover:text-text"
            href={url}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open app ↗
          </a>
        </div>
        {agentDriving && (
          <span className="pointer-events-none flex items-center gap-2 rounded-md bg-panel/90 px-2 py-1 text-sm text-drive">
            <span className="size-2 animate-pulse rounded-pill bg-drive" />
            review agent driving — notes land below as it finds things
          </span>
        )}
        {!loaded && slow && (
          <span className="pointer-events-none rounded-md bg-panel/90 px-2 py-1 font-mono text-xs text-text-3">
            Can’t embed? Open app ↗ and paste a screenshot into a note.
          </span>
        )}
      </div>

      {selecting && (
        <div
          className="absolute inset-0 z-10 cursor-crosshair touch-none bg-bg/15"
          aria-label="drag over the part of the app that needs fixing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {marquee && (
            <div
              className="absolute border-2 border-danger bg-danger/15"
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
        <div className="absolute inset-x-0 bottom-0 z-20 flex items-end gap-3 bg-panel/95 p-3">
          <img
            className="h-14 w-24 rounded-sm border border-hairline bg-black object-contain"
            src={shot.preview}
            alt="the region you selected"
          />
          <textarea
            aria-label="what’s wrong here?"
            className="h-16 min-w-0 flex-1 resize-none rounded-md border border-hairline bg-panel-inset px-3 py-2 font-mono text-sm text-text placeholder:text-text-4 focus:border-accent-line focus:outline-none"
            placeholder="What’s wrong here? (optional — the picture is the note)"
            value={text}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey) return
              e.preventDefault()
              void save()
            }}
          />
          <Button variant="solid" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save note'}
          </Button>
          <Button onClick={discard}>Discard</Button>
        </div>
      )}

      {/* The tab's own pixels, never shown: the panel reads frames off it. In
          the document rather than detached, because that is what the spike
          proved; absent entirely where there is nothing to capture from. */}
      {supported && <video ref={tapRef} muted playsInline className="hidden" />}
    </div>
  )
}
