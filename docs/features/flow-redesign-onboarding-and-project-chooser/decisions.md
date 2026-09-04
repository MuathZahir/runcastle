# Decisions — flow redesign: onboarding and project chooser

## 1. The as-is flow map is confirmed; visual quality is a first-class goal
**Decision:** `flow-map.md` (walked 2026-08-28) is the confirmed baseline for this redesign. Beyond the structural fixes it lists, every screen in this flow must be redesigned to a professional visual standard on the foundation's tokens and primitives: deliberate vertical rhythm, a clear type hierarchy (kicker → heading → one-line lead → control), readable secondary text (no near-invisible hints), and no cards that are mostly empty space around one field.
**Why:** The human confirmed the map and flagged that the current cards (e.g. "Open your first project") have poor spacing and hierarchy and do not look professional. Fixing the flow without fixing the look would leave the surface un-shippable.

## 2. One lap, whole flow; F10.2 parked
**Decision:** Spec and ship the entire flow (wizard, home, open, picker, switcher, landing rule, CSS migration, tests) in a single lap. The one deferral is the "while you were away" / recency signal on project cards (audit F10.2), which goes to `## Later laps` in the spec.
**Why:** The five components are one coupled surface — a thin lap would test-drive half a flow. F10.2 alone needs server-side tracking the project row does not have, and pulling a server change into a UI flow is the wrong trade.

## 3. First run is derived from setup state, not project count
**Decision:** The wizard shows when *setup is incomplete* — no git identity or no ready coding-agent runtime, both computed from `setup.doctor` on every load. Setup complete + 0 projects lands on a plain first-project "Open a project" screen (no Cancel), never the wizard. Setup complete + ≥1 project follows the existing landing rule. Nothing new is persisted.
**Why:** Deriving first-run from an empty project list made the whole wizard replay after closing the last project. Computing from doctor facts cannot go stale, needs no schema change, and naturally re-surfaces the runtimes step if an agent is later signed out. Intro and AFK screens are seen once; AFK setup lives in Settings after that.

## 4. Wizard: Back on every step after the intro; AFK step is a choice, not a form
**Decision:** Every wizard step after the intro gets a ghost `Back`; the step rail is visible from the first setup step. No skip-to-project shortcut. The AFK step becomes "Run burns unattended?" with one explainer line and two actions: `Set up now` (expands the existing `EnableAfkCard` in place; the card is not redesigned here) and `Skip for now` (continues). One continue affordance per step.
**Why:** The wizard was forward-only, and the AFK step showed the entire Settings card (Docker / image / OAuth token) to a first-time user with two redundant continue buttons. The hard steps stay hard; the optional one stops looking mandatory. The AFK card belongs to Settings' surface.

## 5. OpenProject: one-line lead, single-row control, errors said once, absolute paths only
**Decision:** The open screen is kicker → heading → one-line lead → one row (path field, `Browse…`, `Open`) → hint. Errors state the problem once ("Not a git repository" + `git init` hint; "Path does not exist") with the path shown once, left-truncated; opening the picker clears a stale error. Relative paths are rejected client-side ("Enter an absolute path") and never sent to the server.
**Why:** The current card is a paragraph of prose around one field, prints the full path twice, and forwards relative paths to the server, which resolves them against its own cwd and leaks it in the error.

## 6. DirectoryPicker: crumbs and path input merge; safe on a bad initial path
**Decision:** Breadcrumbs and the Path input become one control — crumbs by default (collapsed to `root … last three` when long), click to type, Enter navigates, Esc reverts. On an invalid initial path the picker opens at the nearest existing ancestor (falling back to home) with the typed text preserved; `Open this folder` is disabled while the listing is in error. Roots rail, `GIT` badge, double-click-to-pick, Hidden toggle and commit-on-pick stay.
**Why:** The two-row header overflowed on deep paths and pushed the Hidden toggle off-screen; a garbage field value opened a half-broken dialog whose primary button would submit the garbage.

## 7. Project cards: `⋯` menu, "Remove from list" with inline confirm, one Open entry point
**Decision:** Each project card carries an always-visible `⋯` menu with `Rename` and `Remove from list`. Remove confirms inline on the card ("Remove <name>? The repo on disk is untouched.") and stays disabled with a reason while a run is in flight. Cards show name, left-truncated repo path, the three stats and the health label. The top-bar `+ Open a project` button goes; the dashed Open card is home's single entry point. Home never renders with zero projects (decision 3), so it has no empty state.
**Why:** Hover-only actions are undiscoverable, "Close" was ambiguous (F17.8) and irreversible in one click, and two Open affordances on one screen was redundancy for its own sake.

## 8. Switcher: same contents, repo folder as a second line, name truncates before the search box
**Decision:** The switcher keeps its rows (open projects with ✓, `All projects`, `Open a project…`). Each project row gains the repo folder name in dim mono beneath the project name. In the titlebar the project name truncates before it displaces the search box.
**Why:** Two projects can share a name; the folder disambiguates. A long name currently swallows the titlebar row.

## 9. Code shape, tests, and CSS migration for this surface
**Decision:** Landing and setup-state logic are pure functions in `lib/projects.ts` / `lib/first-run.ts` with unit tests; components stay thin. `FirstRunWizard.tsx` splits into one file per step; `ProjectCard` (with its menu) leaves `PortfolioHome.tsx`; the picker's crumb/path control is its own component. Every one of the five components gets component tests (STYLE.md interactive tier): happy path plus the error branches in `flow-map.md`. All `.op-*`, `.wizard-*`, `.home*`, `.pc-*`, `.open-card*`, `.dir-*`, `.tb-switcher*/.tb-menu*` rules move to Tailwind and are deleted from `styles.css`; `.afk-*` stays (Settings still uses it).
**Why:** The brief makes code quality, tests and the `styles.css` retirement mandatory for each flow; these components currently have zero tests and ~137 legacy rules.

## Lap 2 (revisited 2026-08-31)

### 10. Every button fully resets the user-agent styles; lap 2 is a UA-leak sweep plus a re-drive
**Decision:** There is no Tailwind preflight in `apps/web` (STYLE.md), so any `<button>` that does not state both a border and a background leaks the browser's `buttonface` look. Two known leaks from the lap-1 test drive: the shared `Button`'s `danger` variant (`ui.tsx`) states border and text colour but no background, so every danger button renders on the UA's white face (the card's Remove confirm, the delete-feature dialog, the next-step bar); and `ProjectSwitcher`'s menu rows state `bg-transparent` but no border reset, so the UA outset border draws as a rounded outline on every row. Lap 2 fixes both at the root — the `danger` variant gains an explicit background, the switcher rows take the existing `BARE_BUTTON` reset — then sweeps every bare `<button>` in `apps/web/src` for the same class of leak, and ends with a fresh end-to-end review drive of the whole flow against the D1 visual bar.
**Why:** These are not two local bugs but one rule violated in several places; fixing instances without the sweep invites lap 3 to be the same lap again. The rule going forward: a `<button>` is either the shared `Button` (whose every variant must state its own background) or carries `BARE_BUTTON` (`border-0 bg-transparent`) or states both properties itself.
**Also decided:** Recency / "while you were away" on project cards stays in `## Later laps` — it still needs a server change and nothing in the lap-1 drive asked for it.

## Merge with main (revisited 2026-09-02)

### 11. The wizard's runtime rows ride the settings feature's checklist primitives; `.afk-*` is gone
**Decision:** Merging main brought in flow-redesign-settings, which reshaped the Enable-AFK card into a prerequisites checklist on Tailwind (`Checklist` / `ChecklistRow` / `RowTerminal` in `EnableAfkCard.tsx`) and deleted every `.afk-*` rule from `styles.css`. The carve-outs decisions 4 and 9 made — "the card is untouched, it belongs to Settings" and "`.afk-*` stays" — resolved exactly as intended: Settings redesigned its own card, and this feature's wizard follows it. `RuntimesStep` now renders its provider rows as `ChecklistRow`s instead of hand-built `.afk-row` markup, and the revealed AFK card in the wizard is the checklist (its summary line, e.g. "Ready for unattended burns", replaces the old "Run features unattended" title the wizard test asserted). The styles ratchet baseline drops to 3337 — both features' deletions land together.
**Why:** Decision 9 kept `.afk-*` alive only because Settings still rendered it; that owner has now retired it. Re-implementing the rows locally would fork a surface the two flows deliberately share.
