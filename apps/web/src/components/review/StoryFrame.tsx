import { useEffect, useRef, useState, type RefObject } from 'react'
import { IconExpand } from '../../icons'
import { useTheme, type ResolvedTheme } from '../../lib/theme'
import { Button, Dialog, DialogHeader } from '../../ui'

/**
 * One story, rendered live in a frame from the stories port — the review
 * page's "UI states" frame, shared with the map (the map of stories and
 * scenarios, decision 10; the map shows every page and its states, decision 6).
 *
 * The frames are the user's own components, cross-origin by design, so they
 * cannot be auto-sized. A component story gets a fixed height and "Open
 * larger" for the one story full-size. `deferred` mounts the iframe only once
 * the frame scrolls into view, holding its fixed height until then, so a long
 * page does not open every frame at once.
 *
 * A `page` story is a whole app at an address: a picture of it, drawn at a
 * fixed desktop size and scaled down to the frame's width, in runcastle's own
 * theme. It loads as it scrolls into view, at most {@link PAGES_LOADING_AT_ONCE}
 * at a time, and clicking it opens it larger, where it can be clicked through.
 */
export function StoryFrame({
  label,
  frameTitle,
  url,
  onOpen,
  deferred = false,
  page = false,
  openLabel,
}: {
  /** The quiet word over the frame: "Before", "This feature", a state's name. Omitted, a page frame has none. */
  label?: string
  /** The iframe's accessible name. */
  frameTitle: string
  url: string
  onOpen: () => void
  deferred?: boolean
  /** A whole page: scaled from {@link PAGE_WIDTH} × {@link PAGE_HEIGHT}, a picture that opens larger. Always deferred. */
  page?: boolean
  /** A page frame's accessible name for its click, when it opens something other than the larger view. */
  openLabel?: string
}) {
  if (page) {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        {label && (
          <div className="flex min-h-6 items-center">
            <span className="min-w-0 truncate text-xs text-text-tertiary">{label}</span>
          </div>
        )}
        <PageFrame
          frameTitle={frameTitle}
          url={url}
          openLabel={openLabel ?? `Open ${frameTitle} larger`}
          onOpen={onOpen}
        />
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-h-6 items-center gap-2">
        <span className="min-w-0 truncate text-xs text-text-tertiary">{label}</span>
        <OpenLarger className="ml-auto" onClick={onOpen} />
      </div>
      {deferred ? <WhenVisible frameTitle={frameTitle} url={url} /> : <Frame frameTitle={frameTitle} url={url} />}
    </div>
  )
}

const FRAME = 'block h-60 w-full rounded-md border border-border-subtle bg-surface-inset'

function Frame({ frameTitle, url }: { frameTitle: string; url: string }) {
  return <iframe title={frameTitle} src={url} loading="lazy" className={FRAME} />
}

/** Whether the element has come within reach of the viewport; once true, it stays true. */
function useVisible(ref: RefObject<Element | null>): boolean {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (visible || !el) return
    // No observer to ask (an old engine): show the frame rather than never.
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true)
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, visible])
  return visible
}

/** The frame's fixed-height ground until it intersects the viewport, then the frame. */
function WhenVisible({ frameTitle, url }: { frameTitle: string; url: string }) {
  const ref = useRef<HTMLDivElement>(null)
  if (useVisible(ref)) return <Frame frameTitle={frameTitle} url={url} />
  return <div ref={ref} data-frame-placeholder="" aria-hidden className={FRAME} />
}

/** The desktop size a page story is drawn at (decision 6), 16:10. */
export const PAGE_WIDTH = 1440
export const PAGE_HEIGHT = 900

/** How many page frames may be loading at once: each one starts a whole app. */
export const PAGES_LOADING_AT_ONCE = 3

let pagesLoading = 0
const pagesWaiting: (() => void)[] = []

/** Start the next waiting frame while there is room. */
function startWaiting(): void {
  while (pagesLoading < PAGES_LOADING_AT_ONCE) {
    const start = pagesWaiting.shift()
    if (!start) return
    pagesLoading++
    start()
  }
}

/**
 * A turn to load, from the shared queue, once `wanted`: `granted` turns true
 * when a slot is free, and `done` (the frame's `load`) frees it for the next.
 * Unmounting gives the slot back, or leaves the queue.
 */
function useLoadTurn(wanted: boolean): { granted: boolean; done: () => void } {
  const [granted, setGranted] = useState(false)
  const holding = useRef(false)
  useEffect(() => {
    if (!wanted) return
    const start = () => {
      holding.current = true
      setGranted(true)
    }
    pagesWaiting.push(start)
    startWaiting()
    return () => {
      const at = pagesWaiting.indexOf(start)
      if (at >= 0) pagesWaiting.splice(at, 1)
      giveBack(holding)
    }
  }, [wanted])
  return { granted, done: () => giveBack(holding) }
}

/** Free a held slot, once, for the next waiting frame. */
function giveBack(holding: { current: boolean }): void {
  if (!holding.current) return
  holding.current = false
  pagesLoading--
  startWaiting()
}

/** The frame's width over {@link PAGE_WIDTH}, kept current as the frame resizes. */
function useFitScale(ref: RefObject<Element | null>): number {
  const [scale, setScale] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = (width: number) => {
      if (width > 0) setScale(width / PAGE_WIDTH)
    }
    fit(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) fit(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return scale
}

/** A frame URL in the theme runcastle is painted in, as the catalogue's `theme` global. */
export function themedFrameUrl(url: string, theme: ResolvedTheme): string {
  return `${url}${url.includes('?') ? '&' : '?'}globals=theme:${theme}`
}

/**
 * A page story as a picture: a 16:10 box holding the page at
 * {@link PAGE_WIDTH} × {@link PAGE_HEIGHT}, scaled to the box's width. The
 * page takes no pointer; a click anywhere on the box opens it larger.
 */
function PageFrame({
  frameTitle,
  url,
  openLabel,
  onOpen,
}: {
  frameTitle: string
  url: string
  openLabel: string
  onOpen: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const scale = useFitScale(ref)
  const turn = useLoadTurn(useVisible(ref))
  const { resolved } = useTheme()
  return (
    <div
      ref={ref}
      data-page-frame=""
      className="relative aspect-[16/10] w-full overflow-hidden rounded-md border border-border-subtle bg-surface-inset hover:border-border-strong"
    >
      {turn.granted ? (
        <iframe
          title={frameTitle}
          src={themedFrameUrl(url, resolved)}
          tabIndex={-1}
          onLoad={turn.done}
          className="pointer-events-none absolute top-0 left-0 block origin-top-left border-0"
          style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, transform: `scale(${scale})` }}
        />
      ) : (
        <div data-frame-placeholder="" aria-hidden className="absolute inset-0" />
      )}
      <button
        type="button"
        aria-label={openLabel}
        className="absolute inset-0 block cursor-zoom-in"
        onClick={onOpen}
      />
    </div>
  )
}

export function OpenLarger({ className, onClick }: { className?: string; onClick: () => void }) {
  return (
    <Button size="sm" variant="ghost" icon={<IconExpand />} className={className} onClick={onClick}>
      Open larger
    </Button>
  )
}

/** The story a frame's "Open larger" asked for: its heading and the URL to show full-size. */
export interface LargerStory {
  title: string
  url: string
  /** A page story: shown in runcastle's theme, as its picture was. */
  page?: boolean
}

/** One story full-size in the app's dialog, or nothing while `story` is null. */
export function StoryLargerDialog({ story, onClose }: { story: LargerStory | null; onClose: () => void }) {
  const { resolved } = useTheme()
  return (
    <Dialog
      open={story !== null}
      onClose={onClose}
      size="full"
      labelledBy="ui-states-larger-title"
      className="flex h-[86vh] flex-col overflow-hidden"
    >
      {story && (
        <>
          <DialogHeader id="ui-states-larger-title" title={story.title} onClose={onClose} />
          <iframe
            title={`${story.title}, full size`}
            src={story.page ? themedFrameUrl(story.url, resolved) : story.url}
            className="block min-h-0 w-full flex-1 border-0 bg-surface-inset"
          />
        </>
      )}
    </Dialog>
  )
}
