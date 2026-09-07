/**
 * What every primitive in `src/ui/` shares: the join helper and the one surface
 * a floating layer wears.
 *
 * These components are adapted from shadcn's floating family, but only its
 * markup and its Radix wiring — the styling idiom is this repo's
 * (apps/web/STYLE.md, feature decision 3): Tailwind utilities written inline on
 * the theme tokens, variants as lookup maps, and `cx()` as the whole of the
 * variant machinery. `clsx`, `cva` and `tailwind-merge` stay out.
 *
 * Focus rings are deliberately absent here too: `styles.css` sets
 * `:focus-visible { box-shadow: var(--ring) }` globally and unlayered.
 */

/**
 * Join the parts that are present. Falsy branches drop out. The same helper
 * `ui.tsx` keeps private; when that file eventually folds into this directory
 * it drops its copy for this one.
 *
 * Join order is the caller's contract: a `className` passed in comes last, so
 * a consumer's utility is the later declaration and wins.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * The look of a floating layer: the panel the hand-rolled menus each drew for
 * themselves, now stated once.
 *
 * `z-[300]` is the whole reason these are primitives and not `absolute` divs.
 * Radix portals the content to `<body>`, so it can never be clipped by an
 * ancestor's overflow — but a portalled layer also has to say where it sits
 * against the other portalled layer in this app: `Dialog`'s backdrop is
 * `z-[200]` (`ui.tsx`). A menu opened from inside settings must float over that
 * backdrop, so it sits one band above it, and every floating layer takes the
 * same band rather than each picking a number.
 */
export const FLOATING_SURFACE =
  'z-[300] overflow-y-auto rounded-md border border-hairline bg-panel-3 shadow-menu'
