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

<!-- Catalogue filled in by the primitives ticket: Button, SectionTitle, DimLine,
     EmptyState, CheckLine, PhaseTag, chips, dots, LapSections, Dialog, Field,
     Card/Section, Kbd. -->

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
