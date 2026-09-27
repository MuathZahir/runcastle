import type { ReactNode } from 'react'
import { cx } from './floating'

/**
 * A vertical timeline: nodes top to bottom in the order things happened, on one
 * `border-strong` connector. Two markers: a small `ring` for an ordinary step
 * (a batch of tickets burned) and a `milestone` — a larger disc filled with a
 * tint of its tone and ringed in it — for the steps the story turns on (a
 * review, a verification). The lap trail is its first surface (decision 5).
 *
 * The list states `relative` for its own connector, the one overlay it draws;
 * the caller places it with `className`.
 */
export function Timeline({
  label,
  className,
  children,
}: {
  /** The list's accessible name. */
  label?: string
  className?: string
  children: ReactNode
}) {
  return (
    <ol
      aria-label={label}
      className={cx(
        'relative m-0 flex list-none flex-col gap-3 p-0 pt-2 pb-1',
        // The connector runs from the first marker's centre to the last one's.
        "before:absolute before:top-4 before:bottom-5 before:left-[11px] before:w-px before:bg-border-strong before:content-['']",
        className,
      )}
    >
      {children}
    </ol>
  )
}

export type TimelineTone = 'success' | 'warning' | 'danger' | 'neutral'

/** A milestone's disc: a ~16% tint of the tone on the surface, a ring and a glyph in it. */
const MILESTONE_TONE: Record<TimelineTone, string> = {
  success:
    'text-success bg-[color-mix(in_srgb,var(--color-success)_16%,var(--color-surface))] shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-success)_45%,transparent)]',
  warning:
    'text-warning bg-[color-mix(in_srgb,var(--color-warning)_16%,var(--color-surface))] shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-warning)_45%,transparent)]',
  danger:
    'text-danger bg-[color-mix(in_srgb,var(--color-danger)_16%,var(--color-surface))] shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-danger)_45%,transparent)]',
  neutral:
    'text-icon bg-[color-mix(in_srgb,var(--color-icon)_16%,var(--color-surface))] shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-icon)_45%,transparent)]',
}

/**
 * One step on a {@link Timeline}. `title`, `meta` and `aside` share the heading
 * line — the meta in quiet 12px after the title, the aside right-aligned (a
 * time, a button); `children` sit under it.
 */
export function TimelineNode({
  variant = 'ring',
  tone = 'neutral',
  icon,
  title,
  meta,
  aside,
  children,
}: {
  variant?: 'ring' | 'milestone'
  /** A milestone's tone; a ring has none. */
  tone?: TimelineTone
  /** A milestone's glyph. */
  icon?: ReactNode
  title: ReactNode
  meta?: ReactNode
  aside?: ReactNode
  children?: ReactNode
}) {
  const milestone = variant === 'milestone'
  return (
    <li
      data-node={variant}
      className={cx('relative flex min-w-0 flex-col pl-9', milestone && 'pt-1.5 pb-2')}
    >
      <span
        aria-hidden="true"
        className={cx('absolute left-0 grid size-[23px] place-items-center bg-surface', milestone ? 'top-3' : 'top-1')}
      >
        {milestone ? (
          <span className={cx('grid size-[23px] place-items-center rounded-full [&>svg]:size-3.5', MILESTONE_TONE[tone])}>
            {icon}
          </span>
        ) : (
          <span className="size-[9px] rounded-full border-[1.5px] border-border-strong bg-surface" />
        )}
      </span>
      <div className="flex min-h-[30px] flex-wrap items-center gap-x-3 gap-y-1">
        <span className={cx(milestone ? 'text-base font-medium text-text' : 'text-sm text-text-secondary')}>{title}</span>
        {meta && <span className="text-xs text-text-secondary">{meta}</span>}
        {aside && <span className="ml-auto flex items-center gap-2">{aside}</span>}
      </div>
      {children}
    </li>
  )
}
