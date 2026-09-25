import type { ReactNode } from 'react'
import { cx } from '../../ui'
import { IconAlert, IconInfo } from '../../icons'

/**
 * The review surfaces' one inline notice (DESIGN.md: facts are text, no bordered
 * callouts): a 16px glyph, one sentence, an optional quiet detail, and at most
 * one or two actions on the right.
 *
 * Only a real blocker takes a ground, and only the two grounds the design
 * system allows a notice: `danger` (a merge conflict — `danger-subtle`) and
 * `accent` (something the page asks you to act on — `accent-subtle`). A
 * `warning` or `quiet` notice is the glyph and the words on the page itself.
 */
export type NoticeTone = 'danger' | 'accent' | 'warning' | 'quiet'

const GROUND: Record<NoticeTone, string> = {
  danger: 'bg-danger-subtle px-3 py-2.5',
  accent: 'bg-accent-subtle px-3 py-2.5',
  warning: 'py-1',
  quiet: 'py-1',
}

const GLYPH: Record<NoticeTone, string> = {
  danger: 'text-danger',
  accent: 'text-warning',
  warning: 'text-warning',
  quiet: 'text-icon',
}

export function Notice({
  tone,
  icon,
  title,
  meta,
  children,
  actions,
  role = 'alert',
  className,
}: {
  tone: NoticeTone
  /** The leading glyph; an alert triangle for danger/accent/warning, info otherwise. */
  icon?: ReactNode
  /** The one sentence. */
  title: ReactNode
  /** A tertiary fact after the sentence ("2d ago"). */
  meta?: ReactNode
  /** Quiet detail under the sentence. */
  children?: ReactNode
  /** The notice's action(s), right-aligned on the sentence's line. */
  actions?: ReactNode
  role?: 'alert' | 'status'
  className?: string
}) {
  const glyph = icon ?? (tone === 'quiet' ? <IconInfo /> : <IconAlert />)
  return (
    <div role={role} className={cx('flex items-start gap-3 rounded-md text-sm animate-rise-in', GROUND[tone], className)}>
      <span aria-hidden className={cx('mt-0.5 inline-flex size-4 shrink-0 items-center justify-center [&>svg]:size-4', GLYPH[tone])}>
        {glyph}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-h-5 flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-text">{title}</span>
          {meta && <span className="text-xs text-text-tertiary">{meta}</span>}
        </div>
        {children && <div className="text-sm text-pretty text-text-secondary">{children}</div>}
      </div>
      {actions && <div className="-my-0.5 flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  )
}
