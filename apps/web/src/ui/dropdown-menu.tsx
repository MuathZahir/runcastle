import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import {
  FLOATING_ITEM,
  FLOATING_ITEM_DANGER,
  FLOATING_ITEM_DEFAULT,
  FLOATING_LABEL,
  FLOATING_SEPARATOR,
  FLOATING_SURFACE,
  cx,
} from './floating'
import { Kbd } from './kbd'

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
          'max-h-(--radix-dropdown-menu-content-available-height) min-w-48 p-1',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

type ItemTone = 'default' | 'danger'

/**
 * One action: 30px, optional leading `icon` (16px, `text-icon`), the label,
 * and an optional trailing `kbd` hint. `tone="danger"` is the destructive row
 * (Delete, Remove) — label and icon in `danger`.
 *
 * Highlight, not hover: Radix marks the item the keyboard *or* the pointer is
 * on with `data-highlighted`, so arrowing down and moving the mouse light the
 * same row.
 */
export function DropdownMenuItem({
  className,
  tone = 'default',
  icon,
  kbd,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
  /** `danger` is the destructive row — Delete, Remove. */
  tone?: ItemTone
  /** Leading 16px icon. */
  icon?: ReactNode
  /** Trailing shortcut hint, e.g. "R" or "Ctrl K". */
  kbd?: string
}) {
  return (
    <DropdownMenuPrimitive.Item
      className={cx(FLOATING_ITEM, tone === 'danger' ? FLOATING_ITEM_DANGER : FLOATING_ITEM_DEFAULT, className)}
      {...props}
    >
      {icon}
      {kbd ? <span className="min-w-0 flex-1 truncate">{children}</span> : children}
      {kbd && <Kbd className="ml-auto">{kbd}</Kbd>}
    </DropdownMenuPrimitive.Item>
  )
}

/** The heading over a group of items: 12px medium, sentence case. */
export function DropdownMenuLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cx(FLOATING_LABEL, className)}
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
      className={cx(FLOATING_SEPARATOR, className)}
      {...props}
    />
  )
}
