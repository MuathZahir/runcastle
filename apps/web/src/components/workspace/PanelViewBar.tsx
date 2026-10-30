import type { ReactNode } from 'react'
import { cx } from '../../ui'

/**
 * The top of a panel view that has parts of its own (the-feature-s-right-panel
 * decision 4): one 40px bar under the panel's header, the view's own small
 * tabs (or a way back) on the left, its facts and actions on the right. Every
 * view that switches inside itself uses this one shape, so the views read as
 * one panel.
 */
export function PanelViewBar({
  children,
  aside,
  className,
}: {
  /** The view's own tabs, or a back link and a title. */
  children: ReactNode
  /** Facts and actions, right-aligned: an age, an Updating mark, open-full-window. */
  aside?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex h-10 shrink-0 items-center gap-2 px-4', className)}>
      <div className="flex min-w-0 items-center gap-1">{children}</div>
      <span className="flex-1" />
      {aside && <div className="flex shrink-0 items-center gap-1 text-xs text-text-tertiary">{aside}</div>}
    </div>
  )
}
