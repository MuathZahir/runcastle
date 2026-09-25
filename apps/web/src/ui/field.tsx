import { cloneElement, isValidElement, useId } from 'react'
import type { ComponentPropsWithRef, ReactNode } from 'react'
import { IconSearch } from '../icons'
import { cx } from './floating'
import { Kbd } from './kbd'

/**
 * Text entry (DESIGN.md: `TextField` — `surface-inset`, hairline, focus →
 * accent border + ring). The focus ring itself is the global `:focus-visible`
 * outline, which `styles.css` draws *on* a field's border (offset -1px); a
 * field wrapped with an icon or kbd draws it on the wrapper instead.
 */

/**
 * The look of a bare text `<input>`, as a class list — for surfaces that
 * already own an `<input>` wired to their state. UI face; add `font-mono` for
 * code-shaped values (a path, a branch). Not `flex-1`: a row that wants the
 * input to take the slack appends it.
 */
export const TEXT_INPUT =
  'h-(--control-h) w-full min-w-0 rounded-md border border-border bg-surface-inset px-2.5 ' +
  'text-sm text-text transition-colors duration-(--dur-1) ease-app ' +
  'placeholder:text-text-tertiary hover:border-border-strong focus:border-accent ' +
  'disabled:cursor-not-allowed disabled:text-text-disabled aria-invalid:border-danger'

const FIELD_WRAP =
  'flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface-inset pr-1.5 pl-2.5 ' +
  'cursor-text transition-colors duration-(--dur-1) ease-app hover:border-border-strong ' +
  'focus-within:border-accent focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-focus-ring ' +
  'has-[input:disabled]:cursor-not-allowed has-[input[aria-invalid=true]]:border-danger'

const FIELD_SIZE = { md: 'h-(--control-h)', lg: 'h-(--control-lg)' } as const

export type TextFieldProps = Omit<ComponentPropsWithRef<'input'>, 'size'> & {
  /** Leading 14px icon. */
  icon?: ReactNode
  /** Trailing shortcut hint ("Ctrl K"). */
  kbd?: string
  /** `md` 28 (default) · `lg` 32 (the search field). */
  size?: 'md' | 'lg'
  /** Code-shaped value: mono. */
  mono?: boolean
  /** Marks the field invalid (`aria-invalid`, danger border). */
  invalid?: boolean
  /** Classes for the `<input>` itself; `className` goes on the wrapper. */
  inputClassName?: string
  /** Trailing element after the input (a clear button, a unit). */
  trailing?: ReactNode
}

/**
 * A single-line text field: optional leading `icon`, the input, optional
 * `trailing` element and `kbd` hint, on `surface-inset` with a hairline.
 * Every `<input>` attribute (and `ref`, `id`, `aria-describedby` from
 * {@link Field}) lands on the input; `className` styles the wrapper (width).
 */
export function TextField({
  icon,
  kbd,
  size = 'md',
  mono = false,
  invalid,
  className,
  inputClassName,
  trailing,
  type = 'text',
  ...rest
}: TextFieldProps) {
  return (
    <div className={cx(FIELD_WRAP, FIELD_SIZE[size], className)}>
      {icon && <span className="inline-flex shrink-0 text-icon [&>svg]:size-3.5">{icon}</span>}
      <input
        type={type}
        data-field-input=""
        aria-invalid={invalid || undefined}
        className={cx(
          'h-full min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-text outline-none',
          'placeholder:text-text-tertiary disabled:cursor-not-allowed disabled:text-text-disabled',
          mono ? 'font-mono text-xs' : 'font-sans text-sm',
          inputClassName,
        )}
        {...rest}
      />
      {trailing}
      {kbd && <Kbd>{kbd}</Kbd>}
    </div>
  )
}

/**
 * The search field: a {@link TextField} with the search icon, `lg` by default,
 * and an optional `kbd` ("Ctrl K"). `aria-label` defaults to the placeholder.
 */
export function SearchField({ size = 'lg', placeholder = 'Search', ...rest }: Omit<TextFieldProps, 'icon'>) {
  return (
    <TextField
      icon={<IconSearch />}
      size={size}
      placeholder={placeholder}
      aria-label={rest['aria-label'] ?? placeholder}
      {...rest}
    />
  )
}

/**
 * A multi-line text field — the same ground, hairline and focus as
 * {@link TextField}; resizes vertically. `mono` for code.
 */
export function TextArea({
  mono = false,
  invalid,
  className,
  rows = 4,
  ...rest
}: ComponentPropsWithRef<'textarea'> & { mono?: boolean; invalid?: boolean }) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cx(
        'block w-full min-w-0 resize-y rounded-md border border-border bg-surface-inset px-2.5 py-1.5',
        'text-text transition-colors duration-(--dur-1) ease-app',
        'placeholder:text-text-tertiary hover:border-border-strong focus:border-accent',
        'disabled:cursor-not-allowed disabled:text-text-disabled aria-invalid:border-danger',
        mono ? 'font-mono text-xs leading-[18px]' : 'font-sans text-sm',
        className,
      )}
      {...rest}
    />
  )
}

/**
 * A labelled control with its help and error text wired to it — the three ids
 * an assistive technology needs to read a field as one thing.
 *
 * The control is the child: it is cloned with an `id` and `aria-describedby`
 * so the call site stays `<Field label="Base"><TextField …/></Field>`. An `id`
 * already on the control wins and the label follows it there.
 *
 * `layout` replaces the default stacked column (settings' rows are a
 * two-column grid) and `labelAside` puts an affordance *beside* the label — a
 * `<label>` may not contain another labelable element.
 */
export function Field({
  label,
  labelAside,
  help,
  error,
  htmlFor,
  layout = 'flex flex-col gap-1.5',
  children,
}: {
  label: ReactNode
  /** Sits beside the label, outside it — a help affordance, a save indicator. */
  labelAside?: ReactNode
  help?: ReactNode
  error?: ReactNode
  /** Force the control's id, rather than generating one. */
  htmlFor?: string
  /** Root layout classes, REPLACING the default stacked column. */
  layout?: string
  children: ReactNode
}) {
  const generated = useId()
  const control = isValidElement<{ id?: string; 'aria-describedby'?: string }>(children)
    ? children
    : null
  const id = control?.props.id ?? htmlFor ?? generated
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const describedBy = cx(help ? helpId : null, error ? errorId : null) || undefined

  const labelEl = (
    <label className="text-sm font-medium text-text-secondary" htmlFor={id}>
      {label}
    </label>
  )

  return (
    <div className={layout}>
      {labelAside ? (
        // Control-height, so the label reads as being on the control's line.
        <div className="flex min-h-(--control-h) items-center gap-1.5">
          {labelEl}
          {labelAside}
        </div>
      ) : (
        labelEl
      )}
      {control
        ? cloneElement(control, {
            id,
            'aria-describedby': cx(control.props['aria-describedby'], describedBy) || undefined,
          })
        : children}
      {help && (
        <div id={helpId} className="text-xs text-text-tertiary">
          {help}
        </div>
      )}
      {error && (
        <div id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </div>
      )}
    </div>
  )
}
