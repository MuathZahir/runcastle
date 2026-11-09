import { useState } from 'react'
import { cx } from '../../src/ui'
import { useTheme } from '../../src/lib/theme'
import { PHONE_QUERY } from '../../src/lib/use-phone'

/**
 * The design pages' own controls, never part of the app: the "Design · states"
 * corner panel with every state as a button and the theme. The state lives in
 * the address (`?state=`).
 */

const params = new URLSearchParams(location.search)

export function readState<K extends string>(states: Array<{ key: K }>): K {
  const asked = params.get('state')
  return (states.find((s) => s.key === asked) ?? states[0]!).key
}

/** Writes the state into the address without reloading. */
function remember(state: string) {
  history.replaceState(null, '', `${location.pathname}?state=${encodeURIComponent(state)}`)
}

const pill = (on: boolean) =>
  cx(
    'h-6 cursor-pointer rounded-md px-2 whitespace-nowrap',
    on ? 'bg-surface-selected text-text' : 'hover:bg-surface-hover hover:text-text-secondary',
  )

export function DesignPanel<K extends string>({
  states,
  state,
  onState,
  hint,
}: {
  states: Array<{ key: K; label: string }>
  state: K
  onState: (k: K) => void
  /** One quiet line about what the current state shows. */
  hint?: string
}) {
  const theme = useTheme()
  // Folded on a phone, where it would cover the screen it is about.
  const [folded, setFolded] = useState(() => matchMedia(PHONE_QUERY).matches)
  const setState = (k: K) => {
    remember(k)
    onState(k)
  }
  if (folded) {
    return (
      <button
        type="button"
        data-design-panel
        onClick={() => setFolded(false)}
        style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 1000 }}
        className="h-7 cursor-pointer rounded-md bg-surface-raised px-2.5 font-mono text-xs text-text-tertiary shadow-popover"
      >
        Design · states
      </button>
    )
  }
  return (
    <div
      data-design-panel
      style={{ position: 'fixed', right: 12, bottom: 12, width: 300, zIndex: 1000 }}
      className="flex flex-col gap-1 rounded-lg border border-dashed border-border-strong bg-surface-raised p-1.5 text-xs text-text-tertiary shadow-popover"
    >
      <div className="flex items-center px-1.5 pt-0.5">
        <span className="font-mono text-text-secondary">Design · states</span>
        <button type="button" onClick={() => setFolded(true)} className={cx(pill(false), 'ml-auto')}>
          Hide
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {states.map((s) => (
          <button key={s.key} type="button" aria-pressed={s.key === state} onClick={() => setState(s.key)} className={pill(s.key === state)}>
            {s.label}
          </button>
        ))}
        <button type="button" onClick={theme.toggle} className={cx(pill(false), 'ml-auto')}>
          {theme.resolved === 'dark' ? 'Light theme' : 'Dark theme'}
        </button>
      </div>
      {hint && <p className="m-0 px-2 pb-0.5 leading-4">{hint}</p>}
    </div>
  )
}

/** The page is a dead end: links do nothing. Project switches inside the mock are its own buttons. */
export function makeDeadEnd() {
  document.addEventListener(
    'click',
    (e) => {
      if ((e.target as Element | null)?.closest?.('a[href]')) e.preventDefault()
    },
    true,
  )
  // Router pushes from imported pieces land nowhere.
  const keep = history.pushState.bind(history)
  history.pushState = (data, unused, url) => {
    if (url && String(url).startsWith(location.pathname)) keep(data, unused, url)
  }
}
