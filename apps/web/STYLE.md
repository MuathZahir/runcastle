# apps/web style guide

How this app is styled and tested, and how the pre-Tailwind stylesheet is being
retired. Read this before changing anything visual in `apps/web`.

This supersedes `docs/UI-SPEC.md` §4 (primitives). The rest of UI-SPEC — the user
stories, the shell layout, the terminal — still stands.

## Tokens & scale

`src/theme.css` is the **single token source**. Its `@theme static` block holds
every token with its **dark** value; a `:root[data-theme="light"]` block right
under it restates the base colours (and the two elevations) for the **light**
theme. `src/styles.css` only aliases tokens (see [Migration rule](#migration-rule))
— never add a token to it. The values are the Runcastle Design System's
(`tokens.json`); what they add up to is `DESIGN.md`.

Tokens sit under Tailwind's namespaces, so declaring one generates its utility:

| Namespace | Tokens | Utilities |
|---|---|---|
| `--color-*` grounds | `canvas`, `surface`, `surface-raised`, `surface-hover`, `surface-selected`, `surface-inset`, `scrim` | `bg-surface`, `bg-surface-hover`, `bg-scrim` |
| `--color-*` lines | `border`, `border-subtle`, `border-strong` | `border-border-subtle` |
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

**Deprecated aliases.** Every pre-redesign colour name still resolves — `bg`,
`panel`, `panel-2/-3/-inset`, `hairline`/`-soft`/`-strong`, `text-2/-3/-4`,
`accent-hi/-2/-ink/-soft/-line`, `ph-*`, `needs`, `warn`, `ok`, `drive` — as a
`var()` onto the closest new token (listed in the DEPRECATED block in
`theme.css`), and so do `rounded-pill`, `shadow-menu` and `shadow-overlay`. They
exist so the whole app re-skinned at once. **Do not write them in new code; when
you touch a file, replace every one in it.** The block is deleted when a grep
finds none left.

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
  utilities layers but not Tailwind's base reset, because the reset changes the
  legacy sheet under it — `ol, ul { list-style: none }` alone strips every
  markdown bullet. Preflight arrives when the legacy sheet is gone. What
  `theme.css` hand-writes in `@layer base` meanwhile: `button` (no UA chrome;
  inherits font and colour) and `input, textarea, select` (inherit the app's
  face). The unlayered legacy sheet and every utility still beat it. Everything
  else is un-reset — style what you render.
- **Legacy rules beat utilities.** `styles.css` is unlayered and utilities live
  in `@layer utilities`, and unlayered CSS wins over layered CSS whatever the
  specificity. So a utility on an element that still carries a legacy class is
  silently overridden. This is not a bug to work around with `!` — it is the
  signal that the surface's legacy rules are the thing to delete.

## Primitives

**Import every primitive from `src/ui.tsx`** — it holds the older ones and
re-exports the rest from `src/ui/` (one concern per file: `button.tsx`,
`status.tsx`, `list.tsx`, `tabs.tsx`, `field.tsx`, `page.tsx`, `kbd.tsx`,
`tooltip.tsx`, and the four floating ones). Icons and `PhaseIcon` are in
`src/icons.tsx`. Build a missing primitive there rather than styling the same
thing twice in two surfaces; never hand-roll a button, row, chip, menu, dialog,
tab set or empty state in a surface. What each should look like is `DESIGN.md`.

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
| `Select` | A grouped single-select over a short, fixed list. `value=""` means *unset* and is translated at the primitive's edge. | `SELECT_FIELD` is the form-field look for a `SelectTrigger`; pass `font-mono` on `SelectContent` for model ids. |
| `Combobox` | A single-select whose list is long enough to want searching. | `ComboboxItem current` marks the held value. |
| `Tooltip` | A label after 400ms hover, or on focus. `TooltipProvider` is mounted once in `main.tsx` (a stray tooltip brings its own). | `label`, `kbd`, `side`. Every `IconButton` has one. |

### Catalogue

Every prop list below is the contract; the JSDoc on each export says the same.

**Actions**

| Primitive | Props | Notes |
|---|---|---|
| `Button` | `variant` `primary` · `secondary` (default) · `ghost` · `danger`; `size` `sm` 24 · `md` 28 (default) · `lg` 32; `icon` (leading); `kbd`; `loading`; every `<button>` attribute and `ref`. | Legacy `variant="solid"` → primary, `"accent"` → secondary, `size="xs"` → sm. `type` defaults to `button`. `loading` swaps the icon for a spinner (or overlays one, keeping the width) and disables. Carries `data-variant`. **At most one `primary` per view.** |
| `IconButton` | `label` (required: tooltip + `aria-label`), `icon` (or children), `size`, `variant` (default `ghost`), `active` (→ `aria-pressed`), `kbd`, `tooltipSide`, button attributes and `ref`. | The chrome button. Can be a Radix `asChild` trigger. |
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
| `SectionLabel` | children, `count`, `action`, `className`, `id`. | 12px medium sentence case. `SectionTitle` renders the same (keeps its hook class). |
| `NavItem` | `label`; `icon` or `phase`; `meta`; `dot` (tone); `active`; `href` or `onClick`; `actions` (hover/focus-revealed); `onContextMenu`; `title`; `className`. | 32px sidebar row. |
| `ListRow` | `title`; `leading`; `subtitle`; `meta`; `onClick` or `href`; `actions`; `active`; `index` (stagger for the first 8 of an initial render); `animate`; `className`. | 40px content row. |
| `List` | `divided`, `label`, `className`, children. | `divided` rules rows with `border-subtle`. |
| `PropertyList` | `items: { label, value, sub?, leading? \| tone? \| phase?, mono? }[]`. | Two quiet columns. |
| `MetaLine` | `items: ({ text?, strong?, tone? \| icon? \| phase?, mono?, title? } \| false \| null)[]`. | One line of 2–4 facts. |
| `Tabs` | `items: { id, label, icon?, count?, disabled?, panelId? }[]`, `value`, `onChange`, `size` `sm` · `md`, `label`. | ARIA tablist, roving tabindex, ←/→/Home/End. |
| `Disclosure` | `title`, `icon`, `aside`, `defaultOpen`, `bare`, `onToggle`, `className`, `bodyClassName`, children. | Closed by default; animated height; rotating chevron. |
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
| `Aside` | `title`, `onClose`, `actions`, `className`, `bodyClassName`, children. | The one right panel; slides in. |
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
lands on the panel and `backdropClassName` on the backdrop — legacy class names
passed there still win over the utilities until their flow migrates.

`inline` is the one escape from the portal, for `FormOverlay`, which fills the
workspace column rather than the viewport; it claims no `aria-modal`.

### Legacy hook classes

Some primitives still carry one pre-Tailwind class name. It is a **hook, not
styling**: a surviving `styles.css` rule places the primitive inside a specific
surface.

| Primitive | Hook | The rule that needs it |
|---|---|---|
| `SectionTitle` | `section-title` | `.body-title .section-title` (the run body's heading row) |
| `DimLine` | `dim-line` | none left — the base `.dim-line` rule, which raw spans still carry |

The ATOMS section of `styles.css` (`.btn*`, `.chip*`, `.mono`, `.spin-ring`,
`.section-title`, `.dim-line`, `.ghost-link`, `.tag`) is restyled onto the new
tokens so its remaining raw callers already look like the system; retire each
with its last caller. **When your flow migrates one of those surfaces, delete
the rule and the hook together.**

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

> A flow feature migrates its own surface's rules from `styles.css` to Tailwind
> utilities as it redesigns that surface, **deletes the migrated rules**, and
> **never adds a rule to `styles.css`**. The last flow to land deletes the file
> and the legacy alias block.

`styles.css` is the pre-Tailwind stylesheet: ~4,400 hand-written lines covering
every surface in the app. It is not migrated in one go — it is retired as a
by-product of the seven per-flow redesigns, which is what lets them run in
parallel without landing in each other's conflicts.

Its `:root` block is now nothing but aliases (`--panel: var(--color-panel)`) onto
the theme, under a loud `LEGACY ALIASES` comment, so every rule below keeps
resolving untouched while the file shrinks. Names that theme.css already emits
under the same spelling — `--radius-sm/-lg/-pill`, `--control-h`, `--sidebar-w`,
`--inspector-w`, `--maprail-w`, `--content-max`, `--shadow-menu`,
`--shadow-overlay`, `--dur-1/-2/-3`, `--ring` — are deliberately absent from the
alias block; re-declaring them there would shadow the theme.

The legacy rules keep their hardcoded pixels until their flow migrates them, so
the app reads slightly mixed mid-migration. That is accepted.

## Ratchet

### What is left in the file, and whose it is

The `build-review-and-ship` flow took its own sections (the run body, review and
shipped, the merge and notes dialogs) **and adopted the six that belonged to
nobody** — MARKDOWN, DOC PEEK, ERROR BOUNDARY / TERMINAL, TOASTS, ANIMATIONS,
and ATOMS *except its base atoms*: the merge with `ideation-through-tickets`
brought back surfaces (the grill and tickets bodies, the waypoint cards, the
preparation workspace) that still render `btn`/`chip`/`mono`/`spin-ring` by
name, so the ATOMS section stands until those flows' own migrations retire
their callers. Keyframes and the reduced-motion switch live in `theme.css`;
everything else that was adopted is utilities at the consumer. What remains,
by section banner:

| Section | Whose |
|---|---|
| LEGACY ALIASES + the base reset at the top | the last flow to land |
| ATOMS | whoever migrates the last `btn`/`chip`/`mono`/`spin-ring` caller (grill + preparation surfaces today) |
| LOGO WORDMARK · MULTI-PROJECT | the portfolio / open-project flow |
| WORKSPACE · SESSION PANEL | `flow-redesign-project-shell-and-navigation` |
| PHASE BODY — tickets ledger | `flow-redesign-ideation-through-tickets` |
| PHASE BODY — review + shipped | not this flow's any more — what outlived the rebuild is preparation's dry-run pulse, the grill terminal's height, and DraftBody's base-branch select |
| OUTLIVED THE SETTINGS OVERLAY | preparation, and the delete dialog's confirm input |

So **nobody deletes the file yet**: the condition below is "whoever measures
zero after their own deletions", and none of the remainder is ours.

`test/styles-ratchet.test.ts` asserts `styles.css` is at or below a baseline line
count recorded as a constant in that file. The rule above is therefore enforced
in CI, not just written down: a change that grows the sheet fails.

**When you delete rules, lower the constant** to what the file now measures
(`wc -l apps/web/src/styles.css`) in the same commit. When the file reaches zero,
delete it, delete the legacy alias block, and delete the ratchet test with them.
