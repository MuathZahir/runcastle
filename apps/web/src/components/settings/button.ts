/**
 * The browser's own button paint, off.
 *
 * `theme.css` imports Tailwind's theme and utilities but deliberately not its
 * preflight (that file's header says why), so nothing resets `<button>`: it
 * keeps Chrome's `buttonface` background, its 2px outset border and its 1px/6px
 * padding. On this near-black theme that renders as a light-grey pill with
 * text the theme coloured for a dark surface sitting on it — unreadable.
 *
 * So every button in the dialog says what it looks like. This clears the
 * surface; the border is stated separately because `border-0` sorts *after*
 * `border` in the generated sheet and would win over the border its wearer
 * asked for: a button that draws one adds `border` plus a colour, and one that
 * draws none wears {@link BARE_BUTTON}.
 */
export const PLAIN_BUTTON = 'appearance-none bg-transparent p-0'

/** {@link PLAIN_BUTTON}, for a button with no border of its own either. */
export const BARE_BUTTON = `${PLAIN_BUTTON} border-0`
