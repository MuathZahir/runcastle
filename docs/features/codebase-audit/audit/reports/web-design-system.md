# Audit report — `packages/design-system` + apps/web prototypes / tests / config

Scope owner: WEB-FRONTEND orchestrator (this sub-scope analyzed directly, not delegated).
Static analysis only. No source edited.

**Headline verdict: `packages/design-system` is DEAD to the running product.**
`apps/web` does not depend on it, does not import it, and never has. It is a
design-time export consumed only by `.design-sync/previews/*`. Its stylesheet
duplicates 94 class names with `apps/web/src/styles.css` under drifted token
values, and its `screens/*` are mock reconstructions of app components that have
since moved on. This is documented — `.design-sync/NOTES.md` says so plainly —
which downgrades it from "surprise" to "known debt with no owner or expiry".

---

## A. Flow map

There are **two disjoint flows**. They never touch.

**Flow 1 — the shipped app (design-system absent):**

```
apps/web/index.html:11            <script src="/src/main.tsx">
  → apps/web/src/main.tsx:10       import './styles.css'        ← app's OWN 3859-line sheet
    main.tsx:8-9                   import '@fontsource-variable/inter'
                                   import '@fontsource-variable/jetbrains-mono'
  → main.tsx:6                     import { App } from './App'
    → apps/web/src/ui.tsx          app's OWN 93-line primitive set
    → apps/web/src/components/**   31 components, all local
  (zero references to @runcastle/design-system anywhere under apps/web)
```

**Flow 2 — the design-sync round trip (app absent):**

```
.design-sync/config.json:2         "pkg": "@runcastle/design-system"
  → buildCmd: bunx tsc -p packages/design-system/tsconfig.json  → dist/
  → .design-sync/previews/*.tsx    25 preview files, the ONLY importers
    → packages/design-system/src/index.ts
      → src/components/*.tsx (15 atoms)
      → src/screens/*.tsx     (9 mock screens)
      → src/styles.css + src/fonts/fonts.css (+ 4 vendored woff2)
  → uploaded to Claude Design project e3ec89ac-…
  → templates/app-redesign authored THERE, mirrored back to
    .design-sync/templates/app-redesign/AppRedesign.dc.html
  → a redesign returns to apps/web "by re-wiring tRPC data/handlers into the new
    layout, not as a file swap" (.design-sync/NOTES.md, "Re-sync risks")
```

**Build/verify flow (relevant to §D2):**

```
.github/workflows/release.yml:61-63   bun run typecheck
  → package.json:17  "typecheck": "bun run --filter '@runcastle/core'
                                   --filter '@runcastle/server' typecheck"
                                   ← apps/web and packages/design-system NOT included
.github/workflows/release.yml:64-66   bun run test  → vitest.config.ts include:
                                   packages/*/test + apps/*/test  (pure-lib only)
.github/workflows/release.yml:68-72   working-directory: packages/server
                                   bun run build:pkg
  → packages/server/scripts/build-package.ts:73  "• building web SPA"  (vite build)
  → :86  cpSync(apps/web/dist → OUT/web)
     vite/esbuild STRIPS types without checking them.
```

---

## B. Dead code

### B1. `packages/design-system` has zero consumers in the product — `dead:design-system-package`
- **Kind:** violation (verified) · **Confidence:** high · **Effort:** — (see G1 for options)
- **Evidence — dependency absent.** `apps/web/package.json:12-27` lists
  `@runcastle/core` and `@runcastle/server` as `workspace:*` deps. There is **no**
  `@runcastle/design-system` entry:
  ```json
  "@runcastle/core": "workspace:*",
  "@runcastle/server": "workspace:*",
  ```
- **Evidence — zero imports.** `grep -rn "design-system" apps/` returns **nothing**.
- **How verified:** repo-wide grep across `*.ts,*.tsx,*.json,*.js,*.html,*.css`
  excluding `node_modules`/`dist`. Every hit outside the package itself is under
  `.design-sync/` (25 preview files + `config.json`) or the README package table.
  Also checked for indirect wiring: no `paths` mapping in `apps/web/tsconfig.json`
  (its only alias is `"@runcastle/server"`), no `resolve.alias` in
  `apps/web/vite.config.ts`, no CSS `@import`.
- **Nuance that keeps this from being "delete it":** it is not orphaned — it is the
  input to a live design workflow (`.design-sync/config.json`, `NOTES.md`). It is
  dead *as a library*, alive *as an export format*. See G1.

### B2. `apps/web/prototypes/multi-project.html` is a self-declared throwaway that was never binned — `dead:multi-project-prototype`
- **Kind:** violation (verified) · **Confidence:** high · **Effort:** S · **Risk:** none
- **Evidence.** The file's own header, `apps/web/prototypes/multi-project.html:4-13`:
  ```
  THROWAWAY PROTOTYPE for wayfinder ticket #14 …
  Not wired to anything. Fold the winner into apps/web; bin the rest.
  ```
- **How verified:** grepped the whole repo for `multi-project` and `prototypes`.
  No hit from `vite.config.ts`, `package.json`, any script, or any source file —
  the only `multi-project` hits in source are doc comments crediting issue #45
  (`Shell.tsx:10`, `ProjectShell.tsx:24`, `Titlebar.tsx:10`, `CommandPalette.tsx:9`,
  `lib/workspace.ts:33`), i.e. **the winner was already folded in**. Its own
  instruction ("bin the rest") is therefore outstanding. 685 lines.
- Single commit `a1db67e prototype(web): multi-project switcher + cross-project overview UI (#14)`.

### B3. No dead exports *within* the design system
Per-export consumption census — every symbol in
`packages/design-system/src/index.ts:11-84` against a repo-wide importer search:

| Export | Importers outside the package | Where |
|---|---|---|
| Button, GhostLink, Input, Segmented, SectionTitle, DimLine, Tag, Chip, StatusDot, Spinner, Panel, Toolbar, Tabs, Stepper, Toast | 1 each | `.design-sync/previews/<Name>.tsx` only |
| AppShell, Titlebar, Sidebar, Inspector, StatusBar, OverviewScreen, TicketsScreen, RunScreen, TerminalScreen | 1 each | `.design-sync/previews/<Name>.tsx` only |
| **`apps/web` importers** | **0** | **—** |

So every export has exactly one importer and it is always a preview file. Nothing
is dead relative to the previews; the whole surface is dead relative to the app.
(Verified by grepping each exported identifier repo-wide, not just the package path.)

---

## C. Redundancy & repeated logic

### C1. Two full stylesheets define 94 of the same class names with drifted values — `redundant:design-tokens`
- **Kind:** violation · **Confidence:** high · **Effort:** M · **Risk:** medium (visual)
- **Scale.** `packages/design-system/src/styles.css` declares 186 top-level class
  selectors; `apps/web/src/styles.css` declares 613. **94 names are defined in
  both** — i.e. **just over half the design system's surface is a second,
  divergent implementation of classes the app already ships.** Shared names include
  the whole primitive set and whole app regions: `.btn .btn-solid .btn-ghost
  .btn-danger .btn-xs .chip .tag .status-dot .spinner .toast .panel-ish .shell
  .sidebar .inspector .statusbar .titlebar .ledger .ledger-row .run-lanes
  .run-split .stream-line .lane .lane-head …`
- **The token values have drifted**, so the same class name renders differently in
  each sheet. `packages/design-system/src/styles.css:15-61` vs
  `apps/web/src/styles.css:9-70`:

  | Token | design-system | apps/web | `docs/UI-SPEC.md` §4 |
  |---|---|---|---|
  | `--bg` | `#0a0c0f` | `#090b10` | `#0A0C0F` (matches DS) |
  | `--panel` | `#0e1116` | `#0e1117` | `#0E1116` (matches DS) |
  | `--hairline` | `#1a2028` | `#1c2230` | `#1A2028` (matches DS) |
  | `--text` | `#c9d1d9` | `#dde3ed` | `#C9D1D9` (matches DS) |
  | `--accent` | `#8b5cf6` | `#7c6cf6` | `#8B5CF6` (matches DS) |
  | `--ph-ideation` | `#8b5cf6` | `#8b7cf8` | `#8B5CF6` (matches DS) |
  | `--ph-tickets` | `#d29922` | `#d7a94a` | `#D29922` (matches DS) |
  | `--radius` | `5px` | `7px` | `≤ 6px` (matches DS) |
  | `--control-h` | `26px` | `28px` | `26px` (matches DS) |
  | `--sidebar-w` | `240px` | `252px` | `240px` (matches DS) |
  | `--inspector-w` | `280px` | `300px` | `280px` (matches DS) |
  | `--sans` | `system-ui, …` | `"Inter Variable", …` | "system stack" (matches DS) |

  Note the pattern: **the design system still matches the binding UI-SPEC on every
  row; the shipped app has drifted from both.** UI-SPEC self-declares as a
  build-time doc and "the code is authoritative", so the app's values are the real
  ones — which makes the DS *and* the spec the stale pair, two documents now
  describing a palette nothing renders.
- **The drift is known and written down** — `.design-sync/NOTES.md`, "The token
  trap": *"that sheet's `:root` still carries the OLD palette … the app has since
  moved to `#090b10` / `#7c6cf6` / `#dde3ed` / `7px` / `252px`"*, and under
  "Re-sync risks": *"The DS package has drifted from the app and is the next thing
  to re-extract."* The workaround shipped instead was to have the *template*
  redeclare current tokens on its own root (`[data-rc-app]{…}`) — a per-template
  patch that every future template must repeat.
- **Suggested module:** one token source. See G2.

### C2. JetBrains Mono is provisioned three separate ways — `redundant:font-provisioning`
- **Kind:** judgement call · **Confidence:** high · **Effort:** S · **Risk:** low
- `apps/web/package.json:13` `"@fontsource-variable/jetbrains-mono"`, loaded at
  `apps/web/src/main.tsx:9`.
- `packages/design-system/src/fonts/fonts.css:7-30` — four hand-vendored woff2
  (`jetbrains-mono-latin-{400,500,600,700}-normal.woff2`) with hand-written
  `@font-face` blocks.
- `packages/design-system/package.json:31` devDep `"@fontsource/jetbrains-mono"`,
  which `.design-sync/NOTES.md` confirms is *"only used to source them"* — i.e. a
  dependency kept purely as a copy-paste origin for files already committed.
- The mono stacks also disagree: DS ships `"JetBrains Mono", ui-monospace, Consolas`
  (NOTES.md records Cascadia Code was deliberately dropped to avoid a
  `[FONT_MISSING]` warning), while the app ships
  `"JetBrains Mono Variable", "Cascadia Code", Consolas, …`
  (`apps/web/src/styles.css:52`). UI-SPEC §4 pins `Cascadia Code, JetBrains Mono,
  Consolas`. Three stacks, three orders.

---

## D. Inconsistencies & structural smells

### D1. `screens/*` duplicate live app components as mock reconstructions, and have drifted — `divergent:design-system-screens`
- **Kind:** violation · **Confidence:** high · **Effort:** M · **Risk:** low
- Nine files under `packages/design-system/src/screens/` carry the same names as
  live components in `apps/web/src/components/`: `Sidebar`, `StatusBar`,
  `Titlebar`, `Inspector` (+ `AppShell`, `TerminalScreen`, `TicketsScreen`,
  `RunScreen`, `OverviewScreen` against `Workspace.tsx`/`bodies/*`). They are
  hardcoded-mock-data copies — `packages/design-system/src/screens/Inspector.tsx:37`:
  ```ts
  { time: '9m', type: 'gate.pass', message: 'G2 tickets approved' },
  ```
- **The drift is enumerated in `.design-sync/NOTES.md`** ("Re-sync risks"): the
  screens *"predate the current shell entirely — no brand mark or two-tone wordmark,
  no settings button, no tabbed inspector, no triage lanes (`Needs you` / `Agent
  working` / `In progress` / `Shipped`), gates labelled G0–G4 instead of the real
  G1–G5, and `implementation` not yet labelled `build`."*
- **Confirmed against source:** `packages/core/src/pipeline.ts:9` is the canonical
  `export type GateId = 'G1' | 'G2' | 'G3' | 'G4' | 'G5'`, and the DS screens do
  render `G3` / `G2` strings inline (`screens/Inspector.tsx:70`, `:37`) as prose,
  not from the type.
- **Why it still matters despite being documented:** UI-SPEC §2's tab model
  (`Tabs.tsx` is an exported primitive, and `TabsProps`/`TabItem` model a VS-Code
  tab strip with close buttons) is a model the live app **abandoned** — the app is
  pipeline-first with a gate-aware next-step bar, per the parent brief and
  `docs/UI-SPEC.md`'s own build-time caveat. So the design system's public surface
  still advertises an interaction model the product removed. Anyone redesigning
  *from* this package would redesign the wrong app.

### D2. `apps/web` and `packages/design-system` are never typechecked — by anything — `gap:typecheck-coverage`
- **Kind:** violation · **Confidence:** high · **Effort:** S · **Risk:** low
- `package.json:17`:
  ```json
  "typecheck": "bun run --filter '@runcastle/core' --filter '@runcastle/server' typecheck",
  ```
  Two explicit filters. `@runcastle/web` and `@runcastle/design-system` are excluded.
- Both excluded packages **do** define the script — `apps/web/package.json:9`
  `"typecheck": "tsc --noEmit"`, `packages/design-system/package.json:26`
  `"typecheck": "tsc -p tsconfig.json --noEmit"` — so the scripts exist and are
  simply never invoked by any caller.
- CI does not compensate: `.github/workflows/release.yml` has exactly one
  typecheck step (`:61-63 run: bun run typecheck`) using that same filtered script.
  The only other thing touching web is `:68-72 bun run build:pkg` →
  `packages/server/scripts/build-package.ts:73` `'• building web SPA'`, a **vite**
  build. Vite/esbuild strips TypeScript without checking it.
- **Consequence:** ~12.3k lines (15.6k with tests) of `apps/web` TypeScript plus ~1.2k of design-system
  can be type-broken and still cut a release. This is the single cheapest fix in
  this report (add two `--filter` flags).
- **Related:** `bun run build:pkg` is invoked at `release.yml:72` with
  `working-directory: packages/server`, and `build:pkg` is defined only in
  `packages/server/package.json:22` — so that step is correct, but a developer
  running `bun run build:pkg` from the repo root gets nothing.

### D3. `packages/design-system/tsconfig.json` is the only package config that forks off the shared base — `inconsistent:tsconfig`
- **Kind:** judgement call · **Confidence:** high · **Effort:** S · **Risk:** low
- `packages/core/tsconfig.json`, `packages/server/tsconfig.json`, and
  `apps/web/tsconfig.json` all `"extends": "../../tsconfig.base.json"`.
  `packages/design-system/tsconfig.json:1-24` extends nothing and restates
  everything, diverging on real settings:
  | | base | design-system |
  |---|---|---|
  | `target` | `ESNext` | `ES2020` |
  | `lib` | `["ESNext"]` | `["ES2020","DOM","DOM.Iterable"]` |
  | `isolatedModules` | `true` | **absent** |
  | `noUnusedLocals` / `noUnusedParameters` | absent | `true` (stricter) |
- It legitimately needs `declaration`/`outDir`/`rootDir` (it is the only package
  that emits), but that is an `extends` + 4-line override, not a fork. It is
  simultaneously stricter (unused locals) and looser (no `isolatedModules`,
  older target) than the rest of the repo — divergence in both directions is the
  tell that it was written standalone and never reconciled.

### D4. `Phase` is re-declared as a local string union in three design-system files — `primitive-obsession:phase`
- **Kind:** violation · **Confidence:** high · **Effort:** S · **Risk:** low
- `packages/design-system/src/screens/Inspector.tsx:5`, `screens/OverviewScreen.tsx:6`,
  `screens/Sidebar.tsx:4` each declare, verbatim:
  ```ts
  type Phase = 'ideation' | 'spec' | 'tickets' | 'implementation' | 'review' | 'shipped'
  ```
  plus `screens/Inspector.tsx:6` `const PHASE_ORDER: Phase[] = [...]` restating the
  order, and `components/Tag.tsx:8` a fourth copy as the `tone` union.
- The canonical definition lives in `packages/core/src/pipeline.ts`. Four
  independent copies of the product's central enum, in a package that cannot
  import core (it has no dependency on it — deliberately, it must render
  standalone). That constraint is real, which makes this a *symptom* of the
  package's isolation rather than a careless duplication — but it is exactly the
  duplication that let `implementation` survive here after the app relabelled it
  `build`.

---

## E. Wrong-tool & weak typing

### E1. `StatusDot` and `Spinner` document `title` as an "accessible label"; it is not one — `a11y:status-affordances`
- **Kind:** violation · **Confidence:** high · **Effort:** S · **Risk:** low
- `packages/design-system/src/components/StatusDot.tsx:7-8, 18`:
  ```ts
  /** Accessible label, rendered as the title tooltip. */
  title?: string
  …
  return <span className={cls} title={title} />
  ```
  Same shape at `components/Spinner.tsx:4-5, 14`.
- Both render an **empty `<span>`** — no text content, no `role`, no `aria-label`.
  `title` on a non-interactive, non-focusable element is not reliably exposed by
  screen readers and is unreachable by keyboard. The JSDoc asserts an
  accessibility property the implementation does not provide, which is worse than
  silence: a consumer reads "accessible label" and stops looking.
- `Spinner` additionally has no `role="status"` / `aria-live`, so an
  indeterminate-progress indicator announces nothing when it appears.

### E2. `Tabs` gives tabs `role="tab"` on non-focusable `<div>`s — `a11y:tabs-keyboard`
- **Kind:** violation · **Confidence:** high · **Effort:** S · **Risk:** low
- `packages/design-system/src/components/Tabs.tsx:36-42`:
  ```tsx
  <div
    key={tab.id}
    className={`tab${active ? ' is-active' : ''}`}
    role="tab"
    aria-selected={active}
    onClick={() => onSelect?.(tab.id)}
  >
  ```
- No `tabIndex`, no `onKeyDown`, no roving tabindex, and the wrapper
  (`:32 role="tablist"`) has no arrow-key handling. Declaring ARIA tab semantics
  without the keyboard contract is a stated-but-unimplemented interface: assistive
  tech announces "tab, selected" for something that cannot be reached or activated
  by keyboard at all. The close button inside (`:54-63`) *is* a real `<button>`
  with `aria-label="Close tab"`, so the tab itself is the only unreachable part —
  a keyboard user can close a tab but not select one.
- Contrast `Segmented.tsx:28-33`, which does it correctly (real `<button>`,
  `type="button"`, `aria-pressed`) and `GhostLink.tsx:16` / `Button.tsx:22`, which
  both render real buttons and default `type` to `'button'`. So the package knows
  the pattern; `Tabs` is the one that departs from it.

### E3. `Toast` has no live-region semantics — `a11y:toast`
- **Kind:** violation · **Confidence:** high · **Effort:** S · **Risk:** low
- `packages/design-system/src/components/Toast.tsx:14-16` is the whole component:
  ```tsx
  return <div className={`toast toast-${tone}`}>{children}</div>
  ```
  No `role="status"` / `role="alert"`, no `aria-live`. Its own doc calls it
  *"a transient bordered notification"* — transient content that is never announced
  is invisible to a screen reader by construction. `tone="error"` in particular
  should be `role="alert"`.

### E4. `Stepper` keys by array index — `weak:stepper-keys`
- **Kind:** judgement call · **Confidence:** medium · **Effort:** S · **Risk:** low
- `packages/design-system/src/components/Stepper.tsx:21-22`:
  ```tsx
  {steps.map((step, i) => (
    <div key={i} className={`step step-${step.state ?? 'todo'}`}>
  ```
  `Step` has no id field (`:1-6`), so index is the only available key. For a fixed
  six-phase pipeline this is harmless today; it is listed because the interface —
  not the implementation — is what forces it.

---

## F. Shallow modules / deletion-test candidates

### F1. `DimLine` and `SectionTitle` are one-line class wrappers — `shallow:ds-atoms`
- **Kind:** judgement call · **Confidence:** high · **Effort:** S · **Risk:** low
- `packages/design-system/src/components/DimLine.tsx:12-13` is the entire body:
  ```tsx
  export function DimLine({ children }: DimLineProps) {
    return <div className="dim-line">{children}</div>
  ```
  `SectionTitle.tsx:11-12` is identical modulo the class name. Interface ≈
  implementation exactly: the caller must know the component name instead of the
  class name, and gains nothing — no variant logic, no state, no invariant, no
  prop forwarding (neither accepts `className` or spreads `...rest`, so they are
  strictly *less* capable than the `<div>` they wrap).
- **Deletion test:** delete both, write `<div className="dim-line">` — zero
  complexity reappears at any call site.
- **Counter-argument, and why I file this as judgement call not violation:** for
  this package "component" is the unit of the design-tool catalogue — each atom
  needs its own `.design-sync/previews/<Name>.tsx` card
  (`.design-sync/config.json` `overrides` keys them by component name). A semantic
  wrapper that earns nothing in code can still earn its place as a catalogue
  entry. Worth an explicit decision rather than a silent one.
- `Tag.tsx:17`, `Chip.tsx:19`, `StatusDot.tsx:17`, `Spinner.tsx:14` are the same
  shape but do at least map props → class variants, so they clear the bar.

---

## G. Deepening / consolidation / extraction opportunities (ranked)

### G1. Decide what `packages/design-system` *is*, and write it down — `decide:design-system-status`
- **Value:** high · **Confidence:** high · **Effort:** S (decision) / L (if re-extracted) · **Risk:** low
- Right now the package occupies the worst position: it is shaped like a shared
  library (`package.json` exports map, `peerDependencies` on react, a README-style
  module doc at `src/index.ts:1-9` instructing *"Import the stylesheet once at your
  app root"*) and listed in the README's package table
  (`README.md:216 | packages/design-system | @runcastle/design-system | Near-black
  IDE-grammar UI primitives. |`) as a peer of core/server/web — while being a
  design-tool export that no product code imports and that everyone involved knows
  is stale.
- **Three honest options**, in ascending cost:
  1. **Label it.** Add one line to `src/index.ts` and the README row: "design-time
     export for Claude Design sync — not consumed by `apps/web`; see
     `.design-sync/NOTES.md`". Kills the misreading at the cost of one sentence.
     Also fold the `NOTES.md` staleness warning into a doc the audit trail sees.
  2. **Re-extract** from the current `apps/web/src/styles.css` + `ui.tsx`, which
     `.design-sync/NOTES.md` already names as *"the next thing to re-extract"*.
     Fixes C1/D1/D4 in one pass and retires the `[data-rc-app]` token workaround
     every new template currently has to carry.
  3. **Invert the dependency** — make it the real source and have `apps/web` import
     it (see G2). This is the only option that stops the drift recurring, and the
     most expensive.
- No ADR covers this. `docs/adr/` has nothing on the design system, and `CONTEXT.md`
  does not mention it — so per the briefing's "repo overrides the taxonomy" rule
  there is no documented decision to defer to, only an operational note.

### G2. One token source of truth — `extract:design-tokens`
- **Value:** high · **Confidence:** high · **Effort:** M · **Risk:** medium (visual regression)
- **Two real adapters exist today** (the app's sheet and the DS sheet), plus a
  third consumer (`AppRedesign.dc.html`, which per `.design-sync/NOTES.md` has to
  redeclare the whole current palette on `[data-rc-app]` precisely because it
  cannot trust `:root`). Three places that must agree on `--bg`; today none of them
  do. That is a real seam by the briefing's two-adapter rule, not a hypothetical.
- **Shape:** extract the `:root` token block to one `tokens.css` (~60 declarations,
  `apps/web/src/styles.css:9-70` is already a clean, comment-annotated block) that
  the app imports, the DS imports, and design-sync ships. Component rules stay where
  they are — this is only the token layer, which is what actually drifted.
- **Blast radius:** every visual surface, but mechanically it is a file move plus
  two `@import`s; the risk is that adopting one palette *changes* one of the two
  renderings on purpose.

### G3. Add `apps/web` + `packages/design-system` to the root typecheck — `fix:typecheck-coverage`
- **Value:** high · **Confidence:** high · **Effort:** S · **Risk:** low
- Two `--filter` flags in `package.json:17`. Both target scripts already exist
  (`apps/web/package.json:9`, `packages/design-system/package.json:26`). This is
  the highest value-per-effort item in the whole report: it closes a gate that
  currently lets 12.3k lines (15.6k with tests) of untypechecked TypeScript into a published release
  (D2). Caveat: expect it to fail on first run — nothing has enforced it, so drift
  has had free rein.

### G4. Delete `apps/web/prototypes/multi-project.html` — `fix:prototype-cleanup`
- **Value:** low-medium · **Confidence:** high · **Effort:** S · **Risk:** none
- 685 lines whose own header says to bin them once a variant is folded in, and the
  variant was folded in (issue #45 shipped; the components cite it). Kept as a
  separate item from G1 because it needs no decision — the decision is in the file.

### G5. Fix the design-system a11y contract on `Tabs`, `Toast`, `StatusDot`, `Spinner` — `fix:ds-a11y`
- **Value:** medium (low today — nothing consumes it; high if G1 option 3 is ever
  taken, since these defects would propagate into the product wholesale)
  · **Confidence:** high · **Effort:** S · **Risk:** low
- E1–E3. Ranked below the rest **only because the package is unconsumed**; it moves
  to the top the moment `apps/web` imports it. Worth fixing now precisely because
  it is free now — these are the bugs you do not want to discover during an
  adoption.

---

## H. Cross-cutting candidates to pass UP

- **`gap:typecheck-coverage`** — the root `typecheck` script
  (`package.json:17`) filters to `@runcastle/core` + `@runcastle/server`, so
  `apps/web` (12.3k lines (15.6k with tests)) and `packages/design-system` (1.2k) are typechecked by
  **nothing**, including the release workflow
  (`.github/workflows/release.yml:61-63`, and `:68-72`'s vite build strips types
  without checking). Both excluded packages define working `typecheck` scripts that
  no caller invokes. **Repo-wide verification-gate finding, not a web finding** —
  the root agent should confirm whether any other package is similarly orphaned
  from the gate, and whether the absence of any CI workflow other than
  `release.yml` (no PR/push CI at all) is deliberate. Cheapest fix in the audit.

- **`redundant:design-tokens`** — the same ~60 design tokens are declared three
  times with different values (`packages/design-system/src/styles.css:15-61`,
  `apps/web/src/styles.css:9-70`, and again inline in
  `.design-sync/templates/app-redesign/AppRedesign.dc.html` on `[data-rc-app]`),
  and 94 CSS class names are defined in both stylesheets. Sibling scopes will
  likely also report style/token drift from `docs/UI-SPEC.md` §4; this is the
  root cause — **the app has drifted from UI-SPEC and UI-SPEC still matches the
  design system**, so every "app doesn't match the spec's colours" finding across
  the tree collapses into this one. Parent should merge those.

- **`doc-drift:ui-spec`** — `docs/UI-SPEC.md` §4 is pinned to the *old* palette and
  metrics (`#0A0C0F`, `#8B5CF6`, 240px sidebar, 26px controls, radius ≤6px) that
  only the unconsumed design system still renders, and §2's typed-tab model
  (`overview│terminal│tickets│run` tab strip, tab state in localStorage) describes
  an interaction model the pipeline-first app abandoned. The doc self-declares as
  build-time, but it is still the document a new agent is told to implement
  "EXACTLY" (`docs/UI-SPEC.md:8`). **Likely the largest doc-drift cluster in the
  repo** — siblings auditing server/core will hit the same "SPEC says X, code does
  Y" shape. Recommend the root treat build-time-doc drift as one finding class
  with a single disposition, rather than N per-scope reports.

- **`primitive-obsession:phase`** — the six-phase union
  (`'ideation'|'spec'|'tickets'|'implementation'|'review'|'shipped'`) is
  canonically `packages/core/src/pipeline.ts` but is re-declared verbatim in at
  least four more places inside the design system alone
  (`screens/Inspector.tsx:5`, `screens/OverviewScreen.tsx:6`, `screens/Sidebar.tsx:4`,
  `components/Tag.tsx:8`) — and the phase→label mapping (`implementation` vs the
  app's `build`) has already diverged as a direct result. **Sibling web and server
  scopes almost certainly have their own copies and their own switches on this
  type**; the parent should count the total copies repo-wide, because "how many
  files must change to add a phase" is the shotgun-surgery number that matters.

- **`a11y:aria-without-keyboard`** — the pattern of declaring ARIA roles without
  the keyboard contract (`Tabs.tsx:36-42`: `role="tab"` on a `<div>` with no
  `tabIndex`/`onKeyDown`), and of documenting `title` on a bare `<span>` as an
  "accessible label" (`StatusDot.tsx:7`, `Spinner.tsx:4`). **Sibling web scopes are
  being asked the same question about `CommandPalette`, menus, dialogs, and the
  terminal** — if two or more report it, this is one repo-wide accessibility
  finding about clickable non-buttons, not five local ones.

- **`dead:design-system-package`** — flagged up not for deletion but because the
  README package table (`README.md:216`) presents `@runcastle/design-system` as a
  first-class package alongside core/server/web, and `CLAUDE.md`'s package map does
  the same. Any sibling reading those docs to orient itself will believe the app
  consumes it. If the root agent is reconciling `CLAUDE.md`/README against reality,
  this row belongs on that list.
