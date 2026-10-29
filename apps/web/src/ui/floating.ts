/**
 * What every primitive in `src/ui/` shares: the join helper and the classes a
 * floating layer and its rows wear.
 *
 * These components are adapted from shadcn's floating family, but only its
 * markup and its Radix wiring — the styling idiom is this repo's
 * (apps/web/STYLE.md): Tailwind utilities written inline on the theme tokens,
 * variants as lookup maps, and `cx()` as the whole of the variant machinery.
 * `clsx`, `cva` and `tailwind-merge` stay out.
 *
 * Focus rings are deliberately absent here too: `styles.css` sets the
 * `:focus-visible` outline globally and unlayered (and switches it off for
 * menu rows and options, which show their highlight ground instead).
 */

/**
 * Join the parts that are present. Falsy branches drop out. `ui.tsx` imports
 * this one rather than keeping a copy.
 *
 * Join order is the caller's contract: a `className` passed in comes last, so
 * a consumer's utility is the later declaration and wins.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * The look of a floating layer — menus, popovers, selects, the combobox:
 * `surface-raised`, `rounded-lg`, `shadow-popover` (whose first ring is the
 * hairline, so no border is drawn), text at the UI default, and the pop-in
 * entrance from the corner Radix measured (DESIGN.md §Motion).
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
  'z-[300] overflow-y-auto overscroll-contain [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin] rounded-lg bg-surface-raised font-sans text-sm text-text shadow-popover animate-pop-in'

/**
 * One row of a floating list (menu item, select option, combobox row): 32px
 * (`--menu-item-h`) at the row size (`text-md`, 14px) as the sidebar's rows,
 * icon + label + trailing slot, `surface-hover` where the keyboard or pointer
 * is. Radix marks that row `data-highlighted`; cmdk marks it
 * `data-selected=true` — both are covered so every list lights the same way.
 * Icons inside take the `icon` colour; a trailing `Kbd` pushes itself right
 * with `ml-auto`. A disabled row: Radix writes `data-disabled=""` only on one;
 * cmdk writes `data-disabled` on every row, `"true"` or `"false"`, so only
 * the attribute's value can say.
 */
export const FLOATING_ITEM =
  'flex min-h-(--menu-item-h) w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1 text-left text-md ' +
  'transition-colors duration-(--dur-1) ease-app select-none [&_svg]:shrink-0 ' +
  "data-[disabled='']:cursor-not-allowed data-[disabled='']:opacity-50 " +
  'data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50'

/**
 * The row's colours, one of these two beside {@link FLOATING_ITEM} — kept apart
 * so a destructive row never has two text colours competing on one element.
 */
export const FLOATING_ITEM_DEFAULT =
  'text-text [&_svg]:text-icon ' +
  'hover:bg-surface-hover data-highlighted:bg-surface-hover data-[selected=true]:bg-surface-hover'

/** The destructive row (Delete, Remove): the label in `danger-text`, the icon in `danger`. */
export const FLOATING_ITEM_DANGER =
  'text-danger-text [&_svg]:text-danger hover:bg-danger-subtle data-highlighted:bg-danger-subtle'

/** The group heading inside a floating list: 12px medium, sentence case. */
export const FLOATING_LABEL =
  'block px-2.5 pt-2 pb-1 font-sans text-xs font-medium text-text-tertiary'

/** A hairline between groups, bleeding to the panel's edges. */
export const FLOATING_SEPARATOR = '-mx-1 my-1 h-px bg-border-subtle'

/**
 * The height cap every floating list wears: the space Radix measured between
 * the trigger and the screen's edge, but never more than `--menu-max-h`, so a
 * long list (forty threads, thirty scenarios) stops at ten rows and scrolls
 * inside itself instead of running to the bottom of the screen. Spelled whole
 * per primitive, since each Radix part names its own measured variable.
 */
export const FLOATING_CAP = {
  dropdown: 'max-h-[min(var(--radix-dropdown-menu-content-available-height),var(--menu-max-h))]',
  select: 'max-h-[min(var(--radix-select-content-available-height),var(--menu-max-h))]',
} as const
