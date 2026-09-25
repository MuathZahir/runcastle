import type { ReactNode } from 'react'
import { cx } from './floating'

/**
 * One key of a keyboard hint: `text-tertiary` on a `border` hairline,
 * `rounded-sm`. Chain several for a chord (`<Kbd>Ctrl</Kbd><Kbd>K</Kbd>`), or
 * pass the chord as one string ("Ctrl K"). Show hints only in menus, the search
 * field and beside the primary button (DESIGN.md).
 *
 * Lives in `src/ui/` (re-exported from `ui.tsx`) so the floating menus can use
 * it without importing `ui.tsx`, which imports them.
 */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        'inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-sm border border-border px-1',
        'font-sans text-[11px] leading-none font-medium text-text-tertiary',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
