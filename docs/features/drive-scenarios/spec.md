# Drive scenarios

## Problem

A test drive lands the human on a blank app. Before they can test what the feature is about, they create an account, add products, and build the situation by hand. They do it again on every drive. Review agents improvise the same setup each time, and runcastle's own drive instructions spend a paragraph telling the agent to "open the feature at the step your change touches… if the state doesn't exist, create it". That paragraph is a scenario written in prose.

## Approach

### What the human sees

- **Starting a drive.** **Test drive** becomes a split button, both on a feature at review and on the project's Test drive card.
  - The main click starts the drive with its default scenario: on a feature drive, the feature's first own scenario, or Blank app when it has none; on a project drive, always Blank app.
  - The arrow opens the picker: this feature's own scenarios, then the other scenarios grouped by group, then Blank app. A project drive's picker has no "This feature" section.
- **Landing.** Once the app answers (the moment **Open app** goes live today), runcastle runs the chosen scenario. Its output shows live. When it prints `ENTRY_URL`, the drive panel navigates there. For an app with sign-in, that URL goes through the app's drive-only login route, so the human lands already signed in. The panel names the scenario they are in.
- **Switching.** Inside a running drive, the drive panel carries a **Scenario** menu: the same list as the picker, plus **＋ New scenario**. Picking one runs it against the live drive with no restart and lands the human on its `ENTRY_URL`. Entities are unique per run, so scenarios coexist in one drive's database.
- **Failing.** A scenario fails when it exits non-zero or prints no `ENTRY_URL`. The drive stays up on its plain URL, exactly as Blank app would.
  - The panel shows which scenario failed, why (the exit code, or "printed no ENTRY_URL") and the tail of its output, so the human sees the actual error without opening anything.
  - A **Fix it** button opens the scenario chat briefed with that file and that output.
  - The failure also goes on the timeline.
  - Runcastle runs the command once: no retry, no fallback.
- **＋ New scenario.** The human describes the state they want to land in, in a chat docked beside the drive panel, not in the Chat tab.
  - The agent writes the scenario and commits it onto the branch being driven.
  - It lands the human through runcastle's own runner, so the scenario is proven on first use by the same path the picker takes.
  - There is one scenario chat per drive; while it is live, ＋ New scenario reopens it. It is still listed with the feature's (or project's) other sessions.

### The scenario contract

This is the project-facing contract, a peer of the drive contract in the `prepare` skill.

- **Where scenarios live.** A scenario is a file under `.runcastle/scenarios/` in the project repo, a fixed path committed with the rest of the project's runcastle machinery.
- **Group and name.** The first subfolder is the group, made readable: `checkout/` → **Checkout**. The file name without its extension, made readable, is the display name: `expired-coupon.ts` → **Expired coupon**. A file directly under `scenarios/` has no group. Nested folders below the group count toward that group.
- **Shared code.** Files and folders whose name starts with `_` (e.g. `_fixtures/`) are shared code, never listed as scenarios.
- **The runner.** The project's host settings carry one new setting, the **scenario runner**: a command with a `{file}` placeholder, e.g. `bun {file}` or `bin/rails runner {file}`. Runcastle substitutes the scenario's path relative to the repo root.
  - It runs the command in the drive's checkout through the same shell machinery the drive hooks use.
  - Its environment is the drive identity (`RUNCASTLE_SLUG`, `RUNCASTLE_BRANCH`, `RUNCASTLE_ID`) plus the `drive.env` overlay, so the scenario sees the drive's isolated database.
  - It adds one variable, `RUNCASTLE_SCENARIO_RUN`: a short random lowercase hex string, fresh per run, that scenarios use to make their entities unique (`buyer_7f3a`).
- **Output.** The scenario prints `ENTRY_URL=<url>` on stdout, and the last such line wins.
  - A relative URL (`/__drive/login?token=…&to=/cart`) resolves against the drive's URL; an absolute one is used as is.
  - Any other output is shown to the human but never parsed.
  - An optional `TOKEN=` line is reserved for API scenarios in a later lap; lap 1 ignores it.
- **Success and timeout.** Exit 0 together with an `ENTRY_URL` means success. A scenario that runs past a fixed timeout (two minutes) is killed and fails like any other.
- **Login route.** For an app with sign-in, the app carries one drive-only route (e.g. `/__drive/login?token=…&to=…`).
  - It exists only when the drive environment is set, and never in production.
  - The scenario seeds the user like any other entity and mints a one-time token for it. The route checks the token, signs in through the app's own sign-in code, and redirects to `to`.
  - Its only job is to carry the session into the browser, which neither the scenario nor runcastle can write: the app runs in a cross-origin panel.
  - An app without sign-in, or a scenario meant to land signed out, prints a plain `ENTRY_URL`.

### Discovery

Runcastle lists scenarios from git: the paths under `.runcastle/scenarios/` at the branch to be driven, which is `feature/<slug>` for a feature and the checked-out `HEAD` for a project drive. Reading git rather than the working tree lets the picker list a feature's scenarios before its drive has checked the branch out. A scenario chat always commits before landing, so a new scenario is listed as soon as it exists. Paths only: runcastle never reads a scenario's contents.

A feature's **own** scenarios are the scenario files its branch added or changed against its base branch, found by git diff. This matches how the drive already relates the feature branch to its base. Own scenarios sort first, in path order; "first own scenario" means the first in that order.

When no scenario runner is configured, the picker and the **Scenario** menu offer only Blank app (and ＋ New scenario inside a drive). Scenarios cannot run without the runner. A drive whose project has no dev command (a "bare" drive) has no URL to land on, so it offers no scenarios.

### Where a scenario lands

The scenario chat runs in the drive's checkout. That is the project's main checkout, where a feature drive has `feature/<slug>` checked out and a project drive drives whatever is checked out. The chat commits its work onto the branch under the wheel before the final landing:
- on a feature drive, the commit goes onto the feature branch, so the scenario becomes one of the feature's own and merges with it;
- on a project drive, the commit goes onto the checked-out branch, usually `main`.

The chat always commits, so nothing comes back as carried changes when the drive stops.

### The scenario session

A new session kind, `scenario`.
- It is launched by ＋ New scenario or **Fix it** in a running human drive, feature or project.
- It belongs to the drive's scope: feature-scoped on a feature drive, project-scoped on a project drive. Unlike today's kinds, which each have one fixed scope, this kind takes its scope from the drive.
- Its working directory is the project's main checkout, as Fix drive's is.
- Its briefing rides the launch (ADR-0009). It carries:
  - the drive's identity and the names and values of the `drive.env` overlay;
  - the scenario runner (or the fact that none is set);
  - the existing scenario files and `_` fixtures;
  - the human's description, or, for **Fix it**, the failed file, its exit reason and its output tail;
  - whether it is in setup mode;
  - the rules: commit before landing, land only through `run_scenario`, unique entities via `RUNCASTLE_SCENARIO_RUN`.
- **Setup mode** applies when the driven branch has no `.runcastle/scenarios/` directory. The briefing then also asks the agent to:
  - add the drive-only login route if the app has sign-in, guarded by the drive environment;
  - make the project's typecheck (or equivalent) cover `.runcastle/scenarios/`;
  - add base fixtures under `_fixtures/`;
  - record the scenario runner;
  - write the requested scenario.
- **Edit guard.** In setup mode the guard allows the whole checkout. Otherwise the session may write only `.runcastle/`, like Fix drive. Setup mode is decided once, at launch, from whether `.runcastle/scenarios/` exists (a path check, nothing more), and recorded on the session as its purpose. Deciding it per edit would close the guard as soon as the agent creates the directory, before it writes the login route.
- **Tools.** Two tools are new to this kind:
  - `run_scenario({ file })` runs the named scenario through the same runner the picker uses, against this session's drive. It lands the human's drive panel on success, and returns either the landing or the same failure the human would see (exit reason plus output tail). It refuses when the session's drive is no longer the live drive.
  - `set_scenario_runner({ command })` records the scenario runner host setting. It is the only setting this kind can write. The command must contain `{file}`. A dedicated tool keeps the runner out of `prepare`'s provenance machinery, which a later lap may still join.
- Where a slot/collision rule in the existing session machinery assumes one live session per feature, a scenario session docked to a drive must not be blocked by, nor block, the feature's ordinary chat. The ordinary chat is in any case blocked during a feature drive because the drive detaches the talk worktree. That is existing behaviour, unchanged.

### Drive state and events

- **Drive info.** The drive's live info (the one `driveInfo` query both drive views read) gains the current scenario:
  - its file and display name;
  - its status: running, landed or failed;
  - on landing, the entry URL plus a fresh landing id, so the panel reloads even when the URL repeats;
  - on failure, the exit reason and the output tail (the last ~40 lines);
  - while running, the live output.
- **List and run.** A query lists the scenarios for the live drive (file, group, name, own), and a mutation runs one against it.
- **Starting.** The drive start mutations accept an optional scenario file to run once the app answers. The feature and project variants both take it.
- **Events.** Running, landing and failing each emit a timeline event at the drive's scope (`scenario.started`, `scenario.landed`, `scenario.failed`), so the stream invalidates the drive views at once, per the events convention.
- **Settings.** The scenario runner is a project-only host setting, a peer of the drive setup/stop commands, shown in the same settings group as "Before a test drive" and editable there by hand.

### Dogfood

Runcastle's own repo ships one scenario, `.runcastle/scenarios/review/feature-at-review.ts`, run by the scenario runner `bun {file}`.
- It creates a fresh feature in the runcastle-demo project of the driven runcastle instance, named uniquely with `RUNCASTLE_SCENARIO_RUN`.
- The feature sits at review with its tickets done, and the scenario prints the inner runcastle's URL for that feature's page.
- Runcastle has no sign-in, so this scenario prints a plain URL.
- It seeds through the driven instance's own data dir and code (from the `drive.env` overlay runcastle's drive setup already writes), never the owner's real data dir.
- The runcastle project's own scenario runner host setting (`bun {file}`) lives in the human's installed runcastle, which gains the setting only when this feature is published. So the human records it after merge; a burn cannot.
- This lap's review exercises the UI in the *inner* runcastle, the branch build, on runcastle-demo, a throwaway repo: a project drive there, ＋ New scenario in setup mode, then the picker, switching and a failure.

## Seams

1. **Scenario service** (new; the main seam). A server-side module with two operations, tested against a temp git repo with throwaway scenario scripts and a real runner command (`bun {file}`).
   - **List scenarios** for a checkout and its base branch returns `{ file, group, name, own }[]`. Observable: grouping and naming from paths, `_` exclusion, own-detection from the branch diff, ordering.
   - **Run a scenario** in a drive's environment returns either `{ landed, entryUrl }` or `{ failed, reason, exitCode?, outputTail }`. Observable: `{file}` substitution, the identity plus `drive.env` plus `RUNCASTLE_SCENARIO_RUN` env, last-`ENTRY_URL`-wins, relative URL resolution, non-zero exit, missing `ENTRY_URL`, timeout.
2. **Drive service** (existing: feature and project test drives and their live info). Extended with an optional scenario at start, a run-against-the-live-drive entry point, and scenario status in drive info. Observable through the existing drive tests: a scenario runs only after the app answers; a failure leaves the drive up; status and events land at the right scope; switching scenarios does not restart the drive.
3. **tRPC** (existing routers, new procedures and inputs): list scenarios, run scenario, and the scenario input on the drive start mutations. Observable from a caller test.
4. **MCP `run_scenario`** (new tool, `scenario` sessions only, in the per-kind roster). Observable: refused for other kinds and for a dead drive; returns the same result shape as the scenario service; lands the drive.
5. **Edit guard** (existing pure function, new kind). Observable: `scenario` in setup mode allows any path in the checkout; with `.runcastle/scenarios/` present, it allows only `.runcastle/`.
6. **Launcher briefing** (existing artifacts and briefing builder, new kind). Observable: the rendered briefing carries identity, env overlay, runner, scenario list, description or failure, and the setup-mode block exactly when the directory is absent.
7. **Web** (existing drive views and next-step bar). Observable through component tests:
   - the split button's default and picker order;
   - the **Scenario** menu;
   - the failure panel showing reason and output tail, with **Fix it**;
   - the docked chat;
   - the panel navigating on each landing id.

## Out of scope

- Captures, before/after comparison and determinism (the draft "Reliable captures of screens and calls").
- The map in the sidebar, and group and entry pages (the draft "The map"). Scenarios appear only where a drive starts and inside a running drive.
- Mobile deep links (the draft "Mobile captures").
- Drive slot rules: ADR-0014 binds, unchanged.
- Automatic database reset between scenarios: entities are unique per run, and the existing reset suggestion stays as it is.
- A manifest of scenarios, configurable scenario directories, or any parsing of scenario contents.

## Open questions

- **Acceptance beyond dogfood.** Neither runcastle nor runcastle-demo has sign-in, so the signed-in landing cannot be proven on this lap's own drive. It is proven after merge on one of the human's own projects with sign-in, by ＋ New scenario in setup mode there. This is a deliberate check, not a gap to close in lap 1.
- **Session scope.** The `scenario` kind is the first kind whose scope (feature or project) follows the drive, not the kind. The burn agent settles how the session row and roster express that, without reshaping existing kinds.

## Later laps

- **API scenarios and Try it:** a scenario plus one request, with a Swagger-like **Try it** that runs it against the drive, authenticated with the scenario's `TOKEN`. Only the calls scenarios exercise are listed (brief item 8).
- **Review agents replay scenarios** instead of improvising setup, so their drive matches the human's (brief item 9). The dogfood scenario is the first candidate to replace the prose in runcastle's drive instructions.
- **Features ship a scenario** when the agent judges the state hard to reach; never required (brief item 7).
- **The Blank app nudge:** the first time the human picks Blank app, one line, "Setting this up by hand every time? Make it a scenario."
- **`prepare` learns about scenarios**, e.g. mentions them, or offers setup on a fresh project.
