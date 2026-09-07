import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import type { ComponentPropsWithoutRef } from 'react'
import { FLOATING_SURFACE, cx } from './floating'

/**
 * The app's action menu — the kebab, the breadcrumb switcher, the docs picker.
 * Compound and shadcn-style: `DropdownMenu` / `DropdownMenuTrigger` /
 * `DropdownMenuContent` / `DropdownMenuItem`, with every Radix prop forwarded.
 *
 * A menu here is a menu of *actions*, not a value picker — a picker is `Select`
 * or `Combobox` (feature decision 2).
 */

/**
 * Non-modal by default. Radix's modal menu makes the rest of the document
 * `inert` — `aria-hidden` on every sibling of the portal, `pointer-events:
 * none` on the body, and the scroll locked. Each menu this primitive replaced
 * was a plain absolute div that did none of that, and one of them opens from
 * inside `Dialog`'s portal, which a blanket `aria-hidden` would hide from a
 * screen reader while its own menu is open. Dismissal does not depend on it:
 * outside pointer-downs and Escape close a non-modal layer just the same.
 */
export function DropdownMenu({
  modal = false,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root modal={modal} {...props} />
}

export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
export const DropdownMenuGroup = DropdownMenuPrimitive.Group

/**
 * The menu surface. Portalled to `<body>`, so no ancestor's `overflow` can clip
 * it — the ticket card that turned scrollable around its own model menu is the
 * bug this line fixes — and capped at the height Radix measured between the
 * trigger and the viewport edge, so a long menu scrolls inside itself.
 *
 * Escape stops here. Radix listens for it on the document in the capture phase
 * and closes the topmost layer; letting it carry on to `window` would hand the
 * same keystroke to an enclosing `Dialog`, which would close underneath the
 * menu the key was meant for.
 */
export function DropdownMenuContent({
  className,
  align = 'start',
  sideOffset = 4,
  collisionPadding = 8,
  onEscapeKeyDown,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        onEscapeKeyDown={(event) => {
          onEscapeKeyDown?.(event)
          event.stopPropagation()
        }}
        className={cx(
          FLOATING_SURFACE,
          'max-h-(--radix-dropdown-menu-content-available-height) min-w-32 p-1 font-mono text-xs',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

type ItemTone = 'default' | 'danger'

/**
 * Highlight, not hover: Radix marks the item the keyboard *or* the pointer is
 * on with `data-highlighted`, so arrowing down and moving the mouse light the
 * same row. `hover:` rides along for the pointer-only case a headless library
 * cannot see (an item rendered under a pointer that never moves).
 */
const ITEM_TONE: Record<ItemTone, string> = {
  default:
    'text-text-2 hover:bg-accent-soft hover:text-text data-highlighted:bg-accent-soft data-highlighted:text-text',
  danger: 'text-danger hover:bg-danger/12 data-highlighted:bg-danger/12',
}

const ITEM_BASE =
  'flex w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-left ' +
  'transition-colors duration-(--dur-1) ease-app select-none ' +
  'data-disabled:cursor-not-allowed data-disabled:opacity-40'

export function DropdownMenuItem({
  className,
  tone = 'default',
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
  /** `danger` is the destructive row — Delete, Remove. */
  tone?: ItemTone
}) {
  return (
    <DropdownMenuPrimitive.Item
      className={cx(ITEM_BASE, ITEM_TONE[tone], className)}
      {...props}
    />
  )
}

/** The uppercase micro-label over a group of items. */
export function DropdownMenuLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cx('px-2.5 py-1.5 text-xs tracking-[0.08em] text-text-4 uppercase', className)}
      {...props}
    />
  )
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cx('my-1 h-px bg-hairline-soft', className)}
      {...props}
    />
  )
}
