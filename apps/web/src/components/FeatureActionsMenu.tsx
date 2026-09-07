import { useRef } from 'react'
import type { RefObject } from 'react'
import { IconMore } from '../icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

/**
 * A per-feature actions menu (kebab) for a sidebar row. Deliberately a thin,
 * data-driven shell: it renders whatever {@link FeatureAction}s the caller
 * passes, so new items drop in without touching this component. Presentation
 * only — the mutations live with the caller, and the open/close, the outside
 * click and the portal are the `DropdownMenu` primitive's.
 */
export interface FeatureAction {
  key: string
  label: string
  /** Rendered in a danger color (destructive actions, e.g. Delete). */
  danger?: boolean
  onSelect: (triggerRef: RefObject<HTMLButtonElement | null>) => void
}

export function FeatureActionsMenu({
  actions,
  label = 'feature actions',
}: {
  actions: FeatureAction[]
  /** The trigger's accessible name — the rows it serves are not all features. */
  label?: string
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)

  if (actions.length === 0) return null

  return (
    <div className="shrink-0 pr-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={triggerRef}
          // No preflight (apps/web/STYLE.md), and `styles.css` still carries an
          // unlayered `button { color: inherit }` that beats a `text-*` utility
          // here — so the colour goes on the span, switched by `group-hover`.
          className="group cursor-pointer rounded-md border-0 bg-transparent px-1.5 py-1 transition-colors duration-(--dur-1) ease-app hover:bg-panel-3"
          aria-label={label}
          // The row underneath is itself clickable: opening the menu must not
          // also select the feature. Radix opens on the pointer-down, so that
          // is the event the row must not see either.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="flex text-text-3 group-hover:text-text">
            <IconMore size={14} />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          // Family here, size on the items. Tailwind emits `text-xs` after
          // every other size, so `DropdownMenuContent`'s mono default is the
          // later declaration whatever the class attribute says, and a size
          // passed here would be silently ignored — these items rendered at
          // 11px next to a 14px sidebar. `font-sans` is safe: it sorts after
          // `font-mono`.
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
          {actions.map((a) => (
            <DropdownMenuItem
              key={a.key}
              className="text-sm"
              tone={a.danger ? 'danger' : 'default'}
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
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
