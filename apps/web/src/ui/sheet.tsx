import type { ReactNode } from 'react'
import { Dialog } from '../ui'

/**
 * The phone's menu (docs/features/runcastle-on-your-phone): a sheet rising from
 * the screen's foot, a grab handle on top, an optional quiet title, then its
 * rows. Its mechanics are {@link Dialog}'s — portal, Escape, a tap on the
 * backdrop to dismiss, focus — at the `sheet` size, so it is not a second
 * overlay. Rows are {@link SheetRow}s.
 */
export function Sheet({
  open,
  onClose,
  title,
  label,
  children,
}: {
  open: boolean
  onClose: () => void
  /** The quiet heading over the rows ("Threads"); also the sheet's name. */
  title?: string
  /** The sheet's accessible name when it shows no title. */
  label?: string
  children: ReactNode
}) {
  return (
    <Dialog open={open} onClose={onClose} size="sheet" label={title ?? label}>
      <span aria-hidden className="mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-full bg-border-strong" />
      {title && <div className="px-4 py-2 text-xs font-medium text-text-tertiary">{title}</div>}
      <div className="min-h-0 overflow-y-auto">{children}</div>
    </Dialog>
  )
}

/**
 * One choice in a {@link Sheet}: a whole-width row a thumb can hit (52px), its
 * 20px icon (or a mark of its own, such as a thread's glyph), the label and an
 * optional hint under it. `current` marks the one already in front.
 */
export function SheetRow({
  icon,
  label,
  hint,
  current = false,
  onClick,
}: {
  icon: ReactNode
  label: string
  hint?: string
  current?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current || undefined}
      className="flex min-h-13 w-full cursor-pointer items-center gap-3 px-4 py-2 text-left active:bg-surface-hover"
    >
      <span className="inline-flex shrink-0 text-icon [&>svg]:size-5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base text-text">{label}</span>
        {hint && <span className="block truncate text-xs text-text-tertiary">{hint}</span>}
      </span>
    </button>
  )
}
