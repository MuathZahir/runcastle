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
`test/dom-environment.test.tsx`.

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
