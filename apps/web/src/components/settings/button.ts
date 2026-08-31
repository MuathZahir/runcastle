/**
 * The browser's own button paint, off.
 *
 * `theme.css` imports Tailwind's theme and utilities but deliberately not its
 * preflight (that file's header says why), so nothing resets `<button>`: it
 * keeps Chrome's `buttonface` background, its 2px outset border and its 1px/6px
 * padding. On this near-black theme that is a light-grey pill wearing text the
 * theme coloured for a dark surface — light on light, unreadable. So every
 * button in the dialog states what it looks like, starting from here.
 *
 * The border is a second constant rather than part of the first because
 * `border-0` sorts *after* `border` in the generated sheet: folded in, it would
 * win over the border its wearer had just asked for.
 */

/** The paint off — background and padding. The border is the wearer's to draw. */
export const PLAIN_BUTTON = 'appearance-none bg-transparent p-0'

/** {@link PLAIN_BUTTON}, and no border either — for a button that draws none. */
export const BARE_BUTTON = `${PLAIN_BUTTON} border-0`
