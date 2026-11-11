import { useState } from 'react'
import { cx } from '../src/ui'
import { useTheme } from '../src/lib/theme'

/**
 * The design pages' own controls for calmer-worker-chats
 * (worker-chat-calm, lead-chat-workers): a strip above the design labelled
 * "Design · states", one button per state with the current one marked, the
 * Tweaks folded behind one button, and the theme. Not part of the design.
 */

export interface TweakSpec {
  name: string
  label: string
  options: { value: string; label: string }[]
}

export function DesignBar<K extends string>({
  states,
  state,
  onPick,
  hint,
  tweaks,
  values,
  onTweak,
}: {
  states: { key: K; label: string }[]
  state: K
  onPick: (k: K) => void
  hint: string
  tweaks: TweakSpec[]
  values: Record<string, string>
  onTweak: (name: string, value: string) => void
}) {
  const theme = useTheme()
  const [tweaksOpen, setTweaksOpen] = useState(false)
  const chip = (on: boolean) =>
    cx('h-6 shrink-0 cursor-pointer rounded-md px-2 whitespace-nowrap', on ? 'bg-surface-selected text-text' : 'hover:bg-surface-hover hover:text-text-secondary')
  return (
    <div data-design-panel className="flex shrink-0 flex-col border-b border-dashed border-border-strong bg-surface-raised text-xs text-text-tertiary">
      <div className="flex h-10 items-center gap-1 overflow-x-auto px-3">
        <span className="mr-2 font-mono text-text-secondary">Design · states</span>
        {states.map((s) => (
          <button key={s.key} type="button" aria-pressed={s.key === state} onClick={() => onPick(s.key)} className={chip(s.key === state)}>
            {s.label}
          </button>
        ))}
        <span className="mx-2 min-w-0 flex-1 truncate">{hint}</span>
        <button type="button" aria-expanded={tweaksOpen} onClick={() => setTweaksOpen(!tweaksOpen)} className={chip(tweaksOpen)}>
          Tweaks {tweaksOpen ? '▾' : '▸'}
        </button>
        <button type="button" onClick={theme.toggle} className={chip(false)}>
          {theme.resolved === 'dark' ? 'Light theme' : 'Dark theme'}
        </button>
      </div>
      {tweaksOpen && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border-subtle px-3 py-1.5">
          {tweaks.map((t) => (
            <div key={t.name} role="radiogroup" aria-label={t.label} className="flex items-center gap-1">
              <span className="mr-1 text-text-secondary">{t.label}</span>
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
  )
}

/** Navigation is off on these pages: a link does nothing. */
export function killLinks(): void {
  document.addEventListener(
    'click',
    (e) => {
      if ((e.target as Element | null)?.closest?.('a[href]')) e.preventDefault()
    },
    true,
  )
}
