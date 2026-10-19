import { useEffect, useRef, useState } from 'react'
import { IconExpand } from '../../icons'
import { Button, Dialog, DialogHeader } from '../../ui'

/**
 * One story, rendered live in a frame from the stories port — the review
 * page's "UI states" frame, shared with the map's group page (the map of
 * stories and scenarios, decision 10).
 *
 * The frames are the user's own components, cross-origin by design, so they
 * cannot be auto-sized: a fixed height, and "Open larger" for the one story
 * full-size. `deferred` mounts the iframe only once the frame scrolls into
 * view, holding its fixed height until then, so a long page does not open
 * every frame at once.
 */
export function StoryFrame({
  label,
  frameTitle,
  url,
  onOpen,
  deferred = false,
}: {
  /** The quiet word over the frame: "Before", "This feature", a state's name. */
  label: string
  /** The iframe's accessible name. */
  frameTitle: string
  url: string
  onOpen: () => void
  deferred?: boolean
}) {
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

/** The frame's fixed-height ground until it intersects the viewport, then the frame. */
function WhenVisible({ frameTitle, url }: { frameTitle: string; url: string }) {
  const ref = useRef<HTMLDivElement>(null)
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
  }, [visible])
  if (visible) return <Frame frameTitle={frameTitle} url={url} />
  return <div ref={ref} data-frame-placeholder="" aria-hidden className={FRAME} />
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
}

/** One story full-size in the app's dialog, or nothing while `story` is null. */
export function StoryLargerDialog({ story, onClose }: { story: LargerStory | null; onClose: () => void }) {
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
            src={story.url}
            className="block min-h-0 w-full flex-1 border-0 bg-surface-inset"
          />
        </>
      )}
    </Dialog>
  )
}
