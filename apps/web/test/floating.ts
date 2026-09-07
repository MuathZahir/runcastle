import { fireEvent } from '@testing-library/react'

/**
 * Drop a `DropdownMenu` open.
 *
 * Radix opens a menu on the pointer down rather than the click — that is what
 * lets a press-and-drag land on an item in one gesture — so `fireEvent.click`
 * on the trigger does nothing at all. Every tier-2 test that drives one of the
 * app's action menus goes through here, so the reason is written once instead
 * of looking like a typo in four files.
 */
export function openMenu(trigger: HTMLElement): void {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
}
