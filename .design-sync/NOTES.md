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

## Render check (playwright)

- Playwright **1.61.1** pins chromium build **1228**, which is cached at
  `%LOCALAPPDATA%\ms-playwright`. If a future run hits "Executable doesn't exist",
  match the installed playwright version to a cached `chromium-<build>` dir.

## Known render warns

- None. A clean run prints no `[RENDER_*]`/`[FONT_*]`/`[TOKENS_*]` warnings.

## Re-sync risks (what can silently go stale)

- **The DS is a hand-extraction, not a live mirror.** If `apps/web/src/styles.css`
  changes runcastle's visual language (colours, type, hairlines), this DS will NOT
  auto-track it — re-extract by hand and rebuild.
- The 15-component scope is curated. Adding a component means: author it in
  `packages/design-system/src/components/`, export it from `src/index.ts`, author a
  `.design-sync/previews/<Name>.tsx` (with a dark stage), rebuild, grade, re-upload.
- Font woff2 are committed under `src/fonts/`, so re-sync does not refetch @fontsource
  — but the `@fontsource/jetbrains-mono` devDep is only used to source them.
- `.design-sync/conventions.md` enumerates token names — re-validate them against the
  fresh `_ds_bundle.css` on every re-sync (the conventions-header step does this).
