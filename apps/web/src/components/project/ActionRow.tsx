import type { ReactNode } from 'react'
import { cx } from '../../ui'

/**
 * One of the project home's doors, as a quiet row rather than a bordered card
 * (DESIGN.md: "bordered cards around every section" are retired): a 32px icon
 * tile on `surface-hover`, a medium title with a one-line hint beneath it, and
 * the row's actions on the right. Rows are separated by a `border-subtle` rule.
 *
 * `status` sits beside the title (a live StatusLabel); `caption` goes under the
 * actions — the reason a disabled action is disabled.
 */
export function ActionRow({
  icon,
  title,
  status,
  hint,
  actions,
  caption,
  children,
  rule = true,
  className,
}: {
  icon: ReactNode
  title: ReactNode
  status?: ReactNode
  hint: ReactNode
  actions: ReactNode
  caption?: ReactNode
  /** Anything under the row (a notice about a chat already open). */
  children?: ReactNode
  /** The `border-subtle` rule under the row; off when a Disclosure's own rule follows. */
  rule?: boolean
  className?: string
}) {
  return (
    <div className={cx('py-4', rule && 'border-b border-border-subtle', className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-hover text-icon [&>svg]:size-4"
        >
          {icon}
        </span>
        <div className="flex min-w-60 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="m-0 text-sm font-medium text-text">{title}</h2>
            {status}
          </div>
          <p className="m-0 text-sm text-pretty text-text-tertiary">{hint}</p>
        </div>
        <div className="ml-auto flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-2">{actions}</div>
          {caption && <span className="max-w-[32ch] text-right text-xs text-text-tertiary">{caption}</span>}
        </div>
      </div>
      {children}
    </div>
  )
}
