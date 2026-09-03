# Outcome — Flow redesign: onboarding and project chooser

Redesign the first-run and open/choose-a-project flow end to end — FirstRunWizard, PortfolioHome, OpenProject, DirectoryPicker, ProjectSwitcher — walked and confirmed with the human before design.

- Shipped: 2026-09-03
- Lap: 2

## 1. Landing from setup state + redesigned Open-a-project screen

# Ticket 1 — landing from setup state + the open-a-project screen

## What was done

The landing rule now takes a third input: `restoredView(projects, stored, setupComplete)`
returns the new `'setup'` view whenever setup is incomplete, whatever is open or
remembered, and otherwise behaves exactly as before — so a finished setup with no
projects lands on the plain first-project screen and closing the last project never
replays onboarding. `setupComplete(results)` is a pure predicate in `lib/first-run.ts`
(git-identity probe `ok` **and** at least one `talkReady` runtime); `ProbeLike` gained an
optional `id`. `useProjectNav` reads `setup.doctor` alongside the project list and leaves
the landing unresolved while either is in flight; `Shell` shows its loading line until
both have arrived, renders `FirstRunWizard` only for `'setup'`, and passes
`firstRun={projects.length === 0}` to `OpenProject` for `'open'`.

`OpenProject` was rebuilt on Tailwind utilities: logo tile, kicker, heading, one-line
lead, one row (path field / Browse… / Open), then a hint — with `Cancel` kept below for
the non-first-run case, since that contract had to survive. `isAbsoluteRepoPath` (plus a
browser-reading `isAbsolutePath`) went into `lib/platform.ts` and refuses a relative path
before the mutation fires. All `.open-project` / `.op-*` rules are gone from `styles.css`
(4287 → 4223 lines, ratchet lowered in the same commit).

Two deviations worth naming. **(1)** The ticket said the failure hint should carry the
path; the spec (D5) also wants the path shown once and truncated from the left, which a
sentence with a path buried in it cannot do. So `RepoOpenFailure` gained a `path` field:
the message is the short statement, the hint is path-free advice, and the card renders the
path once beneath the message in `dir="rtl"` + `<bdi>`. **(2)** `cannot read path` used to
share the "does not exist" branch; restating it as "Path does not exist" would have been a
lie, so it gets its own statement ("Cannot read that path") and the same advice.

## Surprises

- `.op-kick`, `.op-label` and `.op-input` are used by `EnableAfkCard.tsx` (the Settings
  surface), not only by the wizard the ticket warned about. AC7 says delete every `.op-*`
  rule, so they are deleted and the AFK token field in Settings is unstyled until the
  Settings flow migrates. Settings is explicitly out of this feature's scope, so I did not
  touch that component.
- A tier-2 component test *was* possible: `vi.mock('../src/trpc')` with an async factory
  and `vi.hoisted` state, returning a `useMutation` backed by a real `useState`, so the
  error appears on a rejected path and clears on `reset()` — the tests then drive the
  screen through the DOM. `apps/web/test/open-project.test.tsx` is the pattern for the
  other four components in this flow. `ToastProvider` must wrap the render (`useToast`
  throws otherwise), and the stub must also answer `project.roots`/`project.browse`
  because Browse… mounts `DirectoryPicker`.
- The stated baseline ("118 files, 1768 passed, 0 failed") does not match this repo: the
  full suite is 152 files / 2544 tests. `bun run test` exits 1 here with 30 failing
  `packages/server` files — all 5s/10s test-and-hook timeouts and `ENOTEMPTY` rmdir errors
  on temp git repos under load. `packages/server/test/projects.test.ts` passes on its own,
  and my diff is `apps/web`-only. All 30 `apps/web` files (669 tests) pass, and
  `bun run typecheck` is clean.

## Left undone

- `FirstRunWizard.tsx` still carries `.open-project`, `.op-card`, `.op-logo`, `.op-kick`,
  `.op-h`, `.op-sub`, `.op-label`, `.op-input`, `.op-actions` class names whose rules are
  now gone — it renders unstyled on this branch until ticket 2 rebuilds it. Those class
  names must be *removed*, not just restyled: legacy classes are unlayered and would beat
  the new utilities if any rule ever came back.
- The `#open-repo-path` field has no visible label (the spec's layout is kicker → heading →
  lead → row), only `aria-label="Repository path"`. If the flow later wants a label, `Field`
  from `ui.tsx` will not fit as-is — it clones its single child with the id, and the child
  here is the row, not the input.
- Drive machinery: nothing to change. The change adds no service, required env var, seed or
  extra process, so `.runcastle/drive-setup.ts` and `drive-stop.ts` are untouched; I did not
  run them (no services in this sandbox) and made no edit that would need verifying.

## 2. Wizard: per-step files, Back navigation, AFK as a choice

# Ticket 2 — wizard: per-step files, Back navigation, AFK as a choice

## What was done

`FirstRunWizard.tsx` (375 lines, eight components) became
`apps/web/src/components/first-run/`: `FirstRunWizard.tsx` (sequencing and the
shared column frame), `WizardRail.tsx` (the rail plus the passed-step detail
lines), `IntroStep.tsx`, `IdentityStep.tsx`, `RuntimesStep.tsx` (with
`RuntimeCard`), `AfkStep.tsx`, and `StepLayout.tsx` — the kicker/heading/lead
block and the Back-plus-actions row that all four steps repeat. Export name and
props are unchanged; `Shell.tsx` points at the new path. The frame is the same
column `OpenProject` uses (`max-w-[560px]`, accent logo tile, 32px controls), so
the last wizard step and the screen it hands over to do not jump.

`prevSetupStep(current, identity)` joined `lib/first-run.ts`: it returns
`undefined` from the first *shown* step, which is what makes Back go to the
intro, and so never lands on an identity step the host auto-passed. Fully unit
tested in `test/first-run.test.ts`.

The AFK step is now the question "Run burns unattended?" with one explainer line
and two answers. `Set up now` reveals the untouched `EnableAfkCard` and takes
**both** buttons away with it — the card's own `Set up later` is then the step's
single continue affordance, which is the point of D4's "one continue affordance
per step"; leaving `Skip for now` up beside it would have recreated the exact
duplication the ticket removes. `Continue to your first project` is gone.

Tests: tier 1 for `WizardRail` (`test/wizard-rail.test.ts`) and for the unasked
AFK step (`test/afk-step.test.ts`), tier 2 for the walk itself
(`test/first-run-wizard.test.tsx`) — intro has no rail and no Back, Back from
the first shown step returns to the intro, Back never lands on a passed
identity, `Set up now` reveals the card, `Skip for now` seeds the ready runtimes
and lands on the first-project screen. All 34 `.wizard-*` lines are deleted from
`styles.css` (4223 → 4189) and the ratchet baseline lowered to match.

**Deviation.** The ticket says to style the fields with `Field` from `ui.tsx`,
but the app's only Tailwind text-input class list was a local `PATH_INPUT` const
inside ticket 1's `OpenProject.tsx`, whose own comment called it "the app's
first Tailwind text input, in the ui.tsx idiom". Rather than copy it, I moved it
to `ui.tsx` as `TEXT_INPUT` and pointed `OpenProject` at it — a four-line edit to
a file this ticket did not list, but STYLE.md is explicit that a thing styled in
two surfaces belongs in `ui.tsx`. It had to lose `flex-1` in the move: a
`flex-basis` of 0 collapses the input's height inside `Field`'s column flex
container, so `OpenProject` appends `flex-1` at its own call site.

## Surprises

- `RuntimeCard` is styled entirely by `.afk-row*` / `.afk-dot` / `.afk-cmd` /
  `.afk-term` / `.afk-note` rules, every one of which `EnableAfkCard` also uses.
  D9 keeps `.afk-*` for Settings, and the ticket says not to touch that card, so
  the runtime rows keep those class names and are genuinely the same row rendered
  in two surfaces — not leftovers. Only `.op-*` and `.wizard-*` were removed.
- The runtimes step therefore still shows two `solid` buttons at once when a
  runtime needs signing in (`Continue` plus `Run codex login`), which STYLE.md's
  "exactly one solid per view" forbids. That is unchanged from before this ticket
  and belongs to whoever redesigns the Enable-AFK rows; I left it.
- A tier-2 test of the whole wizard is cheaper than it looks: one
  `vi.mock('../src/trpc')` returning generic `useQuery`/`useMutation` stubs
  covers the wizard, `EnableAfkCard` and `OpenProject` together, because the
  doctor report the test supplies is what decides which step comes first.
  `setup.runtimeGuide` must be stubbed even though nothing renders it — its
  `useQuery` runs before the row that would use it returns `null`.
- Baseline check: `env -u GIT_ASKPASS bun run test` exits 1 here with 8 failures
  in 2 `packages/server` files — 7 in `burn-slot-workspace.test.ts`
  (`fatal: repository '/home/agent/cache/tmp/rc-slot-vol-…' does not exist`, a
  temp-dir/mount fault of this sandbox) and 1 in `dev-pane.test.ts` (a
  process-group kill). Neither file imports anything from `apps/web`, and this
  diff touches `apps/web` only. All 33 `apps/web` test files (691 tests) pass and
  `bun run typecheck` is clean across core, server, web and scripts. The
  prompt's stated baseline ("118 files, 1768 passed") does not match this repo,
  which runs 155 files / 2566 tests — ticket 1 reported the same mismatch.

## Left undone

- `EnableAfkCard.tsx` still carries `.op-kick`, `.op-label` and `.op-input`,
  whose rules ticket 1 deleted — the AFK token field in Settings is unstyled
  until the Settings flow migrates. Out of scope here (the ticket forbids editing
  that card), but it is visible inside the wizard the moment a user clicks
  `Set up now`, so it is more urgent than "Settings will get to it".
- `TEXT_INPUT` is a class-list export, not a component, so I did not add it to
  STYLE.md's primitive catalogue. If more of these accumulate the catalogue wants
  a second table.
- Drive machinery: nothing to change. This change adds no service, no required
  env var, no seed and no extra process, so `.runcastle/drive-setup.ts` and
  `drive-stop.ts` are untouched. I did not run them (no services in this sandbox)
  and made no edit that would need verifying.

## 3. Directory picker: merged crumb/path control, safe on a bad initial path

# Ticket 3 — directory picker: merged crumb/path control, safe on a bad initial path

## What was done

`DirectoryPicker` now runs its mechanics through `Dialog` rather than the hand-rolled
`.peek-backdrop` copy — STYLE.md says every overlay does, and `Dialog` already covers
`aria-label`, an arbitrary body, backdrop-mousedown, Escape and focus restore, so the
ticket's "otherwise keep the hand-rolled backdrop" branch never applied. It is
`size="lg"` with `h-[66vh]`; the `peek` class names are gone from it, but the `.peek*`
rules stay in `styles.css` because DocPeek, DeleteFeatureDialog and Settings still use them.

The crumb bar and the separate labelled "Path" row merged into one new hook-free
component, `components/PathCrumbs.tsx`: crumb buttons by default, collapsing to
`root … last three` above four segments (the ellipsis carries the full path as its
title), and an input pre-filled from the `value` prop on click — Enter navigates,
Escape reverts and stops propagating so the dialog stays open, blur reverts. A crumb
click stops propagation so navigating does not also open the editor under it, and a
small `Edit path` button gives the keyboard the same route the mouse gets by clicking
the strip.

`pickerStartDir(typed, errorMessage)` is a new pure function in `lib/projects.ts`: on a
"does not exist" / "cannot read" failure it drops the last segment (either separator) and
keeps the typed text; anything else is left where it is. The picker applies it in an
effect that only runs while the handed path is still what the control is editing, so the
walk-up is the *initial* path's behaviour and a directory the user navigated to
themselves reports its own error. `Open this folder` is now `disabled={!current || browse.isError}`.

All 151 lines of `.dir-*` rules were deleted from `styles.css` (4223 → 4072) and the
ratchet lowered in the same commit. Four test files: `pickerStartDir` unit tests, a tier-1
markup test for the collapse rule, a tier-2 test for click-to-edit / Enter / Escape /
blur, and an 12-case tier-2 test for the picker itself against a stubbed `project.browse`.

Two deviations. **(1)** The ticket left `parentPath` as "strip the last segment; nothing
left → undefined", which on Windows yields the drive-*relative* `C:` — a string the server
rejects as not absolute, stranding the walk. `C:\Users` therefore steps to `C:\`, and a
UNC path stripped past its host goes to home rather than to a bare separator. **(2)** The
"Up one level" button was kept. It is not in the ticket's keep-list, but neither is it in
anything asked to be removed, and deleting a working affordance is a change the ticket did
not request; it is `shrink-0` and does not affect the no-wrap rule.

## Surprises

- The Escape-stops-propagation trick genuinely works across the portal: `Dialog` listens on
  `window`, React attaches its listeners to the portal container (`document.body`), so a
  synthetic `stopPropagation` in `PathCrumbs` halts the event below `window`. The tier-2
  test asserts this directly with a `window` listener rather than trusting it.
- `browse` is configured with `placeholderData: prev => prev`, so on error the *previous*
  listing stays painted and `current` is the last good directory, not the failed one. The
  fallback effect therefore reads the `dir` state, never `current`. The test stub does not
  emulate `placeholderData`; nothing tested turns on which of the two it is.
- Full suite: `packages/server/test/dev-pane.test.ts > kills the child process tree` fails,
  and fails the same way on a single targeted run of that one file. It asserts a killed
  process *group* has been reaped, which is about this container's PID reaping, not about
  a diff that is `apps/web`-only. Everything else is green: 153 files / 2571 passed, and
  `bun run typecheck` is clean. The stated baseline of "118 files, 1768 passed" does not
  match this repo (155 files / 2576 tests), as ticket 1 also reported.

## Left undone

- The picker still prints the server's raw error message in a `DimLine` (`path does not
  exist: /x`). `repoOpenFailure` in `lib/projects.ts` already restates exactly these
  wordings as a short statement plus advice, and the open-a-project screen uses it; the
  picker could too, but the ticket scoped that classifier to the open screen.
- The breadcrumb collapse threshold is a segment count (4), not a measured width, which the
  spec explicitly left to the implementer. A single very long segment name is clipped by
  `truncate` rather than ellipsised, because the control is a flex row.
- `FirstRunWizard.tsx` still carries the dead `.op-*` class names ticket 1 flagged; ticket 2
  owns that.
- Drive machinery: nothing to change. This ticket adds no service, no required env var, no
  seed and no extra process — it is five files under `apps/web`. I confirmed both scripts
  the server invokes (`.runcastle/drive-setup.ts`, `.runcastle/drive-stop.ts`) are present
  and untouched; I did not run them, since this sandbox has no services or app to drive.

## 4. Portfolio home cards with ⋯ menu and inline remove; switcher rows with repo folder

# ticket(4) — portfolio home cards, ⋯ menu, inline remove, switcher rows

## What was done

The portfolio home and the titlebar switcher were rebuilt on Tailwind and their
legacy rules deleted. `ProjectCard` (with `CardFace` and `Stat`, and the health
label/dot maps) moved out of `PortfolioHome.tsx` into its own
`components/ProjectCard.tsx`; the home is now a heading (`Projects (N)`), a lead
line, and a grid of cards plus the dashed *Open a project* card, which is the
only open entry point — the top-bar button is gone. The card's two hover-only
buttons became an always-visible `⋯` menu (`Rename`, `Remove from list`);
choosing Remove replaces the card face with "Remove *name*? The repo on disk is
untouched." over Cancel / Remove, backed out by either Cancel or Escape, with
Remove disabled and the reason spelled out on the card while a run is in flight.
The repo path is left-truncated (`dir="rtl"` + `<bdi>`), and the name truncates
inside the card. The switcher gained `repoFolderName(repoPath)` in dim mono under
each project name, and its titlebar label is `min-w-0 truncate max-w-56` so a long
name cannot push the search box. `styles.css` lost 230 lines (`.tb-switcher*`,
`.tb-menu*`, `.tb-project`, and the whole PORTFOLIO HOME block including
`.health-dot-*`); the ratchet baseline went 4038 → 3808.

Two deviations from the ticket's letter, both small. The `⋯` menu reuses
`FeatureActionsMenu` as instructed, which meant giving it an optional `label`
prop so the trigger reads "*name* actions" instead of the hardcoded "feature
actions" — a backwards-compatible one-line change to a component another flow
owns; its own `.row-actions*` legacy classes are left alone for that flow to
migrate. And `ProjectCard` is tier-2 tested with a stubbed tRPC client (the
pattern `open-project.test.tsx` already established), so the presentational part
was not extracted for a tier-1 test — `CardFace` exists anyway, but only because
a text input cannot live inside the `<button>` that opens the project.

New tests: `test/project-card.test.tsx` (7), `test/portfolio-home.test.tsx` (2),
`test/project-switcher.test.tsx` (5), and `repoFolderName` cases in
`test/projects.test.ts`.

## Surprises

- The as-is card nested its rename `<input>` inside the card-face `<button>`.
  Keeping that would have been invalid and unclickable markup on the new card, so
  the face renders as a plain `div` while renaming and as a button otherwise.
- The stated baseline ("118 files, 1768 passed") is stale for this branch — the
  suite is now 161 files / 2616 tests after tickets 1–3.
- The full suite is unstable in this sandbox for reasons unrelated to any web
  change. The first run failed 8 tests in two `packages/server` files (a git clone
  into a tmp path that does not exist, and a process-group kill); a second run,
  under load, failed 67 across 28 server files, almost all 5s/10s timeouts. Both
  those server files pass when re-run in isolation, and my diff is entirely
  `apps/web`. `bunx vitest run apps/web` is 39 files / 741 tests green, and
  `bun run typecheck` is clean.
- `.tb-home`, `.tb-logo` and `.spin-ring` are shared with the titlebar and the
  sidebar, so their rules stay; the home's top bar still carries those two class
  names as hooks, as `apps/web/STYLE.md` describes.

## Left undone

- The home lost its `fadeUp` entrance animation and the card grid's staggered
  `nth-child` delays. `@keyframes fadeUp` is still used by a dozen unmigrated
  surfaces, so re-expressing the stagger as arbitrary utilities would have coupled
  this surface to a keyframe another flow will eventually delete. Worth revisiting
  when the sheet is closer to zero.
- After cancelling the remove confirmation the focus is not restored to the `⋯`
  trigger (the menu is unmounted while the question is up). Escape and Cancel both
  work; only the keyboard's position is lost.
- Nothing in the drive machinery needed a change: this ticket adds no service, env
  var, seed or process. `.runcastle/drive-setup.ts` and `drive-stop.ts` are
  untouched and were not run (no services in this sandbox); I only checked that
  neither they nor anything under `packages/server` is in the diff.

## 5. Review: drive the onboarding and project-chooser flow end to end

Reviewed in Drive mode: walked the app against the acceptance criteria.

This lap rebuilt everything you see before you are inside a project, and structurally it delivered what it promised. First run no longer replays: the app now decides where to land from whether your machine is actually set up rather than from whether your project list happens to be empty, so closing your last project and reloading drops you on a clean "Open your first project" screen instead of marching you through the wizard again. That was the headline bug in this flow and it is genuinely fixed — I removed every project, reloaded, and got the first-project screen.

The open-a-project screen is now a single row — path field, Browse, Open — under a kicker, a heading and one line of lead, and its errors finally behave. A relative path is refused in the browser with "Enter an absolute path" and never reaches the server, so the old leak of the server's own working directory is closed; I confirmed no request goes out. A missing path and a non-git folder each state the problem once, show the path once, and add a useful hint. Opening Browse clears a stale error behind it. The directory picker's breadcrumbs and path box are now one control that collapses a deep path to root plus the last three segments without overflowing, switches to text on a click, navigates on Enter and reverts on Escape, and opens on the nearest existing folder when you hand it a path that does not exist. Project cards carry a visible menu with Rename and a "Remove from list" that asks first on the card itself, and the switcher shows each project's repo folder underneath its name. A very long project name truncates in the card, in the switcher and in the titlebar without pushing the search box around.

What you should look at before shipping is that the whole surface currently renders wrong. The home cards, every row of the titlebar switcher, and the picker's breadcrumbs and folder rail all paint as light-grey boxes with near-white text — the project names on the home are effectively invisible. It is one cause, not three: the project deliberately ships no CSS reset while the legacy stylesheet is still alive, STYLE.md says in as many words to style what you render, and these newly-migrated buttons were left with no background of their own. It is a small, uniform fix, but it means nobody has actually looked at this redesign as it renders, which is worth knowing about a lap whose stated goal was visual quality. Two smaller things: typing a bad path into the picker strands you with no breadcrumbs and a raw lowercase server string, and removing your last project from the home leaves you on a "Projects (0)" screen the decisions record says can never happen.

Two gaps in my coverage. The wizard could not be driven, because setup is complete on this machine and I would not touch your git config to fake it; I read the step files against the decisions instead and they look right, but no one has clicked through it since the redesign. And because this was a drive, I did not run the test or typecheck gates — though the stylesheet did shrink from 4287 lines to 3808, so the legacy rules for this surface really were deleted.

## 6. Directory picker's crumbs, roots rail and ✕ render as light-grey boxes with near-white text — unreadable

# ticket(6) — the picker's controls paint their own background

**What was done.** Every plain `<button>` in the directory picker — the ✕, each
breadcrumb, the "Edit path" pencil, the three roots-rail rows — now states a
background and a border of its own, so none of them falls back to the user
agent's `buttonface` grey under the theme's inherited near-white text. The reset
is named once, as `BARE_BUTTON` (`border-0 bg-transparent`) in `src/ui.tsx`
beside `TEXT_INPUT`, because STYLE.md says to build a thing shared by two
surfaces there rather than style it twice; the `Button` primitive already
carried the same reset in its `ghost` variant, which is why the migrated
surfaces were the only ones that showed the bug. Two deviations from the
ticket's letter, both small: I also fixed the **folder rows in the listing** —
the same bare-button markup a few lines down in the same file, invisible in the
reviewer's screenshot only because that folder had no subfolders — and I reset
the **border** as well as the background, since a bare button also inherits the
UA's 2px outset border and half the "light-grey pill" is that. Tests: a tier-1
assertion in `path-crumbs.test.ts` that every crumb button carries
`bg-transparent`, and a tier-2 one in `directory-picker.test.tsx` that lists any
button in the dialog with no *unprefixed* `bg-*` utility (a `hover:bg-*` alone
is what the bug was). Both were red first.

**Surprises.** The roots rail could not simply take the shared reset: its
selected row already carries `bg-accent-soft`, and two `bg-*` utilities on one
element are resolved by Tailwind's emission order, not class order. I checked
the built stylesheet — `.bg-transparent` is emitted *after* `.bg-accent-soft`,
so the naive fix would have silently erased the selected-root tint. The
background is therefore written into both branches of that row's ternary and
only `border-0` sits in its base. That build also confirmed the utilities
resolve at all despite `--color-*: initial`: `.bg-transparent{background-color:#0000}`
and `.border-0` with its `@property --tw-border-style` registration are both in
`dist`. The prompt's baseline is stale, by the way — it predicts 118 files /
1768 tests; this branch now runs 161 files / 2618 tests.

**Re-running the repro.** I could not run it as written: the sandbox has no app,
no server and no browser, so there is no live DOM to ask `getComputedStyle` and
no screenshot to compare. What I did instead, and what it is worth: the whole
repro path (Open-a-project screen → `Browse…` → picker) now contains no button
without a background — the Open screen and the wizard steps use the `Button`
primitive exclusively, and the picker's five bare buttons are the ones this
change fixes, asserted by the two new tests. The one legacy rule that could
override a utility here (`styles.css` still sets `button { font-family: inherit;
color: inherit }`, unlayered) touches neither background nor border, and the
existing "carries no legacy class names" test already proves nothing in the
dialog wears a `.dir-*` hook. Someone with the app running should still look at
it.

**Left undone.** The reviewer said this is one cause with three symptoms, and
the other two are outside this ticket: the home project cards
(`ProjectCard.tsx`, `PortfolioHome.tsx`) and every row of the titlebar switcher
(`ProjectSwitcher.tsx`) have the identical bare-button defect. `BARE_BUTTON` is
exported and is what they should use — mind the same collision the rail hit
wherever a row already has a selected tint. `bun run test` has 8 failures in two
`packages/server` files (`burn-slot-workspace`, `dev-pane`); both drive real git
clones and process groups in this container and fail on the environment, not on
this diff, which touches only `apps/web`. Typecheck is clean. No drive machinery
was touched or needed: this change adds no service, env var, seed or process.

## 7. Open-a-project screen prints its kicker and heading as the same words: "OPEN A PROJECT" over "Open a project"

# ticket(7) — the open screen's kicker no longer repeats its heading

**What was done.** On the non-first-run open-a-project screen the eyebrow read
"OPEN A PROJECT" directly above the heading "Open a project". The eyebrow now
reads "Your projects", so the kicker says where you are and the heading says
what you are doing — the hierarchy decisions D1 and D5 ask for, and the same
shape the first-run variant already had ("WELCOME TO RUNCASTLE" over "Open your
first project"). One string in `apps/web/src/components/OpenProject.tsx`, a
short comment recording why the two lines must differ, and one component test in
`apps/web/test/open-project.test.tsx` asserting the kicker is present and that
"Open a project" appears exactly once on the screen. No other change.

**Re-ran the repro.** I could not drive the real app — this sandbox has no
server, no browser and no project to open — so I re-ran the repro at the level
the screen is actually reachable at. `Shell.tsx:45` is the only non-wizard call
site, and the switcher's "Open a project…" lands there with `firstRun` false
whenever a project is open, which is exactly what the component test renders.
Before the change that render produced the kicker "Open a project" over the
heading "Open a project"; after it, the kicker is "Your projects" and the
heading's words appear once. The 9 tests in `open-project.test.tsx` pass.

**Verify.** `bun run typecheck` is clean (0 errors). `env -u GIT_ASKPASS bun run
test` ran 161 files: 2605 passed, 8 failed. Both failing files are server
environment tests untouched by this diff — `packages/server/test/burn-slot-workspace.test.ts`
(7 failures, all `fatal: repository '/home/agent/cache/tmp/rc-slot-...' does not
exist`, i.e. the test's own temp clone source is not creatable here) and
`packages/server/test/dev-pane.test.ts` (process-group reaping: the killed group
is still alive). Nothing in `apps/web` imports them and this diff is two web
files, so they are sandbox faults, not this ticket's — but note they contradict
the "fully green" baseline in the prompt, and the next agent should not spend
time thinking they broke something.

**Drive machinery.** No service, env var, seed or process was added, so
`.runcastle/` needed no edit; I did not run the drive scripts (no app here).

**Left undone.** The review that minted this ticket also reported that the whole
migrated surface renders as light-grey boxes with near-white text (no CSS reset,
migrated buttons with no background of their own), that a bad path in the picker
strands the user with a raw lowercase server string, and that removing the last
project leaves a "Projects (0)" home the decisions record says cannot exist.
None of those are this ticket and none are touched here.

## 8. Every row of the titlebar project switcher renders as a light-grey box with near-white text — unreadable

# ticket(8) — switcher rows painted the user-agent grey

## What was done

The switcher's rows and its titlebar trigger were migrated to Tailwind without a
background utility of their own. The app ships no Tailwind preflight while the
legacy stylesheet is alive (STYLE.md says so in as many words: "do not assume a
reset: style what you render"), and the only global rule for `button` in
`styles.css` sets `color` and `font-family` and nothing else — so every one of
those buttons kept the user-agent `buttonface`, a light grey slab under the
theme's near-white text. `bg-transparent` on both class lists in
`ProjectSwitcher.tsx` is the whole fix: the panel behind the menu shows through
and only hover paints. A short comment above the constants records why the token
is there, so the next person does not delete it as redundant.

I fixed the trigger as well as the four rows the ticket names. It is the same
one-token omission, in the same two-constant block of the same file, and the
trigger sits in the titlebar showing the current project name — leaving it grey
would have shipped the switcher half-readable. That is the only thing in the
diff the ticket did not literally ask for.

A regression test was added to the existing `apps/web/test/project-switcher.test.tsx`:
open the menu, then assert the trigger and every `menuitem` carry a background
utility. It fails on the pre-fix class lists.

## Re-running the repro

The reviewer's repro is a browser step (open two projects, click the titlebar
name, read `getComputedStyle(...).backgroundColor` in devtools). This sandbox has
no app and no services, so I could not literally click it, and I will not claim
otherwise. What I did instead, offline:

- Built `apps/web` and grepped the emitted CSS: `.bg-transparent{background-color:#0000}`
  is present, and the only `button` rule in the whole bundle is
  `button{color:inherit;font-family:inherit}` — nothing else sets a background on
  these elements, and no `.tb-switcher*`/`.tb-menu*` rule survives in `styles.css`
  to override the utility from unlayered CSS.
- Confirmed the rendered elements carry the class (the new test).

Together those are the two halves of the devtools expression: the class is on the
element and the class sets `transparent`, so the reviewer's check now returns
`rgba(0, 0, 0, 0)` rather than `rgb(240, 240, 240)`.

I also tried to measure it directly — a scratch happy-dom test that injects the
built stylesheet and reads `getComputedStyle` — but happy-dom returns an empty
string for a class-driven background here (it does not resolve the `@layer
utilities` cascade), so the measurement was worthless in either direction and I
deleted the scratch file rather than dress it up as a pass.

## Surprises

The full suite has one failure that is not mine and not in the stated baseline:
`packages/server/test/dev-pane.test.ts > kills the child process tree so the
port-holder is not orphaned` — it asserts a killed process group is gone and gets
`true`. It fails the same way when run alone, and my diff is two `apps/web` files
that cannot reach a process group. It reads as a sandbox process-reaping fault.
Everything else is green: 159 files / 2612 tests passed, and `bun run typecheck`
is clean.

Note also that the suite is much bigger than the baseline in the prompt claims
(161 files / 2617 tests vs. 118 / 1768) — this lap's own tickets added the rest.

## Left undone

The review that minted this ticket reported the same root cause in two other
places — the home project cards and the directory picker's breadcrumbs and folder
rail. I touched neither; they are their own tickets. If they are not already
covered, the fix is identical: a background utility on the migrated buttons.
Worth considering for a later lap: the real cure is Tailwind's preflight, which
only becomes safe once `styles.css` is gone, and until then every flow that
migrates a `<button>` can reintroduce this defect.

## 9. Portfolio home renders every project card and the Open card as a light-grey panel with an invisible project name

# ticket(9) — the portfolio home's cards painted in the user agent's button grey

**What was done.** The two card faces on the portfolio home are `<button>`s, and
this app deliberately ships no Tailwind preflight while `styles.css` is alive
(STYLE.md: "do not assume a reset: style what you render"). Their class lists
carried layout utilities only, so the browser's own `button` rules painted them
`buttonface` grey behind the dark theme's near-white text — invisible project
names, and a 2px outset border inside the card's own hairline. The legacy rules
this surface migrated from said the same thing explicitly (`.pc-main` had
`background: transparent; border: 0; cursor: pointer`; `.open-card` had
`background: transparent; cursor: pointer`) and the migration dropped it. The fix
puts those declarations back as utilities: the card face gets a new
`FACE_BUTTON` constant (`FACE` plus `cursor-pointer border-0 bg-transparent`,
kept separate because `FACE` is also used on a plain `<div>` in the renaming and
confirm states, which must not get a pointer cursor), and the dashed Open card
gets `cursor-pointer bg-transparent` — no `border-0` there, since it already sets
its own dashed border. Two component tests were added, one per file, asserting
the reset lands on the element the review's devtools selector queries.

**Re-running the repro.** The repro is a browser check
(`getComputedStyle(document.querySelector('button.flex.flex-1.flex-col'))`), and
this sandbox has no browser and no running app — no chromium, no playwright, and
happy-dom has no user-agent stylesheet at all (it does not know `buttonface`, so
it cannot even show the bug). So I could not click through it. What I did instead,
and what it showed: built `apps/web` (`bun run build`, exit 0) and confirmed the
production CSS emits `.bg-transparent{background-color:#0000}`, `.border-0` and
`.cursor-pointer`, that the bundle carries the new class strings on exactly the
two elements, and that no surviving unlayered rule in `styles.css` mentions
`.pc-main`, `.project-card` or `.open-card` any more (they were deleted with the
migration), so nothing can override the utilities. Utilities beat user-agent
styles unconditionally, so the queried button now resolves to `transparent` and
shows the card's `bg-panel` behind it. `bun run typecheck` is green; the two web
test files pass.

**Surprises.** The full-suite baseline in the prompt is stale — the branch now
runs 161 files / 2619 tests, not 118 / 1768 — and two *server* files fail in this
sandbox for environmental reasons, unrelated to anything web:
`packages/server/test/burn-slot-workspace.test.ts` (7 failures, every one
`fatal: repository '/home/agent/cache/tmp/rc-slot-vol-…' does not exist` — the
test's own temp clone source is missing under this container's tmp) and
`packages/server/test/dev-pane.test.ts` (1 failure, a process-group reaping
assertion). My diff touches four files under `apps/web` only.

**Left undone.** The same missing reset was reported on the titlebar switcher
rows and the directory picker's crumbs/roots rail — other tickets of this lap own
those, and I left them alone. Worth someone's judgement afterwards: this class of
bug will keep recurring for every flow that migrates a bare `<button>` off the
legacy sheet, and a shared constant (or the `Button` primitive growing a
`variant: 'bare'`) would end it rather than catching it three surfaces at a time.
No drive machinery was touched — this ticket adds no service, env var, seed or
process, so `.runcastle/` needed no edit.

## 10. Picker's error state drops all breadcrumbs, disables "Up one level", and prints a raw lowercase server string

# ticket(10) — the picker's error state

## What was done

A path typed into the picker's merged crumb/path control is now treated exactly like the
one the picker was handed: `PathCrumbs` reports it through a new `onEnterPath` callback
(kept apart from `onNavigate`, which a crumb click uses, because a crumb names a directory
the server just listed while typed text is only a claim), and `DirectoryPicker` keeps it as
`typed` so decision 6's existing nearest-ancestor walk-up applies to it. Typing
`Z:\nope\deeper` therefore lands on home rather than on a header with no crumbs, a disabled
"Up one level" and a raw server sentence in the file pane.

Because that walk used to be silent, the picker now says why it moved: a failure note under
the header states the problem once ("Path does not exist"), shows the path the user actually
typed once, truncated from the left, and adds "Showing the closest folder that could be
listed." It clears the moment the user navigates anywhere themselves. A new pure
`browseFailure(message)` in `lib/projects.ts` turns each of `browseDir`'s four wordings into
that statement plus the path pulled out of the sentence (and strips the errno the server
appends in brackets); the residual error pane — a failure with no ancestor to walk to, such
as a relative initial path — renders through the same classifier instead of echoing the
server verbatim.

The error box markup was identical in three places, so it became one `FailureNote` primitive
in `ui.tsx`; `OpenProject` now renders through it, unchanged in behaviour. Tests: unit tests
for `browseFailure`, and picker component tests for the typed walk-up, the notice's content
and its clearing, the polished residual failure, and the reviewer's literal `Z:\nope\deeper`
repro.

## Surprises

- The existing walk-up effect only ever fired for `initialPath`, because `PathCrumbs`
  routed both crumb clicks and typed Enter through the same `onNavigate`, and the picker's
  `navigate` cleared `typed`. Splitting the two callbacks was the whole fix; nothing about
  `pickerStartDir` needed changing.
- The picker's test stub only counted a leading `/` as absolute, so a Windows drive path was
  refused for the wrong reason and the repro could not be run at the component seam. The
  stub now also accepts `X:\`, matching the server, which runs on the user's own machine.
- The "How to verify" baseline in the prompt is stale: it predicts 118 files / 1768 tests,
  and this branch runs 161 files / 2630 tests. Two server test files fail here —
  `packages/server/test/burn-slot-workspace.test.ts` (7) and `dev-pane.test.ts` (1) — with
  `fatal: repository '/home/agent/cache/tmp/rc-slot-vol-…' does not exist` and a process
  group that outlives its kill. Both are sandbox-environment faults in files this web-only
  diff cannot reach; every one of the 39 `apps/web` test files passes, as does
  `bun run typecheck`.
- Drive machinery: this change adds no service, env var, seed or process, so `.runcastle/`
  needed no edit. I did not run `drive-setup`/`drive-stop` (no services here); I confirmed
  only that both scripts are still present and untouched by this diff.

## Left undone

- Reaching the picker's error state still empties the crumbs and disables "Up one level" —
  it is just much harder to reach now, needing a path shape the walk-up deliberately refuses
  to guess at (a relative path, or a permission error). Keeping the last successfully-listed
  directory's crumbs and parent while a listing is in error would close that, but it makes
  the header and the footer path describe two different directories, which wanted a design
  call rather than a fix ticket's judgement.
- A relative path typed into the picker is still sent to the server, which resolves it
  against its own cwd. Decision 5 closes exactly that leak on the open screen with
  `isAbsolutePath` from `lib/platform`; the picker could reuse it and refuse before the
  request. Out of this ticket's repro, so left alone.

## 11. Home does render with zero projects — "Projects (0)" — after removing the last card, which D7 says cannot happen

# ticket(11) — the home leaves when its last card goes

## What was done

Decision 3's landing rule only ever ran on load, so decision 7's promise that the home is
never seen with nothing open held for boot and not for the home's own Remove action:
taking the last card left the user standing on "Projects (0)" with a lead line describing
an empty grid. `replacementLanding(landing, projects)` in `apps/web/src/lib/projects.ts`
re-applies the count rule when the list moves out from under the surface underfoot, and
returns `null` while that surface still exists. `useProjectNav`'s effect — which already
handled the neighbouring case of a bound project closed in another window — now asks that
one function instead of open-coding half the rule. Both cases answer with `initialView`,
so removing the last project lands on the same first-project screen (no Cancel) a reload
would have given. Unit tests cover the new table in `projects.test.ts`; a hook test in
`project-nav.test.tsx` drives the list emptying under a mounted `useProjectNav`. Two of my
three commits were already on the branch from the interrupted attempt; I added no source
changes to them, only verification.

## The repro, re-run

There is no app or browser in this sandbox, so I re-ran the reviewer's repro as a
throwaway test (written, run, deleted — not committed) that mounts the real `Shell` with
tRPC stubbed at the wire, one project and `home` in stored nav, and clicks the actual
chain: `runcastle actions` → `Remove from list` → `Remove`. After the click the shell
renders "Welcome to runcastle / Open your first project" with no Cancel, and "Projects (0)"
is nowhere in the document. As a negative control I temporarily put the pre-fix effect back
and re-ran it: it failed with the body reading
`runcastleProjects (0)Every open project and where it stands — …Open a project` — the
reviewer's screenshot exactly. The file was restored with `git checkout --`, and the tree
is clean.

## Surprises

- The verify baseline in the brief is stale: it promises 118 files / 1768 tests fully
  green, and the suite is now 162 files / 2628 tests. Eight of those fail, all in
  `packages/server`: 7 in `burn-slot-workspace.test.ts` (each `fatal: repository
  '/home/agent/cache/tmp/rc-slot-ws-…' does not exist` — the fixture repo those tests shell
  out to is never created in this sandbox) and 1 in `dev-pane.test.ts` (a process-group
  kill that leaves a member alive here). Both files shell out to real git and real process
  groups; my whole diff is four files under `apps/web` and shares no code with them. The
  entire `apps/web` suite is green on its own: 40 files, 753 tests.
- `typecheck` is clean (exit 0).

## Left undone

- A related edge the ticket did not name and I did not touch: standing on the *open*
  screen with a project bound (`showOpen` keeps `currentProjectId`) while that project is
  closed elsewhere leaves the stale id in place, so `cancelOpen` would return to a project
  that no longer exists. `replacementLanding` deliberately does not move the open or setup
  views — they own no project — so this is unchanged from before, not introduced here.
- No drive-machinery change was needed or made: the fix adds no service, no env var, no
  seed and no process, and touches only client code under `apps/web`. Nothing under
  `.runcastle/` was edited, and per the standing instruction I did not run those scripts.
- Cosmetic: the new import in `apps/web/test/projects.test.ts` sits after `repoFolderName`
  rather than before it; nothing lints on member order, and a formatting-only commit was
  not worth making.

## 12. Reset leaked UA button styles: danger variant background, switcher row borders, bare-button sweep

# ticket(12) — UA button reset: danger variant, switcher rows, and the sweep

## What was done

Two source changes, both one line of classes, plus the tests that pin them.

`Button`'s `danger` variant in `apps/web/src/ui.tsx` now states `bg-transparent`.
It named a border and a text colour but no background, so with no Tailwind
preflight in this app every danger button sat on the user agent's white
`buttonface` under near-white text. `bg-transparent` (rather than a painted
background) is what keeps it consistent with `ghost` and honours STYLE.md's rule
that `danger` is still not the solid button — it paints only on hover, which it
already did. All four call sites go through the shared `Button` with no
`className` of their own carrying a `bg-*`, so the one change covers the card's
Remove confirm, the delete-feature dialog, the next-step bar, and `Dialog`'s own
"Discard" button.

`ProjectSwitcher`'s `MENU_ITEM` took the shared `BARE_BUTTON` reset in place of
its hand-written `bg-transparent`. It had the background but not the border, so
the agent's outset ring drew as a rounded outline on every menu row. The trigger
was already fine and stays as it is — it names a *transparent* border because it
fades a real one in on hover, which `border-0` would make impossible. The
file's doc comment said "both class lists name `bg-transparent`", which the fix
made untrue, so it now states the actual rule and why the two buttons satisfy it
differently.

Tests: `test/ui.test.ts` gains a tier-1 assertion that every variant states a
*resting* background, enabled and disabled — the regex deliberately refuses to
count `enabled:hover:bg-*`, which is exactly what `danger` had while it rendered
white. `test/project-switcher.test.tsx`'s existing background test grew the
border half of the rule.

## Surprises

The sweep found nothing else. I extracted all 91 `<button>` tags in
`apps/web/src` mechanically (2 are prose inside doc comments; 89 real) and
checked each one's resolved class list. Every remaining bare button either
carries `BARE_BUTTON`, states both properties inline, or wears a legacy
`styles.css` class — and all ~40 of those legacy rules already declare both
`background` and `border`. Notably `.btn-danger` inherits `.btn`'s
`background: transparent`, so the *legacy* danger button never had this bug;
only the Tailwind primitive did. So the leak was two instances, not a pattern
spread through the app — the sweep's value is that it is now checked, not that
it found more.

`bun run typecheck` is clean. `apps/web` tests are fully green (0 failures across
every web test file). The full suite reports 16 failures in 8 `packages/server`
files — all git/worktree/filesystem tests. They are not mine and not
deterministic: `packages/server/test/projects.test.ts` passes on its own, and
re-running just those 8 files together reproduces 8 failures rather than 16. The
count tracking concurrency is the signature of shared-state contention inside
the server suite. The prompt's baseline (118 files / 1768 tests) is stale — this
branch tip now runs 162 files / 2639 tests, so the contention has grown since it
was recorded. My diff is four files, all under `apps/web`, which `packages/server`
does not import.

Drive machinery needed no edit: this change adds no service, no required env
var, no seed and no process, so none of the four triggers fired. I did not run
`drive-setup` (no services in this sandbox, as instructed).

## Left undone

`ProjectCard`'s `FACE_BUTTON` spells out `border-0 bg-transparent` by hand
instead of using `BARE_BUTTON`. It satisfies the rule exactly, so it is not a
leak and I left it — but it is the same string duplicated, and folding it into
the shared constant would be a one-token tidy for whoever is next in that file.

The rule is enforced only where a component test already existed (the ticket
scoped it that way). Nothing stops a new bare `<button>` from reintroducing the
leak. A source-scanning guard in the shape of `test/styles-ratchet.test.ts` would
close that, but it would have to resolve `styles.css` cascades to avoid flagging
all ~40 legacy-classed buttons, which is real machinery and beyond this ticket.

## 13. Review: re-drive the onboarding and project-chooser flow after the UA-reset fixes

Reviewed in Drive mode: walked the app against the acceptance criteria.

This lap was a repair-and-re-drive of the onboarding flow, and its headline is narrow but real: the two places where buttons were leaking the browser's own white default face are now fixed at the root rather than patched where you happened to see them. The danger button — the one behind "Remove" on a project card, the delete-feature dialog and the next-step bar — now states its own background, and the project switcher's dropdown rows now fully reset their border, so the rounded outlines you screenshotted on every row are gone. I checked both in a way that tells a real fix apart from a lucky-looking screenshot, and then swept every button on each screen of the flow for the same signature: forty-three buttons across the first-project screen, the portfolio home and the directory picker, and none of them leaks. Your hunch that there were "other weird styling issues" of this class does not appear to be borne out — at least not on these screens.

What you can do now that the rest of the drive confirms: paste a relative path and be told to enter an absolute one before anything reaches the server, get a single clear sentence for a missing path or a non-git folder with the path shown once and a git init hint, open the picker onto a path that does not exist and land on the nearest folder that does, rename a project inline and back out of it with Escape without it sticking, and remove a project behind an inline confirmation that tells you the repo on disk is untouched. A long project name truncates in the titlebar instead of shoving the search box aside, and the palette hint reads Ctrl+K rather than the Mac key. Nothing threw an error and the console stayed silent for the whole walk.

The one defect I found is a keyboard dead end on the open-a-project screen. Escape is wired to the path field rather than to the screen, so it only cancels while your cursor is in that field. The path that matters is the ordinary one: open Browse, dismiss the picker with Escape, and the next Escape — the natural second press to back out — does nothing, with no feedback. Cancel still works, so you are not stuck, but the escape hatch is not there when you reach for it.

Two things deserve your attention beyond that. I could not drive the first-run wizard at all, so Back on each step and the AFK choice remain unseen in a browser: the wizard only appears when setup is incomplete, and on your machine it is complete, so reaching it would have meant stripping your git identity or signing your coding agents out. I tried faking it at the network layer instead and the tooling would not intercept, so I stopped rather than improvise. And I did not write the lap's notes into the feature's test-notes.md, because this review runs under a rule against touching your checkout — that acceptance criterion and the protocol contradict each other, and the notes live here and in the findings instead. One smaller judgement call: the card's ⋯ menu measures 3.36 to 1 against the card, which passes the contrast floor for a control but only just, so give it a look on your own monitor.

## 14. Esc stops cancelling the Open-a-project screen once focus leaves the path field — the common Browse→Esc→Esc path is a dead end

What was done
Moved non-first-run Escape cancellation from the repository path input to the OpenProject screen boundary.
Kept the picker responsible for its own first Escape so one keypress cannot close both the picker and its parent screen.
Added a happy-dom regression test that opens Browse, dismisses the picker, verifies focus returns to Browse, and presses Escape again.
Re-ran that exact repro test: the picker closed on the first Escape and onCancel fired on the second; all 10 OpenProject tests passed.

Surprises
The required typecheck was fully green.
The full suite had 2,624 passing tests but 12 unrelated server failures caused by injected Git/auth/temp-path environment state; OpenProject remained green.
No drive machinery change was needed because this ticket adds no service, boot environment variable, seed, or companion process.

Left undone
No adjacent project-navigation or DirectoryPicker behavior was changed.
The unrelated server-test environment failures were not modified because they are outside this UI ticket.
