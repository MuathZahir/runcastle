# Outcome — Web UI foundation: Tailwind, tokens, primitives, and carving feature-ui

Lay the shared visual and code foundation the seven per-flow redesign features build on: Tailwind v4 with the existing tokens as the theme, rebuilt ui.tsx primitives, feature-ui.ts and Workspace.tsx carved by concern, and the rule that each flow migrates its own surface off styles.css.

- Shipped: 2026-08-28
- Lap: 1

## 1. Tailwind v4 theme, legacy aliases, test infra, retire design-system, STYLE.md + ratchet

# Ticket 1 — Tailwind v4 theme, legacy aliases, test infra, design-system retirement, STYLE.md + ratchet

## What was done

`apps/web` now builds on Tailwind v4 through `@tailwindcss/vite`. Every token that
used to be a literal in the `:root` block of `styles.css` lives in a new
`apps/web/src/theme.css` `@theme` block under Tailwind namespaces, at the decision-4
scale (body 14px/1.5, `--control-h` 32px, radii 6/8/12, type ramp 11/12/14/16/20, no
custom spacing). `styles.css`'s `:root` is now nothing but aliases onto those tokens
under a loud `LEGACY ALIASES` header, so all ~4,300 rules below it resolve untouched.
`packages/design-system` and `.design-sync/` are deleted, with the root `typecheck`
filter, README, CLAUDE.md and `.gitignore` references cleaned up. The vitest apps glob
takes `.tsx`; `happy-dom` and `@testing-library/react` are root devDeps; `apps/web/test`
is now typechecked; `test/dom-environment.test.tsx` is the copy-able tier-2 example and
`test/styles-ratchet.test.ts` pins `styles.css` at 4430 lines. `apps/web/STYLE.md`
carries the tokens, scale, both test tiers, decision 9's migration rule and the ratchet;
CLAUDE.md and `docs/UI-SPEC.md` point at it.

Two deviations from the ticket's wiring sketch, both to hold the zero-visual-change
contract, and both explained in comments at the top of `theme.css`:

- **`@import "tailwindcss"` was replaced by the documented preflight-free import**
  (`@import "tailwindcss/theme.css" layer(theme)` + `.../utilities.css layer(utilities)`).
  Preflight's `ol, ul { list-style: none }` alone would strip every markdown bullet in
  the app — `.md ul` sets only margin and padding, and `.md li::marker` exists
  specifically to colour the marker preflight removes. Preflight arrives when the legacy
  sheet is gone.
- **`@theme static`, not plain `@theme`.** The alias block reads the tokens by `var()`
  from a stylesheet Tailwind does not process, so Tailwind cannot see those uses and
  would tree-shake most of the tokens out of the emitted `:root`. Verified against the
  built CSS that all 18 sampled token names emit and no default palette colour does.

One `styles.css` rule outside `:root` did change: the `body` font-size and line-height,
because acceptance criterion 2 names the 14px/1.5 body scale and `styles.css` is imported
after `theme.css`, so it is the only place that setting can win.

## Surprises

- **Unlayered legacy CSS beats layered Tailwind utilities**, whatever the specificity.
  `styles.css` is unlayered and utilities live in `@layer utilities`, so a utility on an
  element that still carries a legacy class is silently overridden. This is not a problem
  for this ticket (nothing uses utilities yet) but it will bite ticket 2 the moment a
  rebuilt primitive keeps an old class name. Written up in STYLE.md.
- `--ease` / `--ease-out` had to be renamed `--ease-app` / `--ease-out-app` in the theme:
  the un-suffixed names would redefine Tailwind's own `ease-out` utility.
- Fourteen token names (`--radius-sm/-lg/-pill`, `--control-h`, the four widths,
  `--shadow-*`, `--dur-*`, `--ring`) are spelled identically in both files, so they are
  deliberately *absent* from the alias block — re-declaring them there would shadow the
  theme from an unlayered rule.
- Typechecking `apps/web/test` for the first time surfaced exactly three latent errors,
  all in test code: a probe literal missing `tier`/`severity`, a `driveFailure` literal
  tripping TS's weak-type check, and a finding factory typed narrower than `FindingLike`.
  Fixing them needed one one-word src change: exporting the `Probe` type alias.
- `@testing-library/react` v16 has `@testing-library/dom` as a *peer*, not a bundled dep,
  so that had to be installed too (the ticket named only two packages).
- **Two test files fail in this sandbox and are not mine.** `burn-slot-workspace.test.ts`
  (7 failures): this container sets `TMPDIR=/home/agent/cache/tmp`, which sits *inside*
  `BURN_CACHE_MOUNT = '/home/agent/cache'`, so the test's own `mkdtemp` fixture paths get
  mangled by its second `replaceAll`. Proved it: all 33 pass under
  `TMPDIR=/tmp/rc-tmp`. `dev-pane.test.ts` (1 failure) asserts a killed process group is
  reaped, which is this container's init behaviour; `git diff --stat` confirms my four
  commits touch nothing under `packages/server`. Note the prompt's baseline (118 files,
  1768 tests) does not match this tree (146 files, 2466 tests) — that baseline looks stale.

## Verified

`bun run typecheck` — 0 errors. `bun run --cwd apps/web build` — succeeds. `bun run test`
— 143 files / 2454 tests pass; the only failures are the two environmental files above.
Drive machinery: no edit needed — this ticket adds dependencies and a build-time Vite
plugin, no service, env var, seed or process, which is exactly the case
`.runcastle/drive-setup.ts` already covers with its unconditional `bun install` + SPA
build. Checked offline that both drive scripts still parse, that every path they name
still exists (none was under `packages/design-system`), and that neither mentions the
deleted directories. Did not run them — no services in this sandbox.

## Left undone

- **The five overlays still roll their own Escape/backdrop/portal/focus.** Ticket 2's
  `Dialog` work, untouched here.
- **`styles.css` still hardcodes pixels everywhere** — 5/7/10px radii, 28px control
  heights, 10px/11.5px type — which now disagree with the theme scale. That mixed look is
  accepted (decision 4); each flow fixes its own surface.
- **The type ramp, radius and shadow namespaces were reset** (`--text-*: initial` etc.)
  beyond the `--color-*: initial` the ticket named, so `text-3xl` and `shadow-lg` do not
  resolve. That is the decision-4 scale enforced at the tool level; if a flow feature
  genuinely needs a sixth type step, it needs a decision, not a token.
- **The `feature-ui.ts` / `Workspace.tsx` carve and the primitives rebuild** are tickets
  2 and 3; nothing here touches them.

## 2. Carve lib/feature-ui.ts into concern modules and per-phase nextStep resolvers

What was done
Carved the monolithic web feature UI derivations into creation, pipeline, sidebar, gates, drive, review, laps, summary, map, and session concern modules.
Replaced feature-ui.ts with an importer-neutral barrel preserving the original public exports.
Split nextStep into a shared preamble/dispatcher and draft, ideation, spec, tickets, implementation, review, and shipped resolvers.
Moved shared private next-step helpers to internal.ts and shared public action types to next-step/types.ts.
Kept every importer and both seam test files unchanged; no drive machinery change was needed because this ticket adds no service, boot environment, seed, or companion process.

Surprises
The monolith hid one-way dependencies from summary to review/map and from session to gates/map; these were made explicit without cycles.
The full repository test run passed 139 files but four unrelated server files failed from the sandbox environment: inherited GIT_PAGER/OAuth values, shared temp repositories disappearing, and an unreaped process group.
All 22 web test files passed (605 tests), including feature-ui and lap-sections, and the root typecheck passed.

Left undone
No importer was changed to use concern modules directly; the barrel remains the compatibility seam as specified.
No Workspace component carve or flow redesign was attempted because those belong to other tickets.

## 3. Carve Workspace.tsx helpers into components/workspace/

What was done
Workspace rendering helpers were mechanically extracted into `apps/web/src/components/workspace/`.
NextStepBar, PipelineStepper, LapBannerRow, the feature panes, and the resume-failure hook now have isolated files.
The shared clipboard helper was extracted because both Workspace and BrokenFeaturePane consume it.
Workspace.tsx now retains Workspace query/action wiring and PhaseBody dispatch, and re-exports FeatureCrash for ProjectShell.
A static-render seam test covers all pipeline phases, current-step marking, and the unrecognized phase value.

Surprises
The full suite reached 2,449 passing tests but had 12 unrelated server failures caused by inherited GIT_PAGER/Claude-token state and shared temporary worktree teardown.
The scoped workspace test, root typecheck, and web production build all passed.

Left undone
No lib modules or ProjectShell were changed, and no flow styling or behavior was redesigned.
Drive machinery was not changed or run because this extraction adds no service, environment variable, seed, or companion process.

## 4. Rebuild existing ui.tsx primitives on theme utilities

# Ticket 4 — rebuild the ui.tsx primitives on theme utilities

## What was done

Every primitive in `apps/web/src/ui.tsx` now carries inline Tailwind utilities on the
theme tokens, composed by a local (unexported) `cx()` helper. No new dependency, no
`@apply`, and — this is worth knowing for the flow features — **no `@utility` escape
hatch was needed**: the phase and status colour families are `Record<Enum, string>`
lookup maps whose values are whole literal class names (`'text-ph-implementation'`),
which the content scanner sees. Interpolating `` `text-ph-${phase}` `` would not have
worked. Props are unchanged and no importer moved. Buttons are 32px with `rounded-md`,
chips are 20px with 11px mono text, the empty state's title is 14px — the app picks up
the decision-4 scale on those surfaces. `apps/web/test/ui.test.ts` (tier 1) covers every
export; `lap-sections`, `enable-afk-card` and `review-findings` were retargeted off the
deleted class names. `styles.css` drops 123 lines (4430 → 4307, ratchet lowered) and
`STYLE.md` gains the catalogue, the one-solid-button rule, and a legacy-hooks table.

Two deviations. **Focus rings are not in the class lists.** `styles.css` has an
unlayered global `:focus-visible { box-shadow: var(--ring) }` that already paints every
one and would shadow a utility repeating it — the ticket's sketch asked for one, and
writing it would have been dead CSS. **Three primitives keep one legacy class name as a
hook**, documented in a STYLE.md table: `SectionTitle` keeps `section-title`, `DimLine`
keeps `dim-line mono`, `LapSections` keeps `lap-group`/`lap-group-head`. Surviving
surface-scoped rules place them (`.body-title`, `.mr-head`, `.map-waypoints > .dim-line`,
`.ledger .lap-group-head`), and dropping the names would have silently lost the map
rail's title stretch and its dashed placeholder, and the ledger's header band.

## Surprises

- **Half the "primitive" class names are also used by raw JSX**, so their rules could not
  be deleted: `.btn*` (WalkthroughPlayer, EndSessionButton, PortfolioHome, GrillBody,
  SessionPanel, ProjectShell, ProjectWorkspace all render `<button className="btn ...">`
  by hand), `.chip` + `.chip-neutral` (TicketsBody), `.tag` (Workspace, FeaturePanes),
  `.section-title` (RunBody), `.dim-line` (ErrorBoundary). Those stay. The visible
  consequence is that a hand-rolled `.btn` and a `<Button>` no longer look the same until
  those surfaces migrate — the accepted mixed look, but it is more mixed than "legacy
  rules keep their pixels" suggests.
- `.btn-xs` is passed as `className` to `<Button>` in seven places. It still wins over the
  utilities (unlayered), so small buttons stayed small — no action needed, but it means
  those buttons did *not* pick up the 32px height.
- The `<details>` caret was CSS (`summary::before` flipping ▸/▾ on `[open]`). It survives
  as `group` on the `<details>` plus `group-open:before:content-['▾']` on the summary,
  which Tailwind v4 compiles correctly — verified in the built CSS, not assumed.
- Without preflight, `border-width` alone would not paint. Tailwind v4 saves this: it
  declares `@property --tw-border-style { initial-value: solid }`, which is emitted
  independently of preflight. Confirmed in `dist/assets/*.css`.
- **The prompt's baseline is stale** (it says 118 files / 1768 tests). This tree runs 148
  files / 2486 tests. `bun run test` ends with 8 failures, all in `packages/server` and
  all environmental — the same two files ticket 1 documented: `burn-slot-workspace.test.ts`
  (7; this container's `TMPDIR` sits inside `BURN_CACHE_MOUNT`) and `dev-pane.test.ts`
  (1; process-group reaping). My diff touches only `apps/web`; every one of the 26
  `apps/web` test files passes (628 tests).

## Verified

`bun run typecheck` — 0 errors. `bun run --cwd apps/web build` — succeeds, and I grepped
the emitted CSS to confirm each unusual utility actually resolves (`h-(--control-h)`,
`w-23`, `ring-3 ring-ok/15`, `animate-[pulse_1.5s_...]`, `group-open:before:content`,
`[&::-webkit-details-marker]:hidden`, `bg-ph-implementation/8`, `enabled:hover:*`).
`env -u GIT_ASKPASS bun run test` — as above. Grepped `apps/web/src` and `apps/web/test`
for every deleted class name: the only hit is the word "empty-state" inside a prose
comment in `Shell.tsx`. Drive machinery: no edit needed — this ticket adds no service,
env var, seed or process. Checked offline that both `.runcastle/drive-*.ts` still parse
under `bun build --no-bundle` and that neither names any file I touched; did not run
them, as there are no services in this sandbox.

## Left undone

- **`.chip-blocked` in `styles.css` is dead** — no JSX has referenced it since before this
  ticket. I left it: it never served a `ui.tsx` primitive, so deleting it is the surface
  owner's call under the migration rule.
- **`docs/UI-SPEC.md` §4 still describes the old primitives.** Ticket 1 added the header
  note that STYLE.md supersedes it; I did not rewrite §4 itself.
- **`.mono` (12.5px) and `.dim` are still legacy atoms** used all over the app and were
  out of this ticket's list. They are the obvious next atoms to retire.
- **`LapSections` is not in `ui.test.ts`** — `test/lap-sections.test.ts` already covers it
  and passes unmodified except for the two class-name assertions.

## 5. Dialog, Field, Card/Section, Kbd primitives; overlays adopt Dialog mechanics

# Ticket 5 — Dialog, Field, Card/Section, Kbd; the five overlays on Dialog

## What was done

`apps/web/src/ui.tsx` gains five primitives — no new file, no `ui/` directory
(a `src/ui/` beside `src/ui.tsx` would make every `from '../ui'` ambiguous to
read). `Dialog` portals into `<body>`, sets `role="dialog"` + `aria-modal`,
closes on Escape only when the focus is inside it (FormOverlay's ownership guard,
ported verbatim — `null`/`<body>` still counts as inside), dismisses on a
backdrop **mousedown** with the target-equality guard, focuses the panel on open
and restores the opener on close, and takes `dirty` + `discardPrompt` for the
discard question. `Field` clones its child control with an `id` and
`aria-describedby`; `Card`, `Section` (a separate export, not a `Card` prop —
the spec left that open) and `Kbd` are plain theme-utility surfaces.
FormOverlay, DocPeek, MergeFeatureDialog, DeleteFeatureDialog and SettingsOverlay
now run entirely on it: every inner element, class name, prop and callback is
unchanged, no caller moved, and not one of them has a `window` keydown effect
left. `.nf-overlay` and the three `.nf-discard*` rules died with them (ratchet
4307 → 4287). Tier-2 `test/dialog.test.tsx` (11) and `test/field.test.tsx` (5).
STYLE.md gains the five catalogue rows, a `### Dialog` section stating the
contract, and a `## Concern modules` map of `lib/feature-ui/`, `next-step/` and
`components/workspace/`.

Three deviations worth knowing:

- **`Dialog` has an `inline` prop and FormOverlay is its one user.** `.nf-overlay`
  was never a modal backdrop — it is `flex: 1` inside `<section class="workspace">`,
  so the new-feature form is a *page* filling the workspace column with the
  sidebar live beside it. Portalling it would have left an empty workspace behind
  a full-viewport backdrop covering navigation that still works — a redesign, and
  the spec puts overlay redesign in the flow features. `inline` renders in place
  and omits `aria-modal`, since content around it genuinely is reachable.
- **The discard bar is now Dialog's, on utilities**, so the `.nf-discard*` rules
  went and its buttons are the primitive's 32px rather than `btn-xs`.
- **The backdrop is `bg-bg/70`, not the sketched `bg-black/50`** — `theme.css`
  sets `--color-*: initial`, so `bg-black` resolves to nothing at all.

## Surprises

- **Escape got stricter for four of the five.** DocPeek, merge, delete and
  settings used to close on Escape from anywhere; the shared guard means only
  when focus is inside. That is safe *because* Dialog focuses the panel on open —
  and it must not do that unconditionally, or it would steal DeleteFeatureDialog's
  `autoFocus` confirm input. It takes focus only when nothing inside already has
  it; there is a test pinning that.
- **`.peek-backdrop` could not be deleted.** `AddressNotesDialog` and
  `DirectoryPicker` still render it with their own hand-rolled mechanics; they
  are outside this ticket's five.
- **Legacy classes beating utilities is what keeps the look identical.** The four
  peek overlays pass `peek …` as `className`, and unlayered `.peek` overrides
  Dialog's `bg-panel`/`rounded-lg`/`max-w-*`. The one utility that survives is
  `shadow-overlay`, so those dialogs gain a drop shadow — the only intended
  visual change outside the discard bar.
- **`SettingsOverlay` has its own local `Section` and `Field` components.** They
  do not collide (it imports only `Dialog`/`DimLine` from `../ui`), but a flow
  feature that reaches for the new primitives in that file will have to rename.
- Baseline held exactly: `bun run typecheck` 0 errors, `bun run --cwd apps/web
  build` green (I grepped `dist/assets/*.css` to confirm `bg-bg/70`, `z-[200]`,
  `pt-[8vh]`, `bg-warn/8`, `shadow-overlay` and all three `max-w-*` sizes really
  resolve), `bun run test` 150 files / 2490 passed with the same 8 environmental
  failures ticket 4 documented (`burn-slot-workspace` ×7, `dev-pane` ×1, both
  `packages/server`, untouched by this diff). All 150 web tests pass.
- Drive machinery: no edit needed — this ticket adds no service, env var, seed or
  companion process. Checked offline that both `.runcastle/drive-*.ts` still parse
  and that every path they emit still exists (`RUNCASTLE_WEB_DIST` →
  `apps/web/dist`, which the build produces). I did not run them; there are no
  services in this sandbox. I also could not run the app to click through the
  overlays — no dev server here — so Escape/backdrop behaviour is verified by the
  tier-2 tests only.

## Left undone

- **`AddressNotesDialog` and `DirectoryPicker` still hand-roll their mechanics**
  (own keydown effect, own `.peek-backdrop`). They are the obvious next two onto
  `Dialog`, and moving them is what finally frees `.peek-backdrop`.
- **`Field`, `Card`, `Section` and `Kbd` have no consumers yet** — by design, the
  flows adopt them. `SettingsOverlay`'s `.settings-field` markup is the closest
  existing thing to `Field` and would be the first real migration.
- **`Dialog` does not trap Tab.** `aria-modal` claims modality that focus
  behaviour does not yet enforce; nothing in the app did before either, so it is
  not a regression, but a real focus trap is worth a flow ticket.
- `docs/UI-SPEC.md` §4 still describes the old primitives (ticket 1's header note
  supersedes it; nobody has rewritten the section).

## 6. Review: drive the foundation — primitives, overlays, unchanged flows

Reviewed in Drive mode: walked the app against the acceptance criteria.

This lap gives the web app a shared visual foundation: a 14px body scale, 32px primary controls, consistent radii, theme-backed buttons, phase tags, status chips, section labels, empty states, and dialog mechanics.
The sidebar and workspace now read cleanly at the larger scale while intentionally retaining some denser legacy controls until their owning flows migrate.
The feature workspace keeps its existing single-screen pipeline, with draft, earlier read-only phase views, ticket details, next-step guidance, gates, and knowledge documents all behaving coherently in the surfaces the drive exposed.
Settings, document peek, delete confirmation, and the dirty quick-change form share the new interaction language; delete still autofocuses its confirmation input and dirty Escape asks before discarding.
The most important regression is overlay ownership: one Escape closes both the command palette and the Settings dialog instead of only the palette.
Focus restoration is also incomplete after backdrop dismissal in Settings and document peek, and after closing delete from its transient menu opener.
The tracked design-system sources are retired and the running app makes no visible or network reference to them, but ignored build/cache directories still remain physically in the checkout.
The drive began with an empty isolated data store, so I created a draft and a quick-change implementation fixture to cover the available phase bodies and primitive states.
Review, shipped, merge confirmation, lap-two sections, and populated run/finding chips were not reachable without starting a burn and manufacturing workflow history, so those remain unverified.
The dirty form’s Escape path passed; its only exposed instance is intentionally inline and has no backdrop, leaving the backdrop-discard case unavailable in this drive.
The walkthrough recording covers the full pass, and the browser, recorder, session, and drive slot were all stopped cleanly.

## 7. Escape closes both the command palette and Settings overlay

What was done

The command palette now stops its handled Escape event before closing, so a Dialog underneath cannot consume the same key event after focus ownership changes.
A happy-dom component regression test opens Settings, opens the command palette above it, presses Escape once, and verifies the palette closes while Settings stays open.
The test also verifies the handled Escape never reaches window-level overlay listeners.
The exact reported sequence was re-run through that component harness and passed: the palette disappeared and the Settings dialog remained.
The fix and regression test were committed as 08a2aa9.

Surprises

The original focus-ownership guard was correct; synchronous palette unmounting changed focus during the same bubbling event, making Settings appear to own that event by the time its window listener ran.
The full test command completed with 2,487 passing tests and 12 unrelated server failures caused by inherited GIT_PAGER/OAuth environment and missing temp repositories; the changed component tests passed.
The required full typecheck passed with zero errors.

Left undone

No dialog mechanics, palette navigation behavior, styling, server code, or drive machinery were changed.

## 8. Backdrop dismissal does not restore focus to the Settings opener

What was done

Fixed shared Dialog backdrop dismissal so the native mousedown default action cannot steal focus after the dialog cleanup restores its opener.
Extended the Dialog DOM test to open from a button, dismiss through the backdrop, verify dismissal, verify the event was canceled, and verify the opener retained focus.
The fix applies to Settings and every other overlay using the shared Dialog without changing inside-panel clicks or Escape dismissal.

Surprises

The cleanup already restored focus correctly; the browser's later default mousedown focus step was moving it back to BODY only on backdrop dismissal.
Re-ran the reported interaction at the Dialog DOM seam: open Settings-equivalent dialog, backdrop mousedown, inspect activeElement; focus remained on the opener. The sandbox intentionally has no running app/services, so the project-home browser shell itself was not launched.
The required full test command hit 12 unrelated sandbox-environment failures involving GIT_PAGER, an inherited OAuth token, disappearing cache-root fixtures, and a process teardown race; all 28 web test files passed (644 tests).

Left undone

No overlay visuals, server tests, environment configuration, or other focus findings were changed because they are outside ticket 8.
Drive scripts were unchanged: this fix adds no service, required environment variable, seed, or companion process.

## 9. Delete dialog does not return focus after Escape

What was done

The delete flow now carries the surviving feature-actions trigger ref through Sidebar and DeleteFeatureDialog into Dialog.
Dialog uses that ref as its focus-restoration fallback when the transient Delete menu item has been removed.
FeatureActionsMenu also moves focus to its trigger before invoking an action, preserving keyboard position during the transition.
A happy-dom regression test exercises the full menu → Delete dialog → Escape path and confirms the slug input still autofocuses.
I re-ran that repro in the DOM test: Escape closed the dialog and focus returned to the feature-actions button rather than document.body.

Surprises

Dialog's ordinary opener restoration was correct; the failure only occurred because the opener menu item was disconnected before cleanup.
The full suite ran 2,503 tests but had 12 unrelated environment failures: inherited OAuth state, unsafe GIT_PAGER, temp-repository races, and one PTY teardown assertion; 2,487 passed.
The focused dialog suite passed all 11 tests, and the full repository typecheck passed.

Left undone

No visual styles, other overlay behaviour, server code, or drive machinery changed; this ticket introduced no runtime infrastructure requirement.

## 10. Retired design-system directories remain in the driven checkout

What was done
The drive setup hook now removes the retired `packages/design-system` and `.design-sync` paths before dependency installation.
Cleanup is idempotent, limited to those two checkout-relative paths, and retries transient filesystem locks for Windows drives.
The cleanup runs only after the required drive identity has been validated.
The exact directory-existence repro was repeated after the change; both paths reported absent (`False`, `False`).
`bun run typecheck` passed with zero errors.

Surprises
The tracked sources were already retired; only ignored dependency/build/cache residue survived branch changes.
The full suite finished with 2,486 passing tests and 12 unrelated environment failures involving GIT_PAGER, an injected auth token, temp git repos, and process reaping.
The drive setup was inspected and typechecked but deliberately not executed, per the repository's offline drive-check rule.

Left undone
No app, server, style, or retired-directory source changes were needed; the existing historical documentation references were left untouched.

## 11. Doc peek loses opener focus after backdrop dismissal

What was done
Doc peek now receives an explicit reference to the button that opened it.
Both Knowledge document links and the specification card wire their opener into the shared Dialog.
Dialog restores that explicit target synchronously and reasserts it after backdrop mousedown completes.
The deferred restore only runs while focus is on the page body, so it cannot steal focus from a newly opened surface.
A DOM regression covers a conditionally mounted brief.md peek, backdrop dismissal, and restored opener focus.

Surprises
The earlier generic backdrop fix passed for an always-mounted Dialog but did not cover a conditionally mounted doc peek.
The exact repro was re-run through the DOM interaction test: the peek closed and brief.md regained focus.
The app itself was not booted because burn instructions prohibit running its drive/app machinery in this sandbox.
The full suite had 12 unrelated failures in server worktree, process-tree, and inherited-auth tests; 2,488 tests passed.

Left undone
No overlay visuals or other flow behaviour were changed.
No drive machinery changes were needed because this introduces no service, environment variable, seed, or process.
