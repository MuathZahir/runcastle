# apps/web style guide

How this app is styled and tested, and how the pre-Tailwind stylesheet is being
retired. Read this before changing anything visual in `apps/web`.

This supersedes `docs/UI-SPEC.md` §4 (primitives). The rest of UI-SPEC — the user
stories, the shell layout, the terminal — still stands.

## Tokens & scale

`src/theme.css` is the **single token source**. It declares one `@theme` block;
every token in the app lives there and nowhere else. `src/styles.css` only
aliases those tokens (see [Migration rule](#migration-rule)) — never add a token
to it.

Tokens sit under Tailwind's namespaces, so declaring one generates its utility:

| Namespace | Tokens | Utilities |
|---|---|---|
| `--color-*` | `bg`, `panel`, `panel-2`, `panel-3`, `panel-inset`, `hairline`/`-soft`/`-strong`, `text`, `text-2`, `text-3`, `text-4`, `accent`, `accent-hi`, `accent-2`, `accent-ink`, `accent-soft`, `accent-line`, `ph-ideation … ph-shipped`, `danger`, `needs`, `warn`, `ok`, `drive` | `bg-panel-2`, `text-text-3`, `border-hairline`, … |
| `--font-*` | `sans` (Inter Variable), `mono` (JetBrains Mono Variable) | `font-mono` |
| `--text-*` | `xs` 11 · `sm` 12 · `base` 14 · `lg` 16 · `xl` 20 | `text-sm`, `text-lg`, … |
| `--radius-*` | `sm` 6 · `md` 8 · `lg` 12 · `pill` 999 | `rounded-md`, `rounded-pill` |
| `--shadow-*` | `menu`, `overlay` | `shadow-overlay` |
| `--ease-*` | `app`, `out-app` | `ease-app`, `ease-out-app` |

Tailwind's own colour, type, radius and shadow scales are switched off
(`--color-*: initial` and friends): `bg-red-500` and `text-3xl` do not resolve,
by design. Its motion easings are kept, which is why ours are suffixed `-app`.

Metrics that no utility should generate stay un-namespaced and are read with
`var()` or an arbitrary value (`h-(--control-h)`): `--control-h`, `--sidebar-w`,
`--inspector-w`, `--maprail-w`, `--content-max`, `--dur-1/-2/-3`, `--ring`.

**The scale is one notch up from the pre-Tailwind app** (decision 4): body
**14px / 1.5** (was 13 / 1.45), controls **32px** high (was 28), radii **6 / 8 /
12** (was 5 / 7 / 10), the 10px type step gone and 11px reserved for uppercase
micro-labels. Spacing is Tailwind's **default 4px scale** — there are no custom
spacing tokens, and adding one needs a decision, not a commit.

Single dark theme. There is no light mode and no `dark:` variant.

### Two things Tailwind does here that will surprise you

- **No preflight.** `theme.css` imports the theme and utilities layers but not
  Tailwind's base reset, because the reset changes the legacy sheet under it —
  `ol, ul { list-style: none }` alone strips every markdown bullet. Preflight
  arrives when the legacy sheet is gone. Until then, do not assume a reset:
  style what you render.
- **Legacy rules beat utilities.** `styles.css` is unlayered and utilities live
  in `@layer utilities`, and unlayered CSS wins over layered CSS whatever the
  specificity. So a utility on an element that still carries a legacy class is
  silently overridden. This is not a bug to work around with `!` — it is the
  signal that the surface's legacy rules are the thing to delete.

## Primitives

`src/ui.tsx` holds the shared primitives. Build one there rather than styling the
same thing twice in two surfaces.

How they are to be styled (decision 5): Tailwind utility classes written inline
in the TSX, variants composed by a local `cx()` helper. No `@apply` component
classes — that just grows a second semantic stylesheet to replace the one being
retired — and no runtime styling dependency; `clsx`, `cva` and `tailwind-merge`
are deliberately absent. `@utility` in `theme.css` is the escape hatch for what
utilities genuinely cannot express, kept to a minimum.

### Catalogue

| Primitive | What it is | Variants |
|---|---|---|
| `Button` | The app's button. 32px tall, `rounded-md`, forwards every `<button>` attribute; a `className` you pass is appended. | `ghost` (default) · `solid` · `danger` |
| `SectionTitle` | 11px uppercase tracked label over a section. | — |
| `DimLine` | One dim mono line — an inline empty or error state for a tight spot. | — |
| `EmptyState` | A designed blank area: quiet icon chip, plain-language title, one-line hint, optional action. | `compact` |
| `Dialog` | The one modal shell — see [Dialog](#dialog) below. | `size`: `sm` 460 · `md` 620 · `lg` 780 · `xl` 940 (settings: rail + roster table) · plus `inline` |
| `Field` | A control with its label, help and error wired to it by id. The child control is cloned with an `id` and `aria-describedby`; an `id` already on the control wins and the label follows it there. The error carries `role="alert"`. `layout` replaces the default stacked column (settings' rows are a two-column grid) and `labelAside` puts an affordance *beside* the label — a `<label>` may not contain another labelable element, so a help button or a save flash cannot be its child. | — |
| `Card` | A bounded surface — `bg-panel`, hairline border, `rounded-lg`, `p-4` — with an optional `header` slot. | — |
| `Section` | `SectionTitle` + `Card`. A **separate export**, not a `Card` title prop (the spec left the choice open): the title belongs outside the card's border, which is where every `SectionTitle` in the app already sits. | — |
| `Kbd` | One key in a keyboard hint. | — |
| `CheckLine` | One review figure — tone dot, label, value — from a `CheckRow`. | tone comes from the row: `ok` · `warn` · `danger` · `idle` |
| `LapSections<T>` | Rows under `Lap N` headers. Current lap is an open `<section>`, earlier laps a `<details>` with a caret. Suppressed entirely below lap 2 (ADR-0010 §4). | — |
| `PhaseTag` | A feature's phase, in the phase's own colour. | one per `Phase` |
| `TicketStatusChip` | A ticket's status. `burning` breathes. | one per `TicketStatus` |
| `TicketKindChip` | Marks a `review` ticket. Renders **nothing** for `implementation` — the default would be noise on every row. | — |
| `NoteAuthorChip` | Marks the review agent's note. Renders **nothing** for `human`. | — |
| `FindingSeverityChip` | How bad the review thought a finding was. Even `high` is amber: severity is read, never enforced. | `high` · `medium` · `low` |
| `RunStatusChip` | A burn run's status. `running` breathes. | one per `RunStatus` |
| `SessionStatusDot` | A 8px dot for a session's lifecycle. | `launching` · `live` · `ended` |

**Exactly one `solid` button is visible per view.** Everything else is `ghost`;
`danger` is for destructive confirmations, and it is still not the solid one. If
a view needs a second primary action, the view is the thing to rethink.

Two more house rules the primitives already follow:

- **Focus rings are not written here.** `styles.css` sets
  `:focus-visible { box-shadow: var(--ring) }` globally and unlayered, so it
  paints every one and would shadow a utility that repeated it.
- **Colour families are lookup maps, not string interpolation.** A phase or
  status maps to a whole literal class (`implementation → 'text-ph-implementation'`)
  so Tailwind's content scanner can see it. `` `text-ph-${phase}` `` generates
  nothing. No `@utility` escape hatch was needed for any of them.

### Dialog

Every overlay in the app runs its mechanics through `Dialog`. Do not hand-roll
another one — these five were each a copy, and the copies had already drifted
(one closed on `click`, the rest on `mousedown`; one asked before discarding
typed prose, the rest threw it away; none restored focus).

What it owns: a portal into `<body>`, `role="dialog"` + `aria-modal`, Escape,
backdrop dismissal, focus on open and focus restore on close, and — with
`dirty` — the discard question before a dismissal throws typed prose away.

Three of those look like details and are not:

- **Escape only answers when the focus is inside the dialog.** The palette and
  the settings pane can be open *on top of* another dialog, and focus is the only
  thing that says which one is on top. A dialog that answered unconditionally
  would close underneath the one being looked at. `null` / `<body>` counts as
  inside — that is where a click on its own backdrop leaves the focus.
- **The backdrop dismisses on `mousedown`, not `click`.** A drag that starts
  inside the panel and releases outside it is a text selection, not a dismissal.
- **Focus is not stolen from a child that asked for it.** `Dialog` focuses the
  panel on open only when nothing inside it already has the focus, so an
  `autoFocus` control (or `initialFocusRef`) still wins.

`className` lands on the panel and `backdropClassName` on the backdrop, which is
how the five existing overlays keep their present look while their flow feature
waits its turn: they pass `peek`, `peek settings`, `nf-card` and so on, and those
unlayered legacy rules beat the utilities underneath.

`inline` is the one escape from the portal, and there is exactly one consumer:
`FormOverlay`, which fills the workspace column rather than the viewport and
leaves the sidebar live beside it. Portalling that one to `<body>` would blank
the workspace behind a backdrop and cover navigation that still works, so it
renders in place and claims no `aria-modal` — content around it genuinely *is*
reachable. Reach for `inline` only when that is true of your dialog too.

### Legacy hook classes

Some primitives still carry one pre-Tailwind class name. It is a **hook, not
styling**: a surviving `styles.css` rule places the primitive inside a specific
surface, and dropping the name would silently lose that placement.

| Primitive | Hook | The rule that needs it |
|---|---|---|
| `SectionTitle` | `section-title` | `.body-title .section-title`, `.mr-head .section-title` |
| `DimLine` | `dim-line mono` | `.map-waypoints > .dim-line` (the dashed placeholder) |
| `LapSections` | `lap-group`, `lap-group-head` | `.ledger .lap-group-head`, `.ledger .lap-group + .lap-group` |

Remember that an unlayered legacy rule beats a utility, so where the base rule
also still exists — `.section-title` and `.dim-line` do, because raw spans
elsewhere in the app carry those names — it wins over the utilities beside it.
**When your flow migrates one of those surfaces, delete the rule and the hook
together**, and check whether the base rule has any raw callers left.

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
| `drive.ts` | Test drive: the open-app URL and its wait state, drive failures, the drive wheel. |
| `review.ts` | Review figures — run/commit/review rows, `CheckRow`/`CheckTone`, outcome, finding counts and reasons. |
| `laps.ts` | Lap grouping: lap accounts, `groupByLap`, ticket model chips, the lap banner. |
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
| `NextStepBar.tsx` | The next-step bar: the one primary action, its secondaries, reason prompts. |
| `PipelineStepper.tsx` | The phase stepper across the top of a feature. |
| `LapBannerRow.tsx` | From lap 2 on, the line saying which lap this is and what put the feature on it. |
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

`test/styles-ratchet.test.ts` asserts `styles.css` is at or below a baseline line
count recorded as a constant in that file. The rule above is therefore enforced
in CI, not just written down: a change that grows the sheet fails.

**When you delete rules, lower the constant** to what the file now measures
(`wc -l apps/web/src/styles.css`) in the same commit. When the file reaches zero,
delete it, delete the legacy alias block, and delete the ratchet test with them.
