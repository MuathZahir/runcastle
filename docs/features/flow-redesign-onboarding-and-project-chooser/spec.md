# Flow redesign: onboarding and project chooser

Flow 1 of 7 in the web redesign. Everything a user sees before they are inside a project: the first-run wizard, the portfolio home, the open-a-project screen, the directory picker, and the titlebar project switcher. The as-is flow was walked and confirmed in `flow-map.md`; the choices below are recorded in `decisions.md` (D1–D9).

## Problem

A first-time user meets a wizard that cannot go back, that shows them the entire AFK-burn settings card before they have opened a project, and that comes back in full the moment they close their last project — because "first run" is derived from an empty project list rather than from whether setup was ever done. The open-a-project screen is a paragraph of prose around one field, prints a rejected path twice in full, and forwards relative paths to the server, which resolves them against its own working directory and reports that. The directory picker overflows on any deep path and opens half-broken when the field holds garbage. Project cards hide their actions behind hover, and "Close" reads like "delete" while being one irreversible click. None of it looks professional: loose vertical rhythm, near-invisible hints, mostly-empty cards. Five components, zero component tests, ~137 legacy stylesheet rules.

## Approach

### What the user gets

**Landing.** The shell decides where to land from two facts: *is setup complete* (a git identity exists and at least one coding-agent runtime is ready — both read from the existing setup doctor on every load, nothing persisted) and *how many projects are open* (plus the remembered navigation, unchanged). Setup incomplete → the wizard. Setup complete and no projects → a single first-project "Open a project" screen with no Cancel. Otherwise the existing rule: one project → straight in; more → the home; a remembered project or home wins when it still exists. Closing the last project and reloading now lands on the first-project screen, never the wizard.

**Wizard.** Intro → git identity (auto-passed when detected, shown as a passed row) → coding agents → AFK burns → first project. Every step after the intro has a ghost Back; the step rail is visible from the first setup step. The AFK step is a question — "Run burns unattended?" — with a one-line explainer and two actions: *Set up now* expands the existing Enable-AFK card in place (the card belongs to Settings — since the 2026-09-02 merge with main it is that feature's prerequisites checklist, and the wizard's runtime rows render as its `ChecklistRow`s); *Skip for now* continues. One continue affordance per step. Exiting the wizard still seeds model defaults from the ready runtimes.

**Open a project.** Kicker, heading, one-line lead, then one row — path field, Browse…, Open — and a hint beneath. Errors say the problem once: "Not a git repository" with the `git init` hint, or "Path does not exist", with the path shown once, truncated from the left. Opening the picker clears a stale error. Relative paths are refused client-side ("Enter an absolute path") and never reach the server. Enter submits; Esc cancels except on first run; a successful open still enters the project.

**Directory picker.** One header control that is breadcrumbs by default — collapsed to `root … last three segments` when long — and becomes a text field on click; Enter navigates, Esc reverts the draft, Esc again closes. Given an initial path that does not exist, it opens at the nearest existing ancestor (home as the floor) with the typed text preserved; while the listing is in error, *Open this folder* is disabled. Roots rail, `GIT` badge, double-click to pick, Hidden toggle and commit-on-pick stay.

**Home.** "Projects (N)" over a grid of project cards plus one dashed *Open a project* card — the only Open entry point on home (the top-bar button goes). A card shows name, left-truncated repo path, `features / running / needs you`, and the health label, and carries an always-visible `⋯` menu with *Rename* (inline, Enter/blur commits, Esc reverts) and *Remove from list*. Remove asks inline on the card — "Remove *name*? The repo on disk is untouched." — and is disabled with a reason while a run is in flight. Home never renders with zero projects, so it has no empty state.

**Switcher.** Same rows — open projects with a check on the current one, *All projects*, *Open a project…* — with the repo folder name in dim mono under each project name. The titlebar project name truncates before it displaces the search box. The titlebar itself is the project-shell flow's; only the switcher's contents change.

**Look.** Every screen above is rebuilt on the foundation's tokens and primitives to the bar set in D1: deliberate vertical rhythm, kicker → heading → one-line lead → control, secondary text that is actually readable, no card that is mostly empty space.

### Shape

- **Landing and setup-state logic** are pure functions in the existing project/first-run logic modules — `setupComplete(doctorResults)` alongside the existing landing rule, which gains the setup-complete input. Components stay thin: the shell reads the doctor and the project list and asks these functions where to land.
- **Wizard** splits into one file per step (intro, identity, runtimes, AFK, and the shared rail); the wizard component owns only sequencing (forward/back over the existing step order) and the seed-on-exit.
- **Home** keeps the grid; `ProjectCard` with its menu and inline-confirm becomes its own component. Remove still calls the existing project-close mutation — the server contract is unchanged; only the verb and the confirmation are new.
- **Open a project** keeps the existing open mutation and failure classifier; the absolute-path check is a small pure helper (platform-aware: drive-letter or UNC on Windows, leading `/` on POSIX) used before submit.
- **Picker** gets one new component for the crumb/path control; the ancestor-fallback on a bad initial path is a pure function over the browse error plus the typed path, with the existing browse/roots queries unchanged. `Open this folder` gates on the browse query's error state.
- **Switcher** takes the repo path it already has from the project list and shows its last segment.
- **Styles.** All `.op-*`, `.wizard-*`, `.home*`, `.pc-*`, `.open-card*`, `.dir-*`, `.tb-switcher*` and `.tb-menu*` rules become Tailwind utilities on the new markup and are deleted from the legacy stylesheet, moving the ratchet baseline down. `.afk-*` is gone too — flow-redesign-settings retired it when it moved the Enable-AFK card to Tailwind, and the 2026-09-02 merge with main lands both deletions together (decision 11). No rule is added to the legacy sheet.
- **UA button reset (lap 2).** There is no preflight, so every `<button>` must fully reset the user agent's `buttonface` styles: it is either the shared `Button` — whose every variant, `danger` included, states its own background — or it carries `BARE_BUTTON` (`border-0 bg-transparent`), or it states both border and background itself. Lap 2 fixes the two known leaks (the backgroundless `danger` variant; the switcher rows' unreset border) and sweeps `apps/web/src` for the rest.
- **Tests.** Every one of the five components gets component tests: tier 1 (static markup) where markup is the behaviour, tier 2 (happy-dom) for Back/Esc/menu/inline-confirm/keyboard paths. The pure logic gets unit tests for the new landing table and the path helpers.

## Seams

- **Landing rule** *(existing, extended)* — the pure function that maps (projects, stored nav, setup-complete) → landing. Observes every row of the landing table in D3, including "setup complete, zero projects → first-project screen" and "setup incomplete → wizard".
- **Setup-complete predicate** *(new, pure)* — doctor results → boolean. Observes the identity/runtime combinations that count as done.
- **Wizard step sequencing** *(existing, extended)* — first step, next step, and now previous step over the step order. Observes Back behaviour and the auto-passed identity row.
- **Wizard component** *(existing)* — rendered with a stubbed doctor; observes the rail, Back on each step, the AFK question with its two actions, and that *Set up now* reveals the card.
- **Open-project component** *(existing)* — observes the one-row layout, the single-statement error box for each failure class, the absolute-path refusal, and that Browse clears a stale error.
- **Absolute-path helper** *(new, pure)* — string + platform → accepted or not.
- **Picker fallback** *(new, pure)* — (typed path, browse error) → directory to open. Observes the nearest-ancestor rule and the home floor.
- **Picker component** *(existing)* — observes the crumb/text toggle, collapse of long paths, Esc semantics, disabled *Open this folder* on error, double-click pick.
- **Project card component** *(new file, existing behaviour)* — observes the `⋯` menu, rename commit/revert, the inline remove confirm, and the in-flight disable with its reason.
- **Switcher component** *(existing)* — observes the second line per project row and the three fixed rows.
- **Project tRPC procedures** *(existing, unchanged)* — `open`, `close`, `rename`, `list`, `browse`, `roots`; `setup.doctor`, `setup.seedModelDefaults`. No server changes in this feature.
- **Stylesheet ratchet** *(existing)* — asserts the legacy sheet shrank by this surface's rules.
- **Button variants** *(existing, lap 2)* — every `Button` variant states its own background; observes that a `danger` button renders on the app's dark ground, enabled and disabled.

## Out of scope

- The in-project chrome — titlebar layout, sidebar, command palette (including its project-switch mode), status bar. Only the switcher's dropdown contents are owned here.
- The Enable-AFK card itself and the Settings surface. (The `.afk-*` rules were expected to stay for Settings; Settings itself retired them before the 2026-09-02 merge — decision 11.)
- The Preparation flow a freshly opened project lands on.
- Server-side project open/validation logic; the browse and roots procedures. No server change is made — the relative-path leak is closed client-side.
- Any new persisted state (no `setupCompletedAt`, no "last opened" timestamp).

## Open questions

None blocking. One judgement left to the implementer: the exact collapse threshold for breadcrumbs (segment count vs. measured width) — the rule is "never overflow the header row; always show root and the last three".

## Later laps

- **Recency / "while you were away" on project cards** (audit F10.2): needs the server to track per-project activity since the user last looked, which is a server change this flow does not make.
