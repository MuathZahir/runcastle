import { useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { cx } from './floating'

/** One tab: `id` (the value), `label`, optional leading `icon` and trailing `count`. */
export interface TabItem<T extends string = string> {
  id: T
  label: ReactNode
  icon?: ReactNode
  count?: ReactNode
  disabled?: boolean
  /** Id of the panel this tab shows, for `aria-controls`. */
  panelId?: string
}

const TAB_SIZE = {
  sm: 'h-(--control-sm) px-2 text-sm',
  md: 'h-(--control-h) px-2.5 text-sm',
} as const

/**
 * Text tabs that switch a page body between views of the same object (DESIGN.md
 * principle 1: views switch with Tabs, not more columns). No underline, no box:
 * the selected tab takes `surface-selected` and `text`.
 *
 * A real ARIA tablist: `role="tab"` + `aria-selected`, a roving tabindex (only
 * the selected tab is in the Tab order), and ←/→/Home/End move to and select a
 * neighbour (automatic activation). Controlled: `value` + `onChange`.
 *
 * Props: `items`, `value`, `onChange`, `size` (`sm` 24 · `md` 28, default),
 * `label` (the tablist's accessible name), `className`.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  size = 'md',
  label,
  className,
}: {
  items: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  size?: 'sm' | 'md'
  label?: string
  className?: string
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = items.findIndex((it) => it.id === value)
    const at = enabled.indexOf(current)
    let next: number | undefined
    if (event.key === 'ArrowRight') next = enabled[(at + 1) % enabled.length]
    else if (event.key === 'ArrowLeft') next = enabled[(at - 1 + enabled.length) % enabled.length]
    else if (event.key === 'Home') next = enabled[0]
    else if (event.key === 'End') next = enabled[enabled.length - 1]
    if (next === undefined) return
    event.preventDefault()
    const item = items[next]
    if (!item) return
    onChange(item.id)
    refs.current[next]?.focus()
  }

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cx('flex items-center gap-0.5', className)}>
      {items.map((it, i) => {
        const selected = it.id === value
        return (
          <button
            key={it.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={it.panelId}
            tabIndex={selected ? 0 : -1}
            disabled={it.disabled}
            onClick={() => onChange(it.id)}
            className={cx(
              'inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md font-medium whitespace-nowrap',
              'transition-colors duration-(--dur-1) ease-app disabled:cursor-not-allowed disabled:text-text-disabled',
              TAB_SIZE[size],
              selected ? 'bg-surface-selected text-text' : 'text-text-tertiary enabled:hover:text-text',
            )}
          >
            {it.icon && (
              <span className={cx('inline-flex [&>svg]:size-3.5', selected ? 'text-text' : 'text-icon')}>{it.icon}</span>
            )}
            {it.label}
            {it.count !== undefined && it.count !== null && (
              <span className="text-xs font-normal text-text-tertiary tabular-nums">{it.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
