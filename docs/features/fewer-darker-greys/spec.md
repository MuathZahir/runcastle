# Fewer, darker greys

## Problem

The app's greys are too many and too close together. Below the main text there
are three near-identical greys (secondary `#a2a8b9`, tertiary `#8a91a5`, icon
`#8990a4`), so text one level quieter reads as "a slightly different grey"
rather than "less important". The human spotted it between the chat's tool-call
lines (tertiary) and the sidebar's quieter rows (secondary). The see-through
tints behind rows have the same problem: a hovered row (3.5%) and a selected row
(2.5%) are near twins. The dark theme's grounds are also lighter and greyer than
the human wants: they asked for darker and a touch bluer, to feel more premium.

## Approach

**What the user sees.** In both themes, quiet text comes in two clearly
different greys: *secondary* for descriptions and quieter rows, *muted* for
metadata, status lines, the tool-call lines and every icon. Disabled stays as a
decorative fourth step. In the dark theme the sidebar, the content panel and the
floating layers (menus, dialogs) are darker and slightly bluer, with the same
spacing between them as today, so the frame / page / floating hierarchy reads as
before. Code blocks, the terminal and inputs sit on the sidebar's ground. The
light theme's grounds do not change. Nothing else changes: layout, spacing,
type, the accent and status colours, and every component's design stay as they
are.

**The values.** The design page `apps/web/preview/greys.html` holds the
proposal (its `GROUNDS`, `QUIET` and `fills` tables) and the human's chosen
Tweaks. Once approved, those values move into `apps/web/src/theme.css` and the
Tweaks menu goes. The recommended set, before any Tweak:

| Token | Dark today → proposed | Light today → proposed |
|---|---|---|
| `canvas` | `#0a0c11` → `#06080e` | unchanged `#f4f6f9` |
| `surface` | `#10131a` → `#0b0f17` | unchanged |
| `surface-raised` | `#161a24` → `#111621` | unchanged |
| `surface-inset` | `#0c0e14` → `var(--color-canvas)` | already the canvas value |
| `border` | `#222837` → `#1c2331` | unchanged |
| `border-strong` | `#333a4d` → `#2c3547` | unchanged |
| `text` | unchanged `#eceef4` | unchanged |
| `text-secondary` | `#a2a8b9` → `#a9b1c1` | `#596075` → `#454f62` |
| `text-tertiary` (the muted step) | `#8a91a5` → `#798294` | `#676e82` → `#677083` |
| `icon` | `#8990a4` → `var(--color-text-tertiary)` | `#7a8195` → `var(--color-text-tertiary)` |
| `text-disabled` | `#4b5163` → `#424a5b` | unchanged |
| `on-primary` | `#0a0c11` → the new canvas value | unchanged |
| `surface-hover`, `fill-card` | 3.5% / 2.5% → both 3% | 4% / 3% → both 3.5% |
| `surface-selected`, `fill-well` | unchanged 6% | unchanged 7% |

The token *names* stay: `text-tertiary` becomes the name of the muted step and
`icon` becomes an alias of it, so the hundreds of class names that use them do not
change. The values were picked in OKLCH (perceived lightness): the grounds sit
at hue 264 with a little more chroma than today, each ground 3.2 lightness
points above the last as now; both quiet greys hold at least 4.5:1 on every
dark ground, menus included, and their gap from each other grows from 1.32:1 to
1.79:1 in contrast.

**Where it lands.**

- `apps/web/src/theme.css`: the dark `@theme` block and the light block, per the
  table. The comments on the grounds and text tokens are updated to say the
  ladder is three grounds, two quiet greys plus disabled, two tint strengths.
- `apps/web/src/lib/terminal.ts`: the dark fallback tokens follow the table; the
  ANSI `black`, `white` and `brightBlack` greys (today neutral zinc) move onto
  the app's cool slate at the same lightness, in both themes. The coloured ANSI
  slots stay.
- The colour the browser and the installed phone app paint before the page
  loads (`apps/web/index.html` theme-color, `apps/web/public/manifest.webmanifest`),
  and the offline page in `apps/web/public/sw.js`, take the new canvas, text and
  secondary values.
- The plan-page starter (`packages/skills/.../feature/references/preview-starter.html`)
  takes the new dark and light tokens, so new plan pages match the app.
- `apps/web/DESIGN.md` §Colour and `apps/web/STYLE.md` §Tokens: the text rule
  becomes "text, secondary, muted (`text-tertiary`, also icons), disabled";
  inset is the canvas; the see-through tints are two strengths.
- `apps/web/test/theme-contrast.test.ts`: gains a dark-theme floor, so both
  quiet greys stay at or above 4.5:1 on canvas, surface and raised. The light
  floors it already holds keep passing.
- The README pictures and banner are retaken from
  `apps/web/preview/readme-shots.html` (added by the "Ready to publish"
  feature), as the last step. If that feature has not merged by then, merge
  `main` in once it has; if it is still open when everything else is done, the
  retake waits for it and the human is told.

The favicon, the public website (`site/`) and the old plan pages under
`docs/features/*/preview.html` keep their colours.

**Order.** One build, done by the lead in the feature's own checkout: theme
values, the sweep, the docs and the test, then the README pictures. Then one
review round that drives the app in both themes.

## Seams

- **The theme tokens** (existing): `apps/web/src/theme.css`, observed through
  `apps/web/test/theme-tokens.ts` (`resolveColour`) and
  `theme-contrast.test.ts`. The new dark floor is asserted here.
- **The design page** (new, from design mode): `apps/web/preview/greys.html`
  shows today beside the result. After the values land, its "before" and
  "after" frames should look the same in the "after" column as the app does
  with no overrides, which is the check that nothing was missed in the move.
- **The running app** (existing): a drive in dark and light over the sidebar,
  the Orchestrator chat with tool calls, a feature page with its panel, a menu
  and a dialog.

## Out of scope

- Layout, spacing, type scale, radii, motion and any component's design.
- The accent and status colours, including their tinted grounds
  (`accent-subtle` `#16213a`, `danger-subtle` `#2a1515`). The brief puts accent
  and status colours off limits; on the darker grounds they keep their hue.
- The main text colour and the primary button.
- The light theme's grounds and lines (decision 4).
- The favicon, the public website and old plan pages (decision 5).
- Moving any component from one grey to the other. Each keeps the token it
  names today; only the token values change.
- The end-of-chat waiting line (the sibling "small fixes" feature removes it).

## Open questions

- Which of the four ground strengths, and two greys or one: the human picks on
  the design page (decisions 1 and 2).
- The public website shows app pictures of its own; if they come from the
  README pictures, they will still show the old colours until the site is
  updated. That would be its own small feature.
- The tinted accent ground (`#16213a`, worn by the Orchestrator card) was
  checked on the proposed grounds and still reads as a blue tint; if the human
  finds it too bright there, it is a separate decision because the brief keeps
  accent colours out.
