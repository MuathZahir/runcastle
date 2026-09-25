import { useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { IconArchive, IconBranch, IconCopy, IconMore, IconPencil, IconTrash } from '../icons'
import { IconButton } from '../ui'
import type { ButtonSize } from '../ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

/**
 * One item of a {@link FeatureActionsMenu}. Presentation only — the mutation
 * lives with the caller.
 */
export interface FeatureAction {
  key: string
  label: string
  /** Destructive (Delete, Remove): rendered in `danger`, and sorted last behind a rule. */
  danger?: boolean
  /** Leading 16px icon. Omitted, the well-known keys get theirs (see `KEY_ICON`). */
  icon?: ReactNode
  /** Trailing shortcut hint. */
  kbd?: string
  onSelect: (triggerRef: RefObject<HTMLButtonElement | null>) => void
}

/**
 * The icons the callers' existing keys mean, so a caller written before items
 * carried icons still gets one on every row (DESIGN.md principle 7).
 */
const KEY_ICON: Record<string, ReactNode> = {
  'copy-link': <IconCopy />,
  'copy-branch': <IconBranch />,
  archive: <IconArchive />,
  unarchive: <IconArchive />,
  rename: <IconPencil />,
  delete: <IconTrash />,
  remove: <IconTrash />,
}

/**
 * A per-object actions menu — the "…" on a sidebar row, on a project card, in
 * the feature page's topbar. A thin, data-driven shell: it renders whatever
 * {@link FeatureAction}s the caller passes, with destructive items last behind
 * a separator. The trigger is an `IconButton` (tooltip = `label`); the
 * open/close, the outside click and the portal are the `DropdownMenu`
 * primitive's.
 */
export function FeatureActionsMenu({
  actions,
  label = 'Feature actions',
  size = 'sm',
  align = 'end',
}: {
  actions: FeatureAction[]
  /** The trigger's accessible name and tooltip — the rows it serves are not all features. */
  label?: string
  /** The trigger's size: `sm` 24 in rows (default), `md` 28 in a topbar. */
  size?: ButtonSize
  align?: 'start' | 'end'
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)

  if (actions.length === 0) return null
  const safe = actions.filter((a) => !a.danger)
  const destructive = actions.filter((a) => a.danger)

  const item = (a: FeatureAction) => (
    <DropdownMenuItem
      key={a.key}
      className="text-sm"
      tone={a.danger ? 'danger' : 'default'}
      icon={a.icon ?? KEY_ICON[a.key]}
      kbd={a.kbd}
      onSelect={() => {
        // The menu item disappears as this selection opens a dialog.
        // Put focus on the surviving trigger first so Dialog records a
        // connected opener and can restore keyboard position on close.
        triggerRef.current?.focus()
        a.onSelect(triggerRef)
      }}
    >
      {a.label}
    </DropdownMenuItem>
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          ref={triggerRef}
          label={label}
          size={size}
          icon={<IconMore />}
          className="shrink-0"
          // The row underneath is itself clickable: opening the menu must not
          // also select the feature. Radix opens on the pointer-down, so that
          // is the event the row must not see either.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className="font-sans"
        onCloseAutoFocus={(event) => {
          // An action can hand the focus straight on — Delete opens a dialog
          // that focuses its confirm input. Radix would pull it back to the
          // trigger a tick after that, so when anything else already holds
          // the focus, leave it where it is. Escape and an outside click land
          // on <body> and still get the trigger back.
          const focused = document.activeElement
          if (focused && focused !== document.body && focused !== triggerRef.current) {
            event.preventDefault()
          }
        }}
      >
        {safe.map(item)}
        {safe.length > 0 && destructive.length > 0 && <DropdownMenuSeparator />}
        {destructive.map(item)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
