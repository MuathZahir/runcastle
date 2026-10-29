# The whole app matches the sidebar

## Problem

The project sidebar was redesigned toward a calm, roomy look: 14px row titles,
soft see-through hover and selection with a hairline edge, generous rows. The
rest of the app was not. Beside it, every content screen reads tighter and
harder: 13px rows, solid light blocks for hover and selection, 28px controls,
30px menu rows. Dropdowns are the worst of it: a menu with many items (the
scenarios dropdown, the thread dropdown) grows all the way to the bottom of the
screen.

Five screen features (the chat, the feature's right panel, test drive, the
Orchestrator's page, the rest of the app) wait on this one to restyle their
layouts. They need one shared look to build on, landed once.

## Approach

**For the user:** every screen picks up the sidebar's material at once,
because the change is made in the theme and the shared building blocks every
screen is drawn from. Rows, menus and pickers read at the sidebar's 14px.
Hovering anything is a faint shade; a selected row or tab is the same card the
selected sidebar row is. Buttons and fields are a little taller. Long
dropdowns stop at about ten rows and scroll. The sidebar
itself looks the same, now drawn from the same shared pieces.

**The shape:**

- **Theme tokens** (the one token file, `theme.css`; decisions 2–6, 9):
  - Hover and selected grounds become see-through shades of the text colour
    (`surface-hover` ≈ 3.5% dark / 4% light, `surface-selected` 6% / 7%), so
    every existing use across the screens softens with no edit. New
    `fill-card` (2.5% / 3%) and `fill-well` (6% / 7%) grounds, and a `card`
    utility — `fill-card` plus a hairline edge drawn inside — that is the
    sidebar's card recipe, named once.
  - A sixth type step, `md` 14/20, for every row.
  - Metrics: `--control-h` 32, `--control-lg` 36, `--row-h` 36, and new
    `--list-row-h` 44, `--menu-item-h` 32, `--menu-max-h` 360px.
    `--control-sm` stays 24 (decision 10).
- **Shared building blocks** (`src/ui/`, `ui.tsx`):
  - `NavItem`, `ListRow`, `Tabs`: selected wears `card`, hover is
    `surface-hover`, labels at `md`, rows on their own at 10px corners; hover
    never changes a selected row (decision 11). `ListRow` takes
    `--list-row-h`.
  - The floating family (`floating.ts`, dropdown menu, select, combobox): rows
    at `--menu-item-h` and `md`, a little more side padding, a thin scrollbar,
    and one shared cap: the smaller of the space Radix measured and
    `--menu-max-h` (decisions 5, 8). The panel itself is unchanged.
  - `Button`: a little more side padding at md and lg; heights come from the
    tokens. `Dialog` header, body and footer get more padding.
- **The sidebar** (`SidebarParts`, `Sidebar`): its hand-written colour mixes
  and 14px text move onto `surface-hover`, `card`, `fill-well` and `md`, with
  no visible change. The grain behind its head is untouched (decision 12).
- **Screens** change only where they hand-copy the old look in a way that now
  clashes (decision 7). Their layouts belong to the screen features.
- **The design guide** (`DESIGN.md`, `STYLE.md`): the general rules are
  amended (decision 1): the card, see-through hover and selection, the `md`
  step, the new metrics and the menu cap become app-wide rules; the sidebar
  notes keep only its own exceptions (the Orchestrator wash, the orbit light,
  the count well).
- **Tests** that pin the old classes move with them (the selected-row and
  selected-tab assertions now look for `card`), and the light contrast check
  learns to blend a see-through ground over the canvas before measuring.

**Designed in design mode** (approved by the human, committed):
`apps/web/preview/kit.html` (the building blocks: buttons, fields, tabs, rows,
a 30-item scenarios menu, a long model select, a dialog) and
`apps/web/preview/app.html` (the real app — sidebar and the Orchestrator's
page — on sample data). Most of the build above is in that design work; what
remains is the guide, the tests and the sweep for clashing hand-copies.

## Seams

- **The token file** (existing): the values and the light block, read by
  the existing contrast test through its token reader. Observes that every
  word colour still clears its floor on the new see-through grounds.
- **The primitives' rendered markup** (existing, `test/ui.test.ts` and
  friends): a selected `NavItem` / `ListRow` / tab carries `card`; rows carry
  the `md` step and their height tokens; a dropdown, select and combobox carry
  the `--menu-max-h` cap.
- **The preview pages** (new, design mode): the look itself, judged by eye in
  both themes and both densities. These are what the human approves.

## Out of scope

- Each screen's own layout: the chat, the feature's right panel, test drive,
  the Orchestrator's page and the remaining screens are their own features,
  which start once this merges.
- The film grain behind the sidebar head: another feature owns it
  (decision 12).
- The thread switcher: it is being removed by "Threads in the sidebar". Its
  dropdown gets the height cap for free until then.
- Any new behaviour.
- New colours, fonts, backgrounds or corner sizes (decision 9).
- The page header's height and the page column's widths and padding: they
  are screen layout.

## Open questions

None left. The one this spec raised, a mono-font list losing to the panel's
own sans face, was a one-line fix: the floating panel no longer names a face
(the body's is sans), so a caller's `font-mono` is the only one stated.
