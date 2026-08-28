## Why this feature exists

The human has judged the runcastle web app not production-ready: cluttered, not streamlined, confusing menus, dated look. The decision (project session, 2026-08-28) is to redesign the app **one flow at a time**, seven flow features, each of whose ideation session walks the whole flow end to end and redesigns it. This feature is the thing that has to land *before* those seven can run without colliding.

Two facts about `apps/web` force it:

1. **All styling is one file.** `apps/web/src/styles.css` is 4,370 hand-written lines, no Tailwind, with a reasonable token set on `:root` (`--bg`, `--panel`/`--panel-2/3`/`--panel-inset`, `--hairline*`, a four-step text ramp `--text`…`--text-4`, one violet accent `--accent` + variants, a phase palette `--ph-ideation`…`--ph-shipped`, status colours, `--mono` JetBrains Mono / `--sans` Inter, `--radius*`, `--control-h`, `--sidebar-w`). Seven parallel features editing that one file would land into each other's merge conflicts.
2. **The derivation logic is one file too.** `apps/web/src/lib/feature-ui.ts` is 2,259 lines holding every phase's next-step bar, gate checks, lap grouping, review summary, map/waypoint parsing. Six of the seven flows read it; flows 6 (ideation→tickets) and 7 (build→review→ship) would each rewrite a different half. `components/Workspace.tsx` (970 lines) is the same problem for the phase-body dispatch.

## What this feature is for

- **Adopt Tailwind v4 in `apps/web`** (Vite). Move the existing tokens into an `@theme` block so the spacing scale, type scale, radii, surfaces, text ramp, accent and phase palette are *decided once here*. The human wants the redesign "more spacious, modern, aesthetic" — the scale is where that is set; the flow features apply it.
- **Rebuild the `apps/web/src/ui.tsx` primitives** (Button, SectionTitle, DimLine, EmptyState, CheckLine, PhaseTag, chips, dots, LapSections) on the theme, and add the primitives the flows will all need so they don't each invent one: dialog/overlay (currently `FormOverlay.tsx`, `DocPeek.tsx`, `MergeFeatureDialog.tsx`, `DeleteFeatureDialog.tsx`, `SettingsOverlay.tsx` each roll their own), form field with label/help/error, section/card, keyboard-hint.
- **Carve `lib/feature-ui.ts` by concern** (next-step, gates, laps, review derivations, map/waypoints, vocabulary) and split `Workspace.tsx`'s dispatch, **preserving the existing unit tests** (`apps/web/test/feature-ui.test.ts` is large and is exactly what makes this mechanical refactor safe). No behaviour change.
- **Establish the migration rule** and document it in the repo where the flow features' agents will read it (e.g. `apps/web/README.md` or a short `apps/web/STYLE.md`): a flow feature migrates its own surface's rules from `styles.css` to Tailwind classes as it redesigns the surface and **deletes the old rules**; the last flow to land removes what is left of `styles.css`. This feature does NOT migrate the 4,370 lines itself.
- **Decide the fate of `packages/design-system`** — the `@runcastle/design-system` mirror used by the Claude Design round-trip (`.design-sync/`), imported by nothing in `apps/web`. Retire it, or turn it into the Tailwind preset/theme source. Project-session recommendation: retire it; the ideation session decides and records it.
- Component testing: `apps/web` has almost no component tests (ux-issues ticket 8 found `react-dom/server` `renderToStaticMarkup` in a plain `.ts` test works under the root vitest config with zero new deps; `apps/web/tsconfig.json` does not include `test/`, so test files are not typechecked). Settle the pattern the flows will use.

## What it must NOT swallow

- **No flow redesign.** No changes to what any screen does, says, or how it is navigated. Visual changes are limited to what the new primitives/tokens imply; the seven flow features own their surfaces.
- **No mass migration of `styles.css`.** Only what is needed to prove the setup and to restyle the primitives.
- **No server changes** (`packages/server`) and no skills changes.

## Already settled

- Charter decision 13: Bun + Vite/React; terminals are xterm over a server PTY — untouched.
- The app is deliberately a single-screen state machine with no router (`Shell.tsx` → `lib/use-project-nav.ts` → `lib/workspace.ts`); adding a router is the project-shell flow's question, not this feature's.
- Bun everywhere; TypeScript strict; ESM.

## Order

This lands first, alone. The seven flow features (parked as drafts) fork from `main` after it merges. Their briefs each carry the migration rule and a scoped code-quality mandate.
