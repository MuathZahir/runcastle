import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import {
  FLOATING_ITEM,
  FLOATING_ITEM_DANGER,
  FLOATING_ITEM_DEFAULT,
  FLOATING_ITEM_MARKED,
  FLOATING_DESCRIBED,
  FLOATING_LABEL,
  FLOATING_CAP,
  FLOATING_SCROLLBAR,
  FLOATING_SEPARATOR,
  FLOATING_SURFACE,
  cx,
} from './floating'
import { IconCheck } from '../icons'
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
 * trigger and the viewport edge, and at `--menu-max-h` beyond that, so a long
 * menu scrolls inside itself (`FLOATING_CAP`).
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
          FLOATING_CAP.dropdown,
          FLOATING_SCROLLBAR,
          'min-w-48 p-1',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

type ItemTone = 'default' | 'danger'

/**
 * One action: 32px, optional leading `icon` (16px, `text-icon`), the label,
 * and an optional trailing `kbd` hint. `tone="danger"` is the destructive row
 * (Delete, Remove) — the label in `danger-text`, the icon in `danger`. A
 * `mark` leads instead of an icon and keeps its own colours; with a
 * `description` the row is the described one ("Set all to…" on an epic).
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
  mark,
  description,
  current = false,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
  /** `danger` is the destructive row — Delete, Remove. */
  tone?: ItemTone
  /** Leading 16px icon. */
  icon?: ReactNode
  /** Trailing shortcut hint, e.g. "R" or "Ctrl K". */
  kbd?: string
  /**
   * A leading mark that keeps its own colours (a level tile), in place of
   * `icon`. With `description`, the row is the described one.
   */
  mark?: ReactNode
  /**
   * One line of what the action means, under the label: the row becomes the
   * described one (`FLOATING_DESCRIBED`) — mark, label over this line, then a
   * check when `current`. `icon` and `kbd` are not drawn on it.
   */
  description?: ReactNode
  /** A described row's check: the value this action would set is the one held now. */
  current?: boolean
}) {
  if (description !== undefined) {
    return (
      <DropdownMenuPrimitive.Item className={cx(FLOATING_ITEM, FLOATING_ITEM_MARKED, className)} {...props}>
        <div className={FLOATING_DESCRIBED.body}>
          {mark && <span className={FLOATING_DESCRIBED.mark}>{mark}</span>}
          <span className={FLOATING_DESCRIBED.words}>
            <span className={FLOATING_DESCRIBED.label}>{children}</span>
            <span className={FLOATING_DESCRIBED.description}>{description}</span>
          </span>
          <span className={FLOATING_DESCRIBED.check}>{current && <IconCheck size={14} className="text-text" />}</span>
        </div>
      </DropdownMenuPrimitive.Item>
    )
  }
  return (
    <DropdownMenuPrimitive.Item
      className={cx(
        FLOATING_ITEM,
        tone === 'danger' ? FLOATING_ITEM_DANGER : mark ? FLOATING_ITEM_MARKED : FLOATING_ITEM_DEFAULT,
        className,
      )}
      {...props}
    >
      {mark ?? icon}
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
