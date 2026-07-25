# design-sync notes — @runcastle/design-system

Repo-specific gotchas for future syncs. Read this first.

## Origin

- This DS was **built** for the sync — it's a new package, `packages/design-system`,
  that extracts runcastle's app UI (`apps/web/src/styles.css` + `apps/web/src/ui.tsx`)
  into a standalone, decoupled component library. It did not exist before.
- Scope is a curated set of **15 reusable atoms/primitives** (Button, GhostLink,
  Input, Segmented, SectionTitle, DimLine, Tag, Chip, StatusDot, Spinner, Panel,
  Toolbar, Tabs, Stepper, Toast). App-shell pieces (`Shell`, `Sidebar`,
  `TerminalView`, tRPC-coupled tabs) were intentionally left out — they're not
  reusable and don't render standalone.

## Build / converter invocation

- `buildCmd`: `bunx tsc -p packages/design-system/tsconfig.json` → emits `dist/`
  (JS + `.d.ts`). Run `bun install` first on a fresh clone so the package deps exist.
- **`--node-modules ./packages/design-system/node_modules`** — Bun does NOT hoist
  react to the repo root; it installs react/react-dom/@types/react into the DS
  package's own `node_modules` (as symlinks — plain `find` misses them, use `find -L`).
- `--entry ./packages/design-system/dist/index.js`.

## Tokens (important)

- Design tokens live **inline as the `:root` block at the top of `src/styles.css`**
  (single source of truth). This is deliberate: `copyTokens` in the converter only
  fires for a separate tokens *package*; `cfg.tokensGlob` alone is a **no-op** in the
  package shape. Do NOT re-add `tokensGlob` — it did nothing and left `[TOKENS_MISSING]`.

## Fonts

- JetBrains Mono (SIL OFL) is vendored under `src/fonts/` (weights 400/500/600/700,
  latin woff2) and wired via `cfg.extraFonts: "src/fonts/fonts.css"`.
- The mono stack was trimmed to `"JetBrains Mono", ui-monospace, Consolas, monospace`
  — **"Cascadia Code" was dropped** so no unshipped named family trips `[FONT_MISSING]`.
  Don't re-add named families you don't also ship a `@font-face` for.

## Previews

- This is a **dark DS** but preview cards render on a WHITE body. Every authored
  preview wraps its story in a `{ background: 'var(--bg)', padding: 24, borderRadius: 8 }`
  stage so the component renders in its real dark context. Any NEW preview must do
  the same or it looks unstyled.
- `cfg.overrides` sets `cardMode: "column"` for DimLine, Panel, Tabs, Toast, Toolbar
  (wide bars/lists that overflow a grid cell). Keep these.

## Screens group (composed app)

- `src/screens/` holds 9 presentational, mock-data reconstructions of the runcastle
  app (AppShell, Titlebar, Sidebar, Inspector, StatusBar, OverviewScreen,
  TicketsScreen, RunScreen, TerminalScreen). They compose the primitives + the
  "SCREENS — layout" CSS block in `styles.css`. The `src/screens/` path puts them
  in the **screens** group; atoms stay in **general**.
- Every screen prop is optional with realistic defaults, so `<AppShell />` renders
  the whole populated IDE. `@category Screens` is on each as a grouping backstop.
- `cfg.overrides` gives each screen `cardMode: "single"` (StatusBar `column`) + a
  `viewport` sized to the screen — screens are large, single-story cards. Keep these.
- Screen previews wrap the component in a **fixed-size** dark frame (screens use
  `height:100%`, so the preview parent must have a definite height). Any new screen
  preview must set an explicit width/height on the frame.

## Templates (`templates/*` in the Design project)

Templates are **authored in Claude Design**, not emitted by the converter — the
build never writes `templates/`, and `_ds_sync.json` does not cover them. Since
2026-07-25 the source of `templates/app-redesign/AppRedesign.dc.html` is mirrored
at `.design-sync/templates/app-redesign/AppRedesign.dc.html` so it is diffable and
reviewable in-repo; edit there, then upload that exact file. `support.js` and
`ds-base.js` beside it remote-side are runtime files — leave them alone.

**The token trap.** `ds-base.js` injects the DS `styles.css` at runtime, and that
sheet's `:root` still carries the OLD palette (`--bg:#0a0c0f`, `--accent:#8b5cf6`,
`--text:#c9d1d9`, `--radius:5px`, `--sidebar-w:240px`) — the app has since moved to
`#090b10` / `#7c6cf6` / `#dde3ed` / `7px` / `252px`. A template that just uses
`var(--bg)` therefore renders in the *old* palette. AppRedesign declares the current
tokens on its own root element (`[data-rc-app]{…}`): custom properties on a
descendant beat `:root` for that subtree regardless of load order. Any new template
must do the same until the DS package itself is re-extracted.

**DC runtime gotchas** (all found the hard way, all still true):
- **Inline styles only.** `class` is not the idiom — `style="…"` plus `style-hover`
  / `style-focus`. The helmet `<style>` block is for what inline cannot express:
  `@keyframes`, `::before`, `::-webkit-scrollbar`, media queries.
- **`box-sizing` is not inherited.** The app relies on a global `*{box-sizing:
  border-box}`; without an equivalent rule scoped to the template subtree, every
  padded rail overflows its grid column by exactly its horizontal padding.
- **Markup whitespace around `{{ }}` is trimmed.** `{{ mainBranch }} (default)`
  renders as `main(default)`. Put the whole string in one binding.
- **Attribute names are lowercased** by the HTML parse, so React camelCase SVG
  props arrive as `fillrule`/`strokewidth`. Use kebab-case (`fill-rule`,
  `stroke-width`) — React passes it through and applies it correctly. It logs an
  "Invalid DOM property" warning either way; that noise is inherent to the runtime
  and is present in the Runcastle Logo template too.

**Verifying a template locally** (no Design round-trip needed):
1. `mkdir -p .design-sync/.cache/render/templates/app-redesign` (gitignored).
2. Copy `ds-bundle/{_vendor,fonts,styles.css,_ds_bundle.css}` into `render/`, and
   `support.js` + `ds-base.js` into `render/templates/app-redesign/`.
3. Copy the template in, inserting `<script src="../../_vendor/react.js">` and
   `react-dom.js` **before** `./support.js` — the runtime needs `window.React` and
   does not load it itself.
4. `python -m http.server` from `render/`, then drive it with playwright. Check
   every phase (ideation / tickets / build / review / shipped), the read-only pin,
   and the new-feature form.

## Render check (playwright)

- Playwright **1.61.1** pins chromium build **1228**, which is cached at
  `%LOCALAPPDATA%\ms-playwright`. If a future run hits "Executable doesn't exist",
  match the installed playwright version to a cached `chromium-<build>` dir.

## Known render warns

- None. A clean run prints no `[RENDER_*]`/`[FONT_*]`/`[TOKENS_*]` warnings.

## Re-sync risks (what can silently go stale)

- **The DS is a hand-extraction, not a live mirror.** If `apps/web/src/styles.css`
  changes runcastle's visual language (colours, type, hairlines), this DS will NOT
  auto-track it — re-extract by hand and rebuild. The **Screens** especially: their
  layout CSS and mock data were copied from the app's real components
  (`apps/web/src/components/**`) at build time; a structural change to those screens
  won't propagate here. A redesign done in Claude Design imports back by re-wiring
  tRPC data/handlers into the new layout, not as a file swap.
- **The DS package has drifted from the app and is the next thing to re-extract.**
  As of 2026-07-25 `_ds_bundle.css` still ships the pre-redesign palette and metrics
  (see the token trap above), and the `screens/*` components predate the current
  shell entirely — no brand mark or two-tone wordmark, no settings button, no
  tabbed inspector, no triage lanes (`Needs you` / `Agent working` / `In progress` /
  `Shipped`), gates labelled G0–G4 instead of the real G1–G5, and `implementation`
  not yet labelled `build`. The **template** was brought up to date on that date and
  is now the accurate picture; the component cards are not.
- The 15-component scope is curated. Adding a component means: author it in
  `packages/design-system/src/components/`, export it from `src/index.ts`, author a
  `.design-sync/previews/<Name>.tsx` (with a dark stage), rebuild, grade, re-upload.
- Font woff2 are committed under `src/fonts/`, so re-sync does not refetch @fontsource
  — but the `@fontsource/jetbrains-mono` devDep is only used to source them.
- `.design-sync/conventions.md` enumerates token names — re-validate them against the
  fresh `_ds_bundle.css` on every re-sync (the conventions-header step does this).
