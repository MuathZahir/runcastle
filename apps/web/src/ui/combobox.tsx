import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from 'cmdk'
import { createContext, useContext, useState } from 'react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { IconCheck, IconSearch } from '../icons'
import { cx } from './floating'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

/**
 * The searchable value picker: one branch out of a list long enough that
 * reading it is the work (feature decision 2). A short, fixed list is `Select`;
 * a menu of actions is `DropdownMenu`.
 *
 * shadcn ships its Combobox as a recipe rather than a component — a `Popover`
 * holding a `cmdk` command list — so this module is that recipe with its parts
 * named and styled once. A call site composes `Combobox` / `ComboboxTrigger` /
 * `ComboboxContent` / `ComboboxInput` / `ComboboxList` / `ComboboxGroup` /
 * `ComboboxItem` and never re-derives the arrangement.
 *
 * The floating behaviour is `PopoverContent`'s: portalled to `<body>`, so no
 * ancestor's overflow can clip it, and capped at the height Radix measured
 * between the trigger and the viewport edge. What this file adds is a search box
 * pinned above a list that scrolls inside itself.
 *
 * Keyboard, dismissal and focus restore are cmdk's and Radix's: arrows and
 * Home/End move the active row, Enter runs it, Escape closes the layer and hands
 * focus back to the trigger. The hand-rolled branch menu this replaced committed
 * a pick on `mousedown` because an ancestor could unmount the option before its
 * click arrived; here it cannot — the row lives in the popover's own portal, so
 * a pointer-down on it is never the "outside" press that dismisses anything.
 */

/**
 * Picking a row closes the picker — single-select semantics (feature decision
 * 5), not a policy each call site should have to remember. `Popover` owns the
 * open state, so the root publishes the one function an item needs to reach it;
 * uncontrolled is the ordinary case, and a call site that passes `open` keeps
 * saying what it always said.
 */
const CloseCombobox = createContext<() => void>(() => {})

export function Combobox({
  open,
  defaultOpen = false,
  onOpenChange,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof Popover>) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen)
  const setOpen = (next: boolean) => {
    if (open === undefined) setUncontrolled(next)
    onOpenChange?.(next)
  }

  return (
    <Popover open={open ?? uncontrolled} onOpenChange={setOpen} {...props}>
      <CloseCombobox.Provider value={() => setOpen(false)}>{children}</CloseCombobox.Provider>
    </Popover>
  )
}

export const ComboboxTrigger = PopoverTrigger

/**
 * The panel: the command root inside the popover surface.
 *
 * `p-0` because the padding belongs to the two children — the search row draws
 * its own divider edge to edge, and the list pads its rows. The width floor
 * keeps a one-branch list from opening as a sliver; the ceiling is the space
 * Radix measured, so a long branch name wraps the panel to the window rather
 * than off it.
 *
 * Escape stops here, as it does on `SelectContent` and `DropdownMenuContent`:
 * Radix closes the topmost layer on it, and letting the same keystroke carry on
 * to `window` would hand it to an enclosing `Dialog` — the Quick door's, which
 * one of the branch pickers opens inside.
 */
export function ComboboxContent({
  className,
  label,
  loop = true,
  onEscapeKeyDown,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverContent> & {
  /** Names the list for assistive tech — cmdk's own `label`. */
  label?: string
  /** Arrowing past the last row returns to the first. */
  loop?: boolean
}) {
  return (
    <PopoverContent
      className={cx(
        'flex max-w-(--radix-popover-content-available-width) min-w-56 flex-col p-0',
        className,
      )}
      onEscapeKeyDown={(event) => {
        onEscapeKeyDown?.(event)
        event.stopPropagation()
      }}
      {...props}
    >
      <Command label={label} loop={loop} className="flex min-h-0 flex-col">
        {children}
      </Command>
    </PopoverContent>
  )
}

/**
 * The search row. `Command` filters the list as this types — the whole reason a
 * long list is a Combobox and not a `Select`.
 *
 * The reset is written out because there is no preflight for `input`
 * (apps/web/STYLE.md): left bare it would arrive wearing the user agent's white
 * field. The focus ring is not written out — `styles.css` paints every
 * `:focus-visible` globally.
 */
export function ComboboxInput({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof CommandInput>) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-hairline-soft px-2.5 py-2 text-text-4">
      <IconSearch size={12} className="shrink-0" />
      <CommandInput
        className={cx(
          'min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 font-mono text-sm text-text placeholder:text-text-4',
          className,
        )}
        {...props}
      />
    </div>
  )
}

/**
 * The rows. This is the scroller: capped here rather than on the panel so the
 * search row stays put while the branches move under it. `max-h-64` is the cap
 * in the common case and the panel's measured available height is the backstop
 * in a short window — whichever is smaller bites, and the list scrolls inside
 * it either way.
 */
export function ComboboxList({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof CommandList>) {
  return (
    <CommandList
      className={cx('max-h-64 overflow-y-auto overscroll-contain p-1', className)}
      {...props}
    />
  )
}

/** What the list says when the search matches nothing. */
export function ComboboxEmpty({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof CommandEmpty>) {
  return <CommandEmpty className={cx('px-2.5 py-1.5 text-text-3', className)} {...props} />
}

const GROUP_HEADING =
  'block px-2.5 pt-1 pb-0.5 font-sans text-xs tracking-[0.06em] text-text-4 uppercase'

/**
 * A headed run of rows. The heading is wrapped rather than styled through
 * cmdk's `[cmdk-group-heading]` attribute, so the class list reads as this
 * repo's utilities instead of shadcn's arbitrary-variant selectors.
 */
export function ComboboxGroup({
  heading,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof CommandGroup>, 'heading'> & { heading?: ReactNode }) {
  return (
    <CommandGroup
      heading={heading === undefined ? undefined : <span className={GROUP_HEADING}>{heading}</span>}
      {...props}
    />
  )
}

/**
 * One row. `data-selected` is cmdk's active row — where the arrow keys and the
 * pointer meet — and `current` is the value the picker already holds, marked by
 * the check beside it. The two never argue over the text colour: both land on
 * `text-text`, and only the check is drawn in the accent.
 *
 * `aria-current` rather than `aria-selected`, which cmdk owns and uses for the
 * active row.
 *
 * `onSelect` is handed cmdk's own value for the row — trimmed, and inferred from
 * the rendered text when no `value` is given — so a call site that needs the
 * exact thing it offered closes over it rather than reading the argument.
 */
const ITEM =
  'flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2.5 py-1.5 ' +
  'text-left text-text-2 transition-colors duration-(--dur-1) ease-app select-none ' +
  'data-[selected=true]:bg-accent-soft data-[selected=true]:text-text ' +
  'aria-[current=true]:text-text ' +
  'data-disabled:cursor-not-allowed data-disabled:opacity-40'

export function ComboboxItem({
  className,
  children,
  current = false,
  onSelect,
  ...props
}: ComponentPropsWithoutRef<typeof CommandItem> & {
  /** This row is the value the picker holds. */
  current?: boolean
}) {
  const close = useContext(CloseCombobox)

  return (
    <CommandItem
      aria-current={current || undefined}
      className={cx(ITEM, className)}
      onSelect={(value) => {
        onSelect?.(value)
        close()
      }}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      {current && <IconCheck size={11} className="shrink-0 text-accent-hi" />}
    </CommandItem>
  )
}
