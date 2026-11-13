import { useState } from 'react'
import { cx } from '../src/ui'
import { useTheme } from '../src/lib/theme'
import { useIsPhone } from '../src/lib/use-phone'

/**
 * The epics-on-autopilot design pages' own controls (autopilot-sidebar,
 * autopilot-feature): a card in the bottom-right corner labelled
 * "Design · states", one button per state with the current one marked, the
 * Tweaks folded behind one button, and the theme. Not part of the design.
 */

export interface TweakSpec {
  name: string
  label: string
  options: { value: string; label: string }[]
}

export function DesignPanel<K extends string>({
  states,
  state,
  onPick,
  tweaks,
  values,
  onTweak,
}: {
  states: { key: K; label: string; hint: string }[]
  state: K
  onPick: (k: K) => void
  tweaks: TweakSpec[]
  values: Record<string, string>
  onTweak: (name: string, value: string) => void
}) {
  const theme = useTheme()
  const phone = useIsPhone()
  const [open, setOpen] = useState(new URLSearchParams(location.search).get('panel') !== 'folded' && !phone)
  const [tweaksOpen, setTweaksOpen] = useState(false)
  const chip = (on: boolean) =>
    cx('h-6 shrink-0 cursor-pointer rounded-md px-2 text-left whitespace-nowrap', on ? 'bg-surface-selected text-text' : 'hover:bg-surface-hover hover:text-text-secondary')
  if (!open) {
    return (
      <button
        type="button"
        data-design-panel
        onClick={() => setOpen(true)}
        style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 1000 }}
        className="h-7 cursor-pointer rounded-md border border-dashed border-border-strong bg-surface-raised px-2.5 font-mono text-xs text-text-tertiary shadow-popover"
      >
        Design · states
      </button>
    )
  }
  return (
    <div
      data-design-panel
      style={{ position: 'fixed', right: 12, bottom: 12, width: 340, zIndex: 1000 }}
      className="flex flex-col gap-1 rounded-lg border border-dashed border-border-strong bg-surface-raised p-1.5 text-xs text-text-tertiary shadow-popover"
    >
      <div className="flex items-center gap-1 px-1.5 pt-0.5">
        <span className="font-mono text-text-secondary">Design · states</span>
        <button type="button" onClick={theme.toggle} className={cx(chip(false), 'ml-auto')}>
          {theme.resolved === 'dark' ? 'Light theme' : 'Dark theme'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={chip(false)}>
          Hide
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {states.map((s) => (
          <button key={s.key} type="button" aria-pressed={s.key === state} onClick={() => onPick(s.key)} className={chip(s.key === state)}>
            {s.label}
          </button>
        ))}
      </div>
      <p className="m-0 px-2 pb-0.5 leading-4 text-pretty">{states.find((s) => s.key === state)?.hint}</p>
      <div className="border-t border-border-subtle pt-1">
        <button type="button" aria-expanded={tweaksOpen} onClick={() => setTweaksOpen(!tweaksOpen)} className={chip(tweaksOpen)}>
          Tweaks {tweaksOpen ? '▾' : '▸'}
        </button>
        {tweaksOpen && (
          <div className="flex flex-col gap-1 px-0.5 pt-1">
            {tweaks.map((t) => (
              <div key={t.name} role="radiogroup" aria-label={t.label} className="flex flex-wrap items-center gap-1">
                <span className="w-24 shrink-0 px-1.5 text-text-secondary">{t.label}</span>
                {t.options.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={values[t.name] === o.value}
                    onClick={() => onTweak(t.name, o.value)}
                    className={chip(values[t.name] === o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Navigation is off on these pages: a link does nothing, and a router push from an imported piece lands nowhere. */
export function makeDeadEnd(): void {
  document.addEventListener(
    'click',
    (e) => {
      if ((e.target as Element | null)?.closest?.('a[href]')) e.preventDefault()
    },
    true,
  )
  const keep = history.pushState.bind(history)
  history.pushState = (data, unused, url) => {
    if (url && String(url).startsWith(location.pathname)) keep(data, unused, url)
  }
}
