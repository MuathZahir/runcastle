import * as SelectPrimitive from '@radix-ui/react-select'
import type { ComponentPropsWithoutRef } from 'react'
import { IconCheck, IconChevronDown } from '../icons'
import { FLOATING_ITEM, FLOATING_ITEM_DEFAULT, FLOATING_LABEL, FLOATING_SURFACE, cx } from './floating'

/**
 * The app's value picker: one choice out of a fixed, grouped list — the model
 * choosers and every settings dropdown (feature decision 2). A menu of
 * *actions* is `DropdownMenu`; a list long enough to want searching is
 * `Combobox`.
 *
 * Compound, shadcn-style, and everything a Radix part accepts is forwarded.
 * What this module adds is the portal (always — content clipped by an
 * ancestor's overflow is the bug this feature exists to fix), the theme
 * surface, the height cap, and the empty-value translation below.
 */

/**
 * What a `SelectItem value=""` actually carries to Radix.
 *
 * Radix reads the empty string as "nothing is selected": a root whose value is
 * `''` shows its placeholder, and the selected item's text is not portalled
 * into the trigger. But `''` is exactly what this app's config means by *unset*
 * — "default (project model)", "Use global (…)", "Default (claude-opus-5)" —
 * and each of those is a real, pickable row that has to read out in the closed
 * trigger. So the primitive translates at its own edge: consumers pass and
 * receive `''` exactly as they did with `<option value="">`, and Radix sees
 * this sentinel in between. The NUL prefix is what keeps it from ever
 * colliding with a model id or a config identifier.
 *
 * `undefined` is left alone, and still means "no value yet, show the
 * placeholder".
 */
const EMPTY = '\u0000empty'

const toRadix = (value: string) => (value === '' ? EMPTY : value)
const fromRadix = (value: string) => (value === EMPTY ? '' : value)

export function Select({
  value,
  defaultValue,
  onValueChange,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Root>) {
  return (
    <SelectPrimitive.Root
      value={value === undefined ? undefined : toRadix(value)}
      defaultValue={defaultValue === undefined ? undefined : toRadix(defaultValue)}
      onValueChange={onValueChange && ((next) => onValueChange(fromRadix(next)))}
      {...props}
    />
  )
}

/**
 * The closed control. Layout and the chevron only: the surface it wears is one
 * of the two looks below, passed as its `className` — `SELECT_FIELD` in a form,
 * `SELECT_GHOST` inline in a row or a bar.
 */
const TRIGGER = 'inline-flex min-w-0 cursor-pointer items-center justify-between gap-1.5 text-left'

/**
 * The standard field look for a trigger — a form control on `surface-inset`
 * with a hairline, like `TextField`. Pass it as the trigger's `className`
 * (plus a width) wherever the select is a form field rather than inline chrome.
 */
export const SELECT_FIELD =
  'h-(--control-h) rounded-md border border-border bg-surface-inset px-2.5 text-sm text-text ' +
  'transition-colors duration-(--dur-1) ease-app hover:border-border-strong ' +
  'data-[state=open]:border-accent data-placeholder:text-text-tertiary disabled:cursor-not-allowed disabled:text-text-disabled'

/**
 * The quiet inline look for a trigger — a ghost button (no border or fill at
 * rest, `surface-hover` under the pointer, `surface-selected` while open), 24px,
 * 12px `text-tertiary`. For a value picker that sits in a row or a header
 * rather than a form: the ticket's model, the run history. Add `font-mono` for
 * a code-shaped value.
 */
export const SELECT_GHOST =
  'h-(--control-sm) rounded-md px-1.5 text-xs text-text-tertiary ' +
  'transition-colors duration-(--dur-1) ease-app enabled:hover:bg-surface-hover enabled:hover:text-text ' +
  'data-[state=open]:bg-surface-selected data-[state=open]:text-text disabled:cursor-not-allowed disabled:text-text-disabled'

export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger className={cx(TRIGGER, className)} {...props}>
      {children}
      <SelectPrimitive.Icon className="shrink-0 text-icon">
        <IconChevronDown size={14} />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

/**
 * The selected row's text, inside the trigger. Truncates rather than widening
 * the control — a model id with a use-case note is longer than any of the
 * places this sits.
 *
 * Radix's `Select.Value` drops `className` (and `style`) on the floor, so the
 * truncation lives on a span of ours around it; `className` lands there.
 */
export function SelectValue({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Value>) {
  return (
    <span className={cx('min-w-0 flex-1 truncate text-left', className)}>
      <SelectPrimitive.Value {...props} />
    </span>
  )
}

/**
 * The list. Portalled to `<body>`, so no ancestor's `overflow` can clip it —
 * the ticket card that turned scrollable around its own model menu is the bug
 * this line fixes — and `position="popper"` so the height cap can be the space
 * Radix measured between the trigger and the viewport edge rather than a
 * guessed pixel number. The viewport under it is the scroller (Radix gives it
 * `overflow: hidden auto`), so a long roster scrolls inside the menu.
 *
 * Escape stops here, as it does on `DropdownMenuContent`: Radix closes the
 * topmost layer on it, and letting the same keystroke carry on to `window`
 * would hand it to an enclosing `Dialog` — the settings dialog every one of
 * these opens inside.
 *
 * The surface states the UI default size (`text-sm`); a caller that passes
 * `text-xs` wins, because Tailwind happens to emit `text-xs` after `text-sm`.
 * Pass `font-mono` for a list of code-shaped values (model ids).
 */
export function SelectContent({
  className,
  position = 'popper',
  sideOffset = 4,
  collisionPadding = 8,
  onEscapeKeyDown,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        onEscapeKeyDown={(event) => {
          onEscapeKeyDown?.(event)
          event.stopPropagation()
        }}
        className={cx(
          FLOATING_SURFACE,
          'max-h-(--radix-select-content-available-height) min-w-32',
          className,
        )}
        {...props}
      >
        {/* At least as wide as the control it dropped from, so a row never
            reads narrower closed than open. */}
        <SelectPrimitive.Viewport className="w-full min-w-(--radix-select-trigger-width) p-1">
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

export const SelectGroup = SelectPrimitive.Group

/** The heading over a group of rows — a runtime's name. 12px medium, sentence case. */
export function SelectLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cx(FLOATING_LABEL, className)}
      {...props}
    />
  )
}

/**
 * One row. `data-highlighted` is where the keyboard *and* the pointer meet —
 * Radix marks whichever is on the row — and the check beside a chosen row is
 * what says which one is current, so the highlight and the selection never
 * argue over the same colour.
 */
const ITEM = cx(FLOATING_ITEM, FLOATING_ITEM_DEFAULT, 'justify-between gap-3 data-[state=checked]:font-medium')

export function SelectItem({
  className,
  children,
  value,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item value={toRadix(value)} className={cx(ITEM, className)} {...props}>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="inline-flex shrink-0 items-center">
        <IconCheck size={14} className="text-text!" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}
