import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { IconMore } from '../icons'

/**
 * A per-feature actions menu (kebab) for a sidebar row. Deliberately a thin,
 * data-driven shell: it renders whatever {@link FeatureAction}s the caller
 * passes, so new items (ticket 8 adds Delete) drop in without touching this
 * component. Presentation + open/close only — the mutations live with the
 * caller.
 */
export interface FeatureAction {
  key: string
  label: string
  /** Rendered in a danger color (destructive actions, e.g. Delete). */
  danger?: boolean
  onSelect: (triggerRef: RefObject<HTMLButtonElement | null>) => void
}

export function FeatureActionsMenu({ actions }: { actions: FeatureAction[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Close on any outside click or Escape — the menu floats over the rail.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (actions.length === 0) return null

  return (
    <div className="relative shrink-0 pr-1" ref={ref}>
      <button
        ref={triggerRef}
        className="rounded-md px-1.5 py-1 text-text-3 transition-colors duration-(--dur-1) ease-app hover:bg-panel-3 hover:text-text"
        aria-label="feature actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        <IconMore size={14} />
      </button>
      {open && (
        <div
          className="absolute top-[calc(100%-2px)] right-1 z-20 flex min-w-32 flex-col rounded-md border border-hairline bg-panel-2 p-1 shadow-menu"
          role="menu"
        >
          {actions.map((a) => (
            <button
              key={a.key}
              role="menuitem"
              className={`rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-(--dur-1) ease-app hover:bg-panel-3 ${
                a.danger ? 'text-danger' : 'text-text-2 hover:text-text'
              }`}
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                // The menu item disappears as this selection opens a dialog.
                // Put focus on the surviving trigger first so Dialog records a
                // connected opener and can restore keyboard position on close.
                triggerRef.current?.focus()
                a.onSelect(triggerRef)
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
