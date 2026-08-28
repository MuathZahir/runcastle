# Web UI foundation: Tailwind, tokens, primitives, and carving feature-ui

## Problem

The runcastle web app is judged not production-ready — cluttered, dense, dated. The fix is seven per-flow redesign features, each walking one flow end to end. They cannot run in parallel today because the app has two single points of collision: one 4,435-line hand-written stylesheet that every surface's rules live in, and one 2,378-line view-model module (`feature-ui`) plus a 1,007-line `Workspace` component that every phase's next-step, gate, lap, review and map logic lives in. Seven features editing those files at once would spend their effort on merge conflicts. There is also no shared dialog, form-field, card or keyboard-hint primitive, so each flow would invent its own; no settled way to test components; and a dead `@runcastle/design-system` mirror package that drifts from the app.

This feature lands first, alone, and gives the seven flows a shared visual scale, a shared primitive set, disjoint files to edit, a test pattern, and a migration rule that retires the old stylesheet as a by-product of their work.

## Approach

From the user's perspective nothing changes in what any screen does or says. The visible change is limited to the rebuilt primitives — buttons, chips, tags, section titles, empty states and the five overlays — which pick up a one-notch-more-spacious scale (decision 4): 14px body text on a 1.5 line height, 32px controls, 6/8/12px radii, a type ramp of 11·12·14·16·20 with 10px gone. Legacy rules keep their hardcoded pixels until their flow migrates them, so the app looks slightly mixed during the migration; that is accepted.

**Theme.** Tailwind v4 is adopted in `apps/web` through its Vite plugin (no PostCSS config). A new theme stylesheet imports Tailwind and declares an `@theme` block that is the single token source (decision 3): surfaces, hairlines, the four-step text ramp, the violet accent family, the phase palette, status colours, fonts (the existing fontsource Inter / JetBrains Mono stay), radii, control height, shadows and motion, all under Tailwind's namespaces so utilities such as `bg-panel-2`, `text-text-3`, `rounded-md` and `ease-out-app` are generated. Spacing uses Tailwind's default 4px scale; no custom spacing tokens. The theme stylesheet is imported before the legacy stylesheet, whose `:root` block is reduced to a clearly-marked legacy alias section (`--panel: var(--color-panel)` …) so every existing rule keeps resolving. The alias block is deleted with the last of the legacy sheet. Single dark theme; no light mode.

**Primitives.** The `ui` module is rebuilt with utility classes written inline in the TSX and variants composed by a local `cx()` helper — no `@apply`, no new runtime dependencies (decision 5). `@utility` in the theme stylesheet is the sparing escape hatch for what utilities cannot express, such as the data-driven phase-colour family. Every existing export (Button, SectionTitle, DimLine, EmptyState, CheckLine, LapSections, PhaseTag, the ticket/run/finding/author chips, SessionStatusDot) keeps its props so its importers do not change. Four primitives are added (decision 6):

- `Dialog` — renders through a portal; Escape closes it using the existing focus-ownership guard (a dialog only handles Escape when focus is inside it, so a palette or settings pane stacked on top wins); backdrop dismissal on mouse-down with the target-equality guard; `role="dialog"` + `aria-modal`; focus is restored to the opener on close; a size variant; an optional dirty-discard confirmation so the form overlay can sit on it.
- `Field` — label, help text and error wired to the control by id.
- `Card` — a surface with an optional header; `Section` composes `SectionTitle` with `Card`.
- `Kbd` — a keyboard-hint glyph.

The five overlays (form overlay, doc peek, merge dialog, delete dialog, settings overlay) are moved onto `Dialog` for mechanics only — Escape, backdrop, portal, focus — keeping their inner content and current class names. Their visual redesign belongs to their flows.

**Carve.** The `feature-ui` module becomes a barrel over a directory with one module per concern — pipeline vocabulary and steps, sidebar/triage rows, gates and blockers, test-drive, review, laps, docs/merge summary, map/waypoints, session lifecycle, feature creation — and a `next-step` subdirectory whose index keeps the exact `nextStep` signature and dispatches to one resolver per phase (draft, ideation, spec, tickets, implementation, review, shipped) (decision 7). `Workspace` keeps its phase-body dispatch and its action switch; the next-step bar, pipeline stepper, lap banner row, crash/unrecognised-phase panes and the resume-failed hook each move to their own file under a workspace components directory. This is a zero-behaviour-change refactor: the barrel means none of the 21 importers change, and the existing `feature-ui` and lap-section tests must pass without modification. Flow features may import concern modules directly; removing the barrel is a later cleanup.

**Testing.** Two tiers (decision 8). Tier 1, the default, is the existing zero-dependency `createElement` + `renderToStaticMarkup` pattern for pure-output components. Tier 2, for behaviour that needs a DOM, adds `happy-dom` and `@testing-library/react` as root dev dependencies, opted into per file with a vitest environment pragma so the existing 6,000 lines of tests run exactly as before. The web tsconfig starts including its test directory so tests are typechecked, and the root vitest include widens to `.test.tsx`.

**Rule and enforcement.** A style guide at the web app root documents the tokens and scale, the primitives catalogue, the two test tiers, and the migration rule: a flow feature migrates its own surface's rules from the legacy stylesheet to utilities as it redesigns that surface, deletes the migrated rules, and never adds a rule to the legacy sheet; the last flow to land deletes the file and the alias block (decision 9). `CLAUDE.md` gets a one-line pointer; the existing UI-SPEC gets a header note that the style guide supersedes its primitives section. A ratchet test asserts the legacy stylesheet's line count is at or below a baseline constant recorded in the test; each flow lowers the constant as it deletes rules, and a change that grows the file fails CI.

**Retirement.** `packages/design-system` and the `.design-sync/` round-trip tooling (config, conventions, notes, previews, template) are deleted together and the package is removed from the workspace and the root typecheck script (decision 2).

## Seams

- **`feature-ui` barrel (existing).** The exported functions and types, unchanged in name and signature. Observed by the existing 3,131-line `feature-ui` test and the lap-sections test, which must pass unmodified after the carve. This is the primary seam of the whole feature.
- **`nextStep(...)` (existing).** Same signature, now dispatching to per-phase resolvers. Observed through the same existing tests; per-phase resolver files are an internal structure, not a new public surface.
- **`ui` module exports (existing, extended).** Existing primitives keep their props; `Dialog`, `Field`, `Card`, `Section`, `Kbd` are new. Observed by tier-1 static-markup tests (rendered classes and structure) and, for `Dialog` and `Field`, tier-2 DOM tests (Escape closes only when focus is inside; backdrop mouse-down on the backdrop itself closes, inside does not; focus returns to the opener; label/help/error ids wire to the control).
- **Theme stylesheet + legacy alias block (new).** Observed by the build succeeding and by a static-markup test that primitives emit theme-driven utility classes; the alias block is observed simply by the unchanged legacy rules still rendering (test-drive).
- **Legacy stylesheet ratchet (new).** A test that reads the file and asserts line count ≤ baseline. Observed by CI.
- **Root test runner (existing, extended).** The include glob and per-file environment pragma; observed by the full suite passing, including the new tier-2 files.
- **Workspace root typecheck (existing).** Passes with the design-system package removed and the web test directory newly included.

## Out of scope

- Any flow redesign: no change to what a screen does, says, or how it is navigated; no visual change beyond what the rebuilt primitives and scale imply.
- Mass migration of the legacy stylesheet. Only the `:root` alias rewrite and whatever the primitives and overlays strictly need.
- Visual redesign of the five overlays (mechanics only here).
- Server (`packages/server`) and skills packages.
- Light mode or a second theme; a router (the project-shell flow's question); sidebar/inspector widths.
- Removing the `feature-ui` barrel or updating importers to concern modules.

## Open questions

None blocking. Two details are left to implementation judgment within the decisions above: the exact list of `@utility` escape hatches (kept to the minimum utilities cannot express), and whether `Section` is a separate export or a `Card` prop — either is acceptable so long as the style guide documents the one chosen.
