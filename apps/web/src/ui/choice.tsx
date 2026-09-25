import { useRef } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { IconCheck } from '../icons'
import { cx } from './floating'

/**
 * Choices (DESIGN.md §Components): `SegmentedControl` for one of a few
 * mutually exclusive values shown side by side (Theme: Dark · Light · System),
 * `Checkbox` for an independent yes/no inside a list or a form, `Switch` for a
 * setting that takes effect the moment it is flipped.
 *
 * All three keep the native semantics (radio group, `<input type=checkbox>`,
 * `role="switch"`) and the app's one focus ring.
 */

/** One segment: its `value`, a short `label`, an optional 14px `icon`. */
export interface SegmentItem<T extends string = string> {
  value: T
  label: ReactNode
  icon?: ReactNode
  disabled?: boolean
}

const SEGMENT_SIZE = {
  sm: 'h-(--control-sm) text-xs',
  md: 'h-(--control-h) text-sm',
} as const

/**
 * One value out of a few, every option visible: an inset track with the chosen
 * segment raised on it. The raised ground **slides** to the new segment
 * (`--dur-2`, transform only) rather than blinking across.
 *
 * A real radio group: `role="radiogroup"` named by `label`, `role="radio"` +
 * `aria-checked` segments, a roving tabindex (only the chosen segment is in the
 * Tab order), and ←/→/↑/↓/Home/End move to *and* choose a neighbour, as native
 * radios do. Segments share the width equally. Controlled: `value` +
 * `onChange`. `size` `sm` 24 · `md` 28 (default).
 */
export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  label,
  size = 'md',
  id,
  className,
}: {
  items: SegmentItem<T>[]
  value: T
  onChange: (value: T) => void
  /** The group's accessible name ("Theme"). */
  label: string
  size?: 'sm' | 'md'
  id?: string
  className?: string
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const at = Math.max(
    0,
    items.findIndex((it) => it.value === value),
  )

  const move = (from: number, step: 1 | -1 | 'first' | 'last') => {
    const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0)
    if (enabled.length === 0) return
    let next: number
    if (step === 'first') next = enabled[0]!
    else if (step === 'last') next = enabled[enabled.length - 1]!
    else {
      const pos = enabled.indexOf(from)
      next = enabled[(pos + step + enabled.length) % enabled.length]!
    }
    refs.current[next]?.focus()
    onChange(items[next]!.value)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : e.key === 'Home'
            ? 'first'
            : e.key === 'End'
              ? 'last'
              : null
    if (step === null) return
    e.preventDefault()
    move(i, step)
  }

  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={label}
      className={cx('inline-flex rounded-md border border-border bg-surface-inset p-0.5', className)}
    >
      <div
        className="relative grid w-full"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` } as CSSProperties}
      >
        {/* The raised ground under the chosen segment, sliding between them. */}
        <span
          aria-hidden="true"
          data-segment-thumb=""
          className="pointer-events-none absolute inset-y-0 left-0 rounded-[5px] bg-surface-selected shadow-popover transition-transform duration-(--dur-2) ease-out-app"
          style={{ width: `${100 / items.length}%`, transform: `translateX(${at * 100}%)` }}
        />
        {items.map((it, i) => {
          const checked = i === at
          return (
            <button
              key={it.value}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              disabled={it.disabled}
              onClick={() => onChange(it.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cx(
                'relative inline-flex min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-[5px] px-2.5 font-medium',
                'transition-colors duration-(--dur-1) ease-app disabled:cursor-not-allowed disabled:text-text-disabled',
                SEGMENT_SIZE[size],
                checked ? 'text-text' : 'text-text-tertiary enabled:hover:text-text-secondary',
              )}
            >
              {it.icon && (
                <span className={cx('inline-flex shrink-0 [&>svg]:size-3.5', checked ? 'text-text' : 'text-icon')}>
                  {it.icon}
                </span>
              )}
              <span className="truncate">{it.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The box itself: a native checkbox, restyled — 14px, `rounded-sm`, a
 * `border-strong` hairline on the inset ground; checked, it fills with the
 * inverted-neutral `primary` and shows a check. The focus ring sits outside it
 * like every other control's.
 */
const BOX =
  'peer col-start-1 row-start-1 m-0 size-3.5 cursor-pointer appearance-none rounded-sm border border-border-strong bg-surface-inset ' +
  'transition-colors duration-(--dur-1) ease-app hover:border-text-tertiary ' +
  'checked:border-primary checked:bg-primary checked:hover:bg-primary-hover ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ' +
  'disabled:cursor-not-allowed disabled:border-border disabled:checked:bg-text-disabled'

/**
 * An independent yes/no — "Quick fix" on a triage row, "Hidden" in the folder
 * picker. A native `<input type="checkbox">` (so forms, labels and screen
 * readers all work) wearing the app's box; `label` is clickable with it. Put
 * the words in `label`, or name it with `aria-label` when it stands alone.
 *
 * `size` sets the label's type: `sm` 12px (inside a row, the default) · `md`
 * 13px (in a form).
 */
export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  size = 'sm',
  id,
  className,
  'aria-label': ariaLabel,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  disabled?: boolean
  size?: 'sm' | 'md'
  id?: string
  className?: string
  'aria-label'?: string
}) {
  return (
    <label
      className={cx(
        'inline-flex cursor-pointer items-center gap-2 select-none',
        size === 'sm' ? 'text-xs' : 'text-sm',
        disabled ? 'cursor-not-allowed text-text-disabled' : 'text-text-secondary hover:text-text',
        className,
      )}
    >
      <span className="grid shrink-0 place-items-center">
        <input
          id={id}
          type="checkbox"
          className={BOX}
          checked={checked}
          disabled={disabled}
          aria-label={ariaLabel}
          onChange={(e) => onChange(e.target.checked)}
        />
        <IconCheck
          size={12}
          strokeWidth={2}
          className="pointer-events-none col-start-1 row-start-1 text-on-primary opacity-0 transition-opacity duration-(--dur-1) peer-checked:opacity-100"
        />
      </span>
      {label}
    </label>
  )
}

/**
 * A setting that applies the moment it is flipped: a 28×16 track, the thumb
 * sliding across it (`--dur-2`, transform only); on, the track is `primary`.
 * `role="switch"` + `aria-checked`, named by `label` (visible, after it) or
 * `aria-label`.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
  className,
  'aria-label': ariaLabel,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  disabled?: boolean
  id?: string
  className?: string
  'aria-label'?: string
}) {
  const control = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full border p-px',
        'transition-colors duration-(--dur-2) ease-app disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-primary bg-primary' : 'border-border-strong bg-surface-inset enabled:hover:border-text-tertiary',
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'size-3 rounded-full transition-transform duration-(--dur-2) ease-out-app',
          checked ? 'translate-x-3 bg-on-primary' : 'translate-x-0 bg-text-tertiary',
        )}
      />
    </button>
  )
  if (label === undefined) return <span className={className}>{control}</span>
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2 text-sm text-text-secondary select-none', className)}>
      {control}
      {label}
    </label>
  )
}
