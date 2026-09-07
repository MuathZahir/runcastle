import * as PopoverPrimitive from '@radix-ui/react-popover'
import type { ComponentPropsWithoutRef } from 'react'
import { FLOATING_SURFACE, cx } from './floating'

/**
 * A floating panel anchored to a trigger — the general one, and the foundation
 * the searchable Combobox is built on (feature spec, decision 2).
 *
 * Compound, shadcn-style: the caller composes `Popover` / `PopoverTrigger` /
 * `PopoverContent` and everything a Radix part accepts is forwarded. What this
 * module adds is the portal (always — content that can be clipped by an
 * ancestor is the bug this feature exists to fix), the theme surface, and the
 * height cap.
 */

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
/** Positions the content against something other than the trigger. */
export const PopoverAnchor = PopoverPrimitive.Anchor
export const PopoverClose = PopoverPrimitive.Close

/**
 * The panel. Portalled to `<body>`, so no ancestor's `overflow` can clip it,
 * and capped at the height Radix measured between the trigger and the viewport
 * edge — which is what makes a long list scroll inside itself instead of
 * running off the screen. `p-1` is the menu-ish default; a panel holding prose
 * passes its own padding.
 */
export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 4,
  collisionPadding = 8,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cx(
          FLOATING_SURFACE,
          'max-h-(--radix-popover-content-available-height) min-w-32 p-1',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
