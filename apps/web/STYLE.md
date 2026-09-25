# apps/web style guide

How this app is styled and tested, and how the pre-Tailwind stylesheet is being
retired. Read this before changing anything visual in `apps/web`.

This supersedes `docs/UI-SPEC.md` §4 (primitives). The rest of UI-SPEC — the user
stories, the shell layout, the terminal — still stands.

## Tokens & scale

`src/theme.css` is the **single token source**. Its `@theme static` block holds
every token with its **dark** value; a `:root[data-theme="light"]` block right
under it restates the base colours (and the two elevations) for the **light**
theme. `src/styles.css` is only the document base (body, scrollbar, focus ring)
— never add a token or a rule to it. The values are the Runcastle Design System's
(`tokens.json`); what they add up to is `DESIGN.md`.

Tokens sit under Tailwind's namespaces, so declaring one generates its utility:

| Namespace | Tokens | Utilities |
|---|---|---|
| `--color-*` grounds | `canvas`, `surface`, `surface-raised`, `surface-hover`, `surface-selected`, `surface-inset`, `scrim` | `bg-surface`, `bg-surface-hover`, `bg-scrim` |
| `--color-*` lines | `border`, `border-subtle` (translucent, so it reads on every ground — `surface-raised` included), `border-strong` | `border-border-subtle` |
| `--color-*` text | `text`, `text-secondary`, `text-tertiary`, `text-disabled`, `icon` | `text-text-secondary`, `text-icon` |
| `--color-*` action | `primary`, `primary-hover`, `on-primary`, `accent`, `accent-text`, `accent-subtle`, `focus-ring` | `bg-primary`, `text-accent-text` |
| `--color-*` status | `success`, `warning`, `danger`, `danger-subtle` | `text-success`, `bg-danger-subtle` |
| `--color-phase-*` | `draft`, `ideation`, `spec`, `planning`, `tickets`, `implementation`, `building`, `review`, `shipped` | `text-phase-review` |
| `--font-*` | `sans` (Geist Variable), `mono` (Geist Mono Variable) — Fontsource, imported in `main.tsx` | `font-mono` |
| `--text-*` | `xs` 12/16 · `sm` **13/20, the UI default** · `base` 14/22 prose · `lg` 16/24 section title · `xl` 22/28 page title | `text-sm`, `text-xl` |
| `--radius-*` | `sm` 4 (kbd) · `md` 6 (controls, rows) · `lg` 10 (panel, menus, dialogs) · `full` (dots only) | `rounded-md` |
| `--shadow-*` | `popover`, `dialog` — floating layers only | `shadow-popover` |
| `--ease-*` | `app` (state changes), `out-app` (entering) | `ease-out-app` |
| `--animate-*` | `rise-in`, `fade-in`, `pop-in`, `dialog-in`, `backdrop-in`, `slide-in-right`, `toast-in`, `breathe`, `spin` | `animate-rise-in` |

The phase tokens are `var()`s onto `icon` / `warning` / `accent` / `success` /
`text-disabled`, and `planning` / `building` are the app's own `Phase` names
(spec's and implementation's hue). `focus-ring` is `accent`.

**No deprecated aliases remain.** The pre-redesign names (`bg`, `panel*`,
`hairline*`, `text-2/-3/-4`, `accent-hi/-2/-ink/-soft/-line`, `ph-*`, `needs`,
`warn`, `ok`, `drive`, `rounded-pill`, `shadow-menu`, `shadow-overlay`) were
migrated and their alias block deleted; they no longer resolve.

Tailwind's own colour, type, radius and shadow scales are switched off
(`--color-*: initial` and friends): `bg-red-500` and `text-3xl` do not resolve,
by design. No raw hex, no `rgba()`, no arbitrary colours in components.

Metrics are un-namespaced and read with `var()` or an arbitrary value
(`h-(--control-h)`): `--control-sm` 24 · `--control-h` 28 · `--control-lg` 32,
`--row-h` 32, `--topbar-h` 44, `--sidebar-w` 248, `--inspector-w` 320,
`--aside-w` 380, `--content-max` 760, `--content-wide` 1040 (plus the older
`--maprail-w`, `--artifact-w`, `--chat-panel-w`, `--notes-rail-w`), and
`--dur-1/-2/-3` = 120/180/240ms. Spacing is Tailwind's **default 4px scale** —
no custom spacing tokens.

### Themes

Dark is the default; light is a full peer. `src/lib/theme.ts` owns it: the
preference (`dark` · `light` · `system`) lives in `localStorage`
(`runcastle.theme`), `applyStoredTheme()` paints `<html data-theme>` at the top
of `main.tsx` before the first render, and a `system` preference follows
`prefers-color-scheme` live. A toggle uses `useTheme()` →
`{ preference, resolved, setPreference, toggle }`. There is **no `dark:`
variant**: a component names one token and both themes follow, because
`@theme static` compiles `bg-surface` to `var(--color-surface)` and the light
block redefines the variable. (Shadows go through `--elevation-*` for the same
reason — Tailwind inlines a literal shadow at build time.)

### Focus and motion

Focus is one 2px `focus-ring` outline at 2px offset, set globally and unlayered
in `styles.css` (`:focus-visible:not(input, textarea, select)`), so no utility
can switch it off. Text fields are the exception: their ring is drawn *on*
their border from `theme.css`'s base layer, so a field that shows focus another
way can say `outline-none` (a `TextField` draws it on its wrapper). Menu rows,
options and `tabindex="-1"` panels show none — their highlight is their ground.

Motion is transform and opacity only, from the named `animate-*` utilities; the
`prefers-reduced-motion` switch in `theme.css` turns all of it off. A
`<details data-disclosure>` animates its height (`interpolate-size` +
`::details-content`).

### Two things Tailwind does here that will surprise you

- **No preflight — except for a slice.** `theme.css` imports the theme and
  utilities layers but not Tailwind's base reset (it was kept out while the
  legacy sheet lived: `ol, ul { list-style: none }` alone strips every markdown
  bullet). What `theme.css` hand-writes in `@layer base` instead: `button` (no
  UA chrome; inherits font and colour) and `input, textarea, select` (inherit
  the app's face). Every utility beats it. Everything else is un-reset — style
  what you render. With the legacy sheet gone, turning preflight on is now a
  separate, deliberate change (it would need the Markdown lists re-checked).
- **Two utilities for one property are a coin flip.** Tailwind orders its
  output by its own rules, not by the order you wrote the classes, so
  `px-2 px-0` or `relative absolute` on one element does not mean "the last
  one wins". That is why the className rule below exists — a primitive states
  nothing a caller might want to change, and variants are lookup maps rather
  than overrides. Never reach for `!`.

## Primitives

**Import every primitive from `src/ui.tsx`** — it holds the older ones and
re-exports the rest from `src/ui/` (one concern per file: `button.tsx`,
`status.tsx`, `list.tsx`, `tabs.tsx`, `field.tsx`, `page.tsx`, `kbd.tsx`,
`tooltip.tsx`, and the four floating ones). Icons and `PhaseIcon` are in
`src/icons.tsx`. Build a missing primitive there rather than styling the same
thing twice in two surfaces; never hand-roll a button, row, chip, menu, dialog,
tab set or empty state in a surface. What each should look like is `DESIGN.md`.

**The className rule.** A primitive's root never states `position`, `margin`,
`z-index` or its outer width — those *place* it, and a caller's `className`
owns them (`absolute top-3 right-3`, `-ml-2`, `self-start` just work). What a
primitive *is* — height, padding, colour, border — comes from its props
(`size`, `variant`, `tone`); a caller never restyles it through `className`,
and never with `!`. When a look is missing, add a variant to the primitive.
(The exceptions state `relative` for their own overlays: `ListRow` / `NavItem`
for hover actions, `IconButton` only while it carries a `badge`.)

How they are styled: Tailwind utility classes written inline in the TSX,
variants as lookup maps composed by `cx()` (exported from `ui.tsx`). No `@apply`
component classes and no runtime styling dependency; `clsx`, `cva` and
`tailwind-merge` are deliberately absent. `@utility` in `theme.css` is the
escape hatch for what utilities cannot express (`animate-pop-in`, which also
sets the Radix transform origin).

### Floating primitives (`src/ui/`)

Anything that floats — a menu, a value picker, a searchable list, a tooltip —
is one of `popover.tsx`, `dropdown-menu.tsx`, `select.tsx`, `combobox.tsx`,
`tooltip.tsx`. Do not hand-roll another absolutely-positioned panel: the app had
five and every one was clipped by an ancestor's overflow or ran off the page.

They are shadcn's floating family on the per-primitive Radix packages and
`cmdk`, restyled: portals, collision-aware positioning, focus traps and keyboard
nav are where hand-rolling fails.

What they share (`src/ui/floating.ts`): `FLOATING_SURFACE` — `surface-raised`,
`rounded-lg`, `shadow-popover` (its first ring is the hairline), `text-sm`,
`animate-pop-in`, and `z-[300]`, one band above `Dialog`'s `z-[200]` so a
picker opened inside settings floats over its backdrop — and the row classes
`FLOATING_ITEM` + `FLOATING_ITEM_DEFAULT` | `FLOATING_ITEM_DANGER` (30px,
icon + label + trailing slot, `surface-hover` where the keyboard or pointer
is), `FLOATING_LABEL` (12px medium group heading) and `FLOATING_SEPARATOR`.
Each content part portals to `<body>`, caps itself at the height Radix
measured, and stops Escape so the keystroke that closes it does not also close
the dialog around it.

| Primitive | What it is | Notes |
|---|---|---|
| `Popover` | An anchored panel — and the Combobox's foundation. | `PopoverContent` pads `p-1`; pass your own for prose. |
| `DropdownMenu` | A menu of **actions**, not a value picker. | `DropdownMenuItem` takes `icon`, `kbd`, `tone="danger"`; plus `DropdownMenuLabel`, `DropdownMenuSeparator`. |
| `Select` | A grouped single-select over a short, fixed list. `value=""` means *unset* and is translated at the primitive's edge. Two trigger looks: `SELECT_FIELD` (a form field) and `SELECT_GHOST` (quiet, inline in a row or bar — the ticket model, the run history). `SelectValue` truncates (Radix drops its `className`, so the primitive wraps it). Pass `font-mono` on `SelectContent` for model ids. |
| `Combobox` | A single-select whose list is long enough to want searching. | `ComboboxItem current` marks the held value. |
| `Tooltip` | A label after 400ms hover, or on focus. `TooltipProvider` is mounted once in `main.tsx` (a stray tooltip brings its own). | `label`, `kbd`, `side`. Every `IconButton` has one. |

### Catalogue

Every prop list below is the contract; the JSDoc on each export says the same.

**Actions**

| Primitive | Props | Notes |
|---|---|---|
| `Button` | `variant` `primary` · `secondary` (default) · `ghost` · `danger` · `danger-ghost` (a destructive action in a row of ghosts: no border, `danger` word, `danger-subtle` hover); `size` `sm` 24 · `md` 28 (default) · `lg` 32; `icon` (leading); `kbd`; `loading`; every `<button>` attribute and `ref`. | Legacy `variant="solid"` → primary, `"accent"` → secondary, `size="xs"` → sm. `type` defaults to `button`. `loading` swaps the icon for a spinner (or overlays one, keeping the width) and disables. Carries `data-variant`. **At most one `primary` per view.** |
| `IconButton` | `label` (required: tooltip + `aria-label`), `icon` (or children), `size`, `variant` (default `ghost`; `danger-ghost` = quiet at rest, `danger` on hover — a row's Delete), `active` (→ `aria-pressed`), `kbd`, `tooltipSide`, `href` + `target` / `rel` (renders an `<a>`; `_blank` gets `noreferrer noopener`), `badge` (a small neutral count in the corner, `99+` cap, nothing at 0; read out as "Label (N)"), button attributes and `ref`. | The chrome button. Can be a Radix `asChild` trigger. |
| `LINK` | — | The one link look for an `<a>` or a link-like `<button>` in text: `accent-text`, underline on hover. Markdown links use it too. |
| `Kbd` | children, `className`. | One key or a short chord. |
| `Spinner` | `size` `md` · `sm`; `tone` `quiet` (default) · `current`. | `aria-hidden`; only beside a word. Legacy tones `work`/`accent` render quiet. |

**Status** (facts are text, not boxes)

| Primitive | Props | Notes |
|---|---|---|
| `StatusDot` | `tone` `success` · `warning` · `danger` · `accent` · `live` · `neutral`; `label`. | 6px. `live` breathes. With `label` it is `role="img"`; without, decorative. |
| `StatusLabel` | children (the word); `tone`; or `icon` (tone-coloured) / `phase` / `spinning`; `size` `xs` (default) · `sm`; `strong`; `title`. | What every former chip is now. |
| `PhaseIcon` (icons.tsx) | `phase` (`Phase` or `draft` · `ideation` · `spec` · `tickets` · `implementation`); `size`; `label` (`''` = decorative); `className`. | Shape first: dashed ring · ring · ¼ · ½ · ¾ · ring+dot · filled check. The fill sweeps on a phase change. `PHASE_TEXT`, `PHASE_NAME` maps exported. |
| `PhaseTag` · `PhaseDot` | `phase`. | PhaseIcon + sentence-case name · the glyph alone at 14px. |
| `TicketStatusChip` · `RunStatusChip` · `FindingSeverityChip` · `TicketKindChip` · `NoteAuthorChip` | unchanged. | Rendered as `StatusLabel`s in sentence case. `TicketKindChip` / `NoteAuthorChip` render nothing for the default kind/author. |
| `SessionStatusDot` | `status`. | A dot with a `title` (not an accessible name). |
| `CheckLine` | `row: CheckRow`. | One review figure as a property row. |

**Rows and facts**

| Primitive | Props | Notes |
|---|---|---|
| `SectionLabel` | children, `count`, `action`, `className`, `id`. | 12px medium sentence case; the count in plain `text-tertiary`. `SectionTitle` renders exactly the same. |
| `NavItem` | `label`; `icon` or `phase`; `meta`; `dot` (tone); `active`; `href` or `onClick`; `actions` (hover/focus-revealed); `onContextMenu`; `onDoubleClick`; `tone` `default` · `quiet` (28px `text-xs` tertiary, no glyph, words lined up under the labels — "Show all (N)"); `title`; `className`. | 32px sidebar row. |
| `ListRow` | `title`; `leading` (a 16px minimum box — a thumbnail takes its own); `subtitle` (inline); `description` (a second line, 12px tertiary); `wrap` (the title wraps — prose); `meta`; `onClick` or `href`; `tooltip`; `label` (accessible name) / `expanded` (`aria-expanded`); `control` (an interactive thing beside the row's button, never inside it; `meta` follows it); `actions` (hover/focus-revealed) + `actionsOverlay` (float over the meta, which fades, instead of reserving width); `active`; `index` (stagger for the first 8 of an initial render); `animate`; `as` `div` · `li` · `article`; `className`. | 40px content row: conversations, projects, tickets, notes. |
| `List` | `divided`, `label`, `className`, children. | `divided` rules rows with `border-subtle`. |
| `PropertyList` | `items: { label, value, sub?, leading? \| tone? \| phase?, mono? }[]`. | Two quiet columns. |
| `MetaLine` | `items: ({ text?, strong?, tone? \| icon? \| phase?, mono?, title? } \| false \| null)[]`. | One line of 2–4 facts. |
| `Tabs` | `items: { id, label, icon?, count?, disabled?, panelId? }[]`, `value`, `onChange`, `size` `sm` · `md`, `label`. | ARIA tablist, roving tabindex, ←/→/Home/End. |
| `Disclosure` | `title`, `icon`, `aside`, `defaultOpen`, `bare`, `size` `md` · `sm`, `index` / `animate` (entrance stagger), `onToggle`, `className`, `bodyClassName`, children. | Closed by default; animated height; rotating chevron. `md`: a 40px section row with a rule above. `sm`: a compact 12px line (tool calls, "What the engine reported", a defect's detail), no rule, the title wraps. |
| `SegmentedControl` | `items: { value, label, icon?, disabled? }[]`, `value`, `onChange`, `label` (the group's name), `size` `sm` · `md`, `id`, `className`. | One of a few values, all visible (Theme). A radio group: roving tabindex, arrows / Home / End move *and* choose; the raised thumb slides. |
| `Checkbox` | `checked`, `onChange(checked)`, `label`, `disabled`, `size` `sm` · `md`, `id`, `aria-label`, `className`. | A native checkbox on the tokens (`border-strong` box; `primary` fill + check when on); the label toggles it. No raw `type="checkbox"` elsewhere. |
| `Switch` | `checked`, `onChange(checked)`, `label`, `disabled`, `id`, `aria-label`, `className`. | `role="switch"`, a sliding thumb; on = `primary`. For a setting that applies at once. |
| `EmptyState` | `title`, `icon`, `hint`, `action`, `compact`, `className`. | No frame, no icon chip. |

**Fields**

| Primitive | Props | Notes |
|---|---|---|
| `TextField` | every `<input>` attribute and `ref`; `icon`, `kbd`, `trailing`, `size` `md` · `lg`, `mono`, `invalid`, `inputClassName`. | `className` styles the wrapper. |
| `SearchField` | as TextField, minus `icon`; `size` defaults to `lg`. | |
| `TextArea` | every `<textarea>` attribute; `mono`, `invalid`. | |
| `TEXT_INPUT` | — | The class list for a bare `<input>` a surface already owns. |
| `Field` | `label`, `labelAside`, `help`, `error`, `htmlFor`, `layout`, one control child. | Wires the ids; the error is `role="alert"`. |

**Frame** (every surface lays out with these)

| Primitive | Props | Notes |
|---|---|---|
| `PageTopbar` | `crumbs` (`Crumb[]`) or `leading`; `tabs`; `actions`. | 44px, `border-subtle` under it. |
| `Crumbs` | `items: { label, icon?, onClick?, href?, mono? }[]`. | Last item is the current page. |
| `Page` | `width` `default` 760 · `wide` 1040; `routeKey`; `className`; children. | The scrolling, centred column; rises in once per `routeKey`. |
| `PageHeader` | `title`, `meta` (MetaLine items or a node), `actions`, children. | Title once, 22/28. |
| `PageSection` | `title`, `action`, `id`, `className`, children. | 16/24 heading; separated by 40px of air. |
| `Aside` | `title`, `label` (names the region when `title` is not a string), `onClose`, `actions`, `className`, `bodyClassName`, children. | The one right panel; slides in. |
| `AsideLayout` | `aside` (the `Aside`, or falsy), `className` (the page column), children (the page). | The row a page and its aside share: without an aside it renders the page alone; with one, beside it — and **floating over** the page (`shadow-dialog`) when the content panel is under 56rem. Every aside (chat, details, notes, review notes, preparation) goes through it. |
| `Card` | `header`, `className`, children. | Quiet bordered surface — **prefer no card**. |
| `Section` | `title`, `action`, `className`, children. | A SectionLabel over content, no border. |

**Other**: `DimLine`, `FailureNote` (`danger-subtle` notice about a path),
`BranchMenu`, `LapSections`, `NoteThumbnail`, `BARE_BUTTON`.

### Dialog

Every overlay in the app runs its mechanics through `Dialog`. Do not hand-roll
another one. Its look: `surface-raised`, `rounded-lg`, `shadow-dialog`, the
backdrop fading in (`bg-scrim`) and the panel rising (`animate-dialog-in`).
Compose the content with `DialogHeader` (`title`, `description`, `onClose` →
close IconButton, `id` for `labelledBy`), `DialogBody` and `DialogFooter`
(actions right-aligned, one primary last; `start` slot on the left).

What it owns: a portal into `<body>`, `role="dialog"` + `aria-modal`, Escape,
backdrop dismissal, focus on open and focus restore on close, and — with
`dirty` — the discard question before a dismissal throws typed prose away.

Three of those look like details and are not:

- **Escape only answers when the focus is inside the dialog.** The palette and
  the settings pane can be open *on top of* another dialog, and focus is the only
  thing that says which one is on top. `null` / `<body>` counts as inside.
- **The backdrop dismisses on `mousedown`, not `click`.** A drag that starts
  inside the panel and releases outside it is a text selection, not a dismissal.
- **Focus is not stolen from a child that asked for it.** `Dialog` focuses the
  panel on open only when nothing inside it already has the focus.

`size`: `sm` 460 · `md` 620 · `lg` 780 · `xl` 940 · `palette` 560 at 12vh;
`scrim`: `dim` (default) · `light` · `none` (clicks fall through). `className`
lands on the panel and `backdropClassName` on the backdrop.

`inline` is the one escape from the portal, for `FormOverlay`, which fills the
workspace column rather than the viewport; it claims no `aria-modal`.

### Legacy hook classes

None are left. `SectionTitle` and `DimLine` used to carry `section-title` /
`dim-line` for surviving `styles.css` rules; those rules, the ATOMS section
(`.btn*`, `.chip*`, `.mono`, `.spin-ring`, `.ghost-link`, `.tag`) and every
surface section were deleted once nothing rendered them.

## Concern modules

`lib/feature-ui.ts` and `components/Workspace.tsx` used to be one 2,378-line
view-model and one 1,007-line component that every phase's logic passed through.
They are now directories, one module per concern, so two flow features touching
different phases touch different files. **Find the module your flow owns and edit
that** — a change that lands back in the barrel or in `Workspace.tsx` is the
collision this split exists to prevent.

`src/lib/feature-ui/` — the derivations. `feature-ui.ts` is a barrel that
re-exports all of it, so the 21 existing importers are unchanged; new code may
import a module directly, and removing the barrel is a later cleanup.

| Module | What it derives |
|---|---|
| `creation.ts` | The cutting form: default base branch, slug preview, duplicate-title warning. |
| `pipeline.ts` | Phase vocabulary — order, glyphs, labels, tips — and the stepper's steps. |
| `sidebar.ts` | Feature rows: needs-me, row chips, ticket progress, sort, triage lanes and their caps. |
| `gates.ts` | Gates and what blocks them: merge/ticket conflict kickoffs, overrides, check-in and kickoff trouble, session activity. |
| `drive.ts` | Test drive: the open-app URL and its wait state, drive failures, the drive wheel, the review drive's dirty-tree denial. |
| `review.ts` | Review figures — run/commit/review rows, `CheckRow`/`CheckTone`, outcome, finding counts and reasons. |
| `laps.ts` | Lap grouping: lap accounts, `groupByLap`, ticket model chips, lap aborts. |
| `summary.ts` | Docs and the merge confirmation: headline, spec path, deferred scope, `mergeSummary`. |
| `map.ts` | Mapped features: `map.md` sections, waypoints and their groups. |
| `session.ts` | Session lifecycle: done state, live-session blockers, shipped QA sessions, shipped-at. |
| `internal.ts` | Shared private helpers. **Not** re-exported by the barrel. |

`src/lib/feature-ui/next-step/` — the next-step bar. `index.ts` keeps the exact
`nextStep` signature, resolves the shared preamble, and dispatches to one
resolver per phase; `types.ts` holds `ActionKind`/`NextStep`/`NextAction` and
`resolver-input.ts` the `ResolverInput` every resolver takes. One file per phase:
`draft.ts`, `ideation.ts`, `spec.ts`, `tickets.ts`, `implementation.ts`,
`review.ts`, `shipped.ts`.

`src/components/workspace/` — the pieces `Workspace.tsx` used to inline. It keeps
the phase-body dispatch and the action switch; these moved out:

| File | What it is |
|---|---|
| `NextStepBar.tsx` | The next-step bar: the one primary action, its secondaries, escape lines on disabled actions. |
| `PipelineStepper.tsx` | The phase stepper across the top of a feature. |
| `FeaturePanes.tsx` | The crash and unrecognised-phase panes — a feature view that cannot do its job. |
| `use-resume-failed-alert.ts` | Raises a banner on a new `session.resume_failed` event. |
| `copy-text.ts` | Copy to the clipboard, with the toast either way. |

## Testing

Two tiers. Both run under the root `vitest run`; component tests live in
`apps/web/test/` and are typechecked (`tsconfig.json` includes `test`).

**Tier 1 — static markup. The default.** For anything whose whole behaviour is
the markup it emits. Zero dependencies: `createElement` from `react` plus
`renderToStaticMarkup` from `react-dom/server`, in a plain `.ts` file. Assert on
the rendered string. Pattern: `test/lap-sections.test.ts`.

**Tier 2 — a real DOM. Opt in per file.** For behaviour a string cannot show:
portals, Escape handling, focus restore, events. Put

```ts
// @vitest-environment happy-dom
```

on line 1 of a `.tsx` file and use `@testing-library/react`. The environment is
**not** switched on globally — the existing suite keeps running in `node`
unchanged — and because `globals` is off there is no auto-cleanup, so a tier-2
file unmounts its own renders (`afterEach(cleanup)`). Pattern:
`test/dom-environment.test.tsx`, and `test/dialog.test.tsx` for the real thing.

Reach for tier 2 only when tier 1 cannot answer the question. It costs a DOM per
file.

## Migration rule

> Never add a rule to `styles.css`.

`styles.css` was the pre-Tailwind stylesheet (~4,400 lines), retired flow by
flow as each surface was redesigned. What is left is the document base — box
sizing, the body's face and ground, the scrollbar, and the global focus ring
(unlayered on purpose, so no utility can switch it off). The legacy alias
block and theme.css's deprecated colour names went with the last rule that
read them.

## Ratchet

`test/styles-ratchet.test.ts` asserts `styles.css` is at or below a baseline
line count recorded as a constant in that file (50 — the document base). A
change that grows the sheet fails. If you delete more of it, lower the
constant to what `wc -l apps/web/src/styles.css` reports, in the same commit.
