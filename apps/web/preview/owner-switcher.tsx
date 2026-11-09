import { useState, type ReactNode } from 'react'
import { cx } from '../src/ui'
import { useTheme } from '../src/lib/theme'

/**
 * The design pages' own corner panel, "Design · states" (not part of the app):
 * every state a visible button, the current one marked, the theme beside them,
 * and the Tweaks folded under them. The state lives in the address as
 * `?state=`, so a reload comes back to it.
 */
export function Switcher<K extends string>({
  states,
  current,
  onPick,
  tweaks,
}: {
  states: readonly { key: K; label: string }[]
  current: K
  onPick: (key: K) => void
  /** The Tweaks' body; no Tweaks section without it. */
  tweaks?: ReactNode
}) {
  const theme = useTheme()
  const [open, setOpen] = useState(true)
  return (
    <div
      style={{ position: 'fixed', right: 12, bottom: 12, width: 248, zIndex: 1000 }}
      className="flex flex-col gap-1 rounded-lg bg-surface-raised p-1.5 text-xs text-text-tertiary shadow-popover"
    >
      <span className="px-1.5 pt-0.5 font-medium text-text-secondary">Design · states</span>
      <div className="flex flex-wrap gap-1">
        {states.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={s.key === current}
            onClick={() => {
              const q = new URLSearchParams(location.search)
              q.set('state', s.key)
              history.replaceState(null, '', `${location.pathname}?${q}`)
              onPick(s.key)
            }}
            className={pill(s.key === current)}
          >
            {s.label}
          </button>
        ))}
        <button type="button" onClick={theme.toggle} className={pill(false)}>
          {theme.resolved === 'dark' ? 'Light theme' : 'Dark theme'}
        </button>
      </div>
      {tweaks && (
        <div className="border-t border-border-subtle pt-1">
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={pill(false)}>
            Tweaks {open ? '–' : '+'}
          </button>
          {open && <div className="flex flex-col gap-1 px-1.5 pt-1 pb-0.5">{tweaks}</div>}
        </div>
      )}
    </div>
  )
}

export function pill(on: boolean): string {
  return cx(
    'h-6 cursor-pointer rounded-md px-2',
    on ? 'bg-surface-selected text-text' : 'hover:bg-surface-hover hover:text-text-secondary',
  )
}

/** The state the address asks for, or the default. */
export function stateFromAddress<K extends string>(keys: readonly K[], fallback: K): K {
  const asked = new URLSearchParams(location.search).get('state')
  return keys.find((k) => k === asked) ?? fallback
}

/** A dead end on purpose: links go nowhere. */
export function stopLinks(): void {
  document.addEventListener(
    'click',
    (e) => {
      if ((e.target as Element | null)?.closest?.('a[href]')) e.preventDefault()
    },
    true,
  )
}
