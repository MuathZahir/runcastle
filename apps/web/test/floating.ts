import { fireEvent, screen } from '@testing-library/react'

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

/**
 * Pick a row out of a `Select`, by the text that row reads out.
 *
 * A `Select` is no longer a native `<select>`, so `fireEvent.change` on the
 * trigger sets nothing: the rows live in a portal that only exists while the
 * list is open. Every test that drives one goes through here. Unlike a menu, a
 * select trigger *does* answer a click — Radix opens it on the pointer down
 * only once it has seen a mouse.
 */
export function pickOption(trigger: HTMLElement, option: string | RegExp): void {
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('option', { name: option }))
}
