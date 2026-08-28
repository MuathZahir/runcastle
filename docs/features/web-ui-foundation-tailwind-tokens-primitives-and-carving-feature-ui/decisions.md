
## 1. One lap, all five pieces
**Decision:** Spec the whole feature in one lap: Tailwind v4 + `@theme` tokens, rebuilt and extended `ui.tsx` primitives, the `feature-ui.ts` / `Workspace.tsx` carve, the migration rule + component-test pattern, and the fate of `packages/design-system`. Not mapped.
**Why:** The seven flow redesign features fork from `main` only after this merges and depend on every piece; a thin lap 1 would just push the remainder into a second lap the flows still wait on. Each piece is mechanical and needs no research or prototype first, so it is not map-sized either.

## 2. Retire `packages/design-system` and `.design-sync/`
**Decision:** Delete `packages/design-system` (`@runcastle/design-system`) and the `.design-sync/` round-trip tooling (config, conventions, notes, 25 previews, template) together; drop the package from the root `typecheck` script and workspace. The `@theme` block in `apps/web` becomes the single token source.
**Why:** Nothing in `apps/web` imports the package; the codebase audit already found it dead to the product and drifting (94 duplicated class names, diverged token values). The `.design-sync/` previews are its only importers and would break under any repoint, so half-retiring is not a real option. The Claude Design round-trip is no longer in use.

## 3. `@theme` is the token source; legacy `:root` becomes aliases
**Decision:** Tokens move into a Tailwind v4 `@theme` block (new `apps/web/src/theme.css`, with `@import "tailwindcss"`, imported from `main.tsx` before `styles.css`) under Tailwind namespaces (`--color-*`, `--font-*`, `--radius-*`, `--shadow-*`, `--ease-*`, …). The existing `:root` block in `styles.css` is reduced to a clearly-marked legacy alias section (`--panel: var(--color-panel)` …) so every existing rule keeps working untouched. The alias block is deleted with the last of `styles.css`.
**Why:** One source of truth in the place the flow features will read, without a mass rename of 4,435 lines. Having `@theme` reference the legacy vars instead would make the new theme depend on the file being retired.

## 4. Scale: one notch up from today's density
**Decision:** Body 14px / line-height 1.5 (was 13px / 1.45); type ramp 11 · 12 · 14 · 16 · 20 (10px is gone; 11px only for uppercase micro-labels); `--control-h` 32px (was 28); radii 6 / 8 / 12 (was 5 / 7 / 10), pill unchanged; Tailwind's default 4px spacing scale with no custom spacing tokens. Sidebar/inspector widths unchanged — they belong to the project-shell flow.
**Why:** "More spacious, modern" without turning a terminal-and-tables developer tool into a marketing layout. The new scale governs the rebuilt primitives now; legacy `styles.css` rules keep their hardcoded px until their flow migrates them, so a mixed look during migration is accepted.

## 5. Primitives are styled with utilities in the TSX
**Decision:** Rebuilt `ui.tsx` primitives carry Tailwind utility classes inline, variants composed with a local `cx()` helper. No `@apply` component classes, and no new runtime deps (`clsx`, `cva`, `tailwind-merge`). `@utility` in `theme.css` is the sparing escape hatch for what utilities cannot express (e.g. the phase-colour family).
**Why:** Tailwind v4 idiom; a primitive's whole look lives in the file the flow agents copy from; avoids growing a second semantic stylesheet that would become the next `styles.css`.

## 6. Four new primitives; the five overlays adopt `Dialog` for mechanics only
**Decision:** Add `Dialog` (portal, Escape with the existing focus-ownership guard, backdrop mousedown-target guard, `role="dialog" aria-modal`, focus restore on close, size variant, optional dirty-discard confirm), `Field` (label / help / error wiring), `Card` (+ `Section` = `SectionTitle` + `Card`), and `Kbd`. `FormOverlay`, `DocPeek`, `MergeFeatureDialog`, `DeleteFeatureDialog`, `SettingsOverlay` are moved onto `Dialog` for Escape/backdrop/portal/focus only, keeping their inner content and current classes. Existing primitives are rebuilt in place with unchanged props.
**Why:** The five overlays are copy-pasted mechanics; moving them onto `Dialog` is deduplication, not redesign, and gives the primitive real consumers. Unchanged props on existing primitives keep the 21 importers untouched. Visual redesign of each overlay stays with its flow feature.

## 7. Carve `feature-ui.ts` by concern, `nextStep` by phase; keep the barrel
**Decision:** `lib/feature-ui.ts` becomes a barrel over `lib/feature-ui/` with one module per concern (`pipeline`, `sidebar`, `gates`, `drive`, `review`, `laps`, `summary`, `map`, `session`, `creation`) and a `next-step/` subdirectory whose `index.ts` keeps the exact `nextStep` signature and dispatches to one resolver per phase (`draft`, `ideation`, `spec`, `tickets`, `implementation`, `review`, `shipped`). `Workspace.tsx` keeps the `PhaseBody` dispatch and `runAction` switch; `NextStepBar`, `PipelineStepper`, `LapBannerRow`, the crash/unrecognized panes and `useResumeFailedAlert` move to `components/workspace/`. Zero behaviour change; the existing tests pass unmodified; none of the 21 importers change.
**Why:** Per-phase resolvers are what let flow 6 (ideation→tickets) and flow 7 (build→review→ship) edit disjoint files. The barrel makes the refactor importer-neutral now; flows may import concern modules directly and the barrel is a later cleanup.

## 8. Two-tier component testing
**Decision:** Tier 1 — pure-output components are tested with the existing zero-dep `createElement` + `renderToStaticMarkup` pattern (the default). Tier 2 — behaviour needing a DOM (Dialog, Field) uses `happy-dom` + `@testing-library/react`, opted into per file with `// @vitest-environment happy-dom`; no global environment change. `test/` is added to `apps/web/tsconfig.json` so tests typecheck, and the root vitest include widens to `*.test.{ts,tsx}`. Both tiers are documented in `apps/web/STYLE.md`.
**Why:** Static markup cannot exercise portals, Escape handling or focus restore; per-file opt-in keeps the 6,000 existing test lines untouched. Typechecked tests close a blind spot the flow features would otherwise inherit.

## 9. Migration rule lives in `apps/web/STYLE.md`, enforced by a ratchet test
**Decision:** `apps/web/STYLE.md` documents the theme tokens and scale, the primitives catalogue, the two test tiers, and the rule: a flow feature migrates its own surface's rules from `styles.css` to utilities as it redesigns that surface, deletes the migrated rules, and never adds a rule to `styles.css`; the last flow to land deletes the file and the legacy alias block. `CLAUDE.md` gets a one-line pointer; `docs/UI-SPEC.md` gets a header note that `STYLE.md` supersedes its §4 primitives section. A vitest ratchet asserts `styles.css` line count ≤ a baseline constant that each flow lowers.
**Why:** Agents read `CLAUDE.md` and the nearest doc, not scattered ADRs. A ratchet turns the rule into a CI failure instead of prose that a PR can ignore.
