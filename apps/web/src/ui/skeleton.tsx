import type { ReactNode } from 'react'
import { cx } from './floating'

/**
 * The app's content-area loading state: the content's own shape in quiet
 * placeholder bars, so the real thing lands where the bars were. A skeleton
 * waits 300ms before fading in, so a fast load shows nothing at all. The bars'
 * breathing is its only progress indicator, so the breathing element is marked
 * `data-progress` and keeps a slow pulse under reduced motion (`theme.css`).
 *
 * `label` announces it (`role="status"` with the words for a screen reader);
 * without one it is decorative — the companion of a labelled skeleton
 * elsewhere on the page, like the feature page's crumb. Inline busy states (a
 * button's pending spinner) keep the `Spinner`: a skeleton cannot say "this
 * button is working".
 */
export function Skeleton({
  label,
  className,
  children,
}: {
  label?: string
  className?: string
  children: ReactNode
}) {
  const bars = (
    <div aria-hidden="true" data-progress="" className="animate-breathe">
      {children}
    </div>
  )
  if (label === undefined) return <div className={cx(DELAYED, className)}>{bars}</div>
  return (
    <div role="status" className={cx(DELAYED, className)}>
      <span className="sr-only">{label}</span>
      {bars}
    </div>
  )
}

/** One placeholder bar inside a {@link Skeleton}; the caller gives it its size and shape. */
export function SkeletonBar({ className }: { className: string }) {
  return <span className={cx('block shrink-0 rounded-sm bg-surface-selected', className)} />
}

/** The wait: a fast load shows nothing at all. */
const DELAYED = 'animate-fade-in [animation-delay:300ms]'
