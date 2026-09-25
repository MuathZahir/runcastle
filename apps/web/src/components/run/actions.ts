/**
 * A ghost button that says it destroys something: Stop ticket, Cancel run, End
 * session. No border and no fill at rest (it sits in a row of ghosts), the word
 * and glyph in `danger`, the `danger-subtle` ground on hover.
 *
 * Local because `Button` has no ghost-danger variant yet; the `!` is what lets
 * these win over the ghost variant's own `text-secondary` / `surface-hover`,
 * which Tailwind emits later for the same properties.
 */
export const DANGER_GHOST = 'text-danger! enabled:hover:bg-danger-subtle! enabled:hover:text-danger!'
