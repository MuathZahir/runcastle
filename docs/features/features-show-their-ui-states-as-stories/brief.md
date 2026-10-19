# Brief

## Why this feature exists

The human wants to *see* what a feature built without clicking through the app. A feature's UI states include empty, error, loading and "coupon expired". Many are hard to reach even with a scenario, and each look costs a drive, which can take minutes to start on projects with Docker services.

**What was tried and rejected (project session, 2026-10-17/18), so it is not rebuilt.** The previous design captured screens instead: DOM snapshots plus screenshots of every scenario, base and branch side by side each round, with masking, flake detection and a 20-run determinism gate. The human: "This is so convoluted and overengineered for what it is." It also started the app twice per round, and that cost is what sank it. The drafts *Reliable captures of screens and calls* and *Round effects* are being archived.

**What replaced it:** a Storybook-style catalogue. Stories render components with fixed sample data, so they need no database, no Docker and no backend.
- A built catalogue is static files, so it opens instantly at any time and never takes the drive slot.
- Fixed sample data makes stories deterministic by construction, which is how Chromatic does visual review on top of Storybook.
- Stories break the typecheck when a component's props change, so they cannot drift silently. That fits the charter's "minimal docs; executable things that break loudly".

## Settled in the project session

1. **Runcastle never renders components itself.** Rendering means compiling the project's code with its framework, bundler and CSS. Doing that would rebuild Storybook once per framework and break the language-agnostic principle.
   - The project's own tool builds the catalogue: Storybook for React, Vue, Svelte, Angular and React Native; Widgetbook for Flutter.
   - Runcastle only runs a build command, serves the static output and embeds it in its own pages, the way the drive shows the app in a frame.
2. **Shown inside runcastle, not linked out.**
   - The feature page gets a section, "This feature's UI states", listing the stories the feature added or changed, each rendered inline. Storybook serves a single story on its own URL, and a static build writes an `index.json` listing every story with its id and source file.
   - The section can open the full catalogue.
   - Which stories a feature touched comes from its git diff: story files matched by a filename pattern, then matched to `index.json` entries. Only paths, git and text are involved.
3. **The catalogue is built in the sandbox,** where dependencies are already installed. The human's machine never runs a story dev server.
4. **The human never installs anything by hand.**
   - The first time planning judges a feature's UI states worth showing and the project has no stories, the plan gets one extra ticket, "Set up stories".
   - The burn runs the tool's official setup and does the project-specific part: wrapping stories in the app's providers (theme, router, translations, signed-in user), adding fake data (usually MSW) for pages that load data, and recording the build command runcastle runs.
   - Review checks that the catalogue builds.
   - The human sees the new dev dependency and config in the feature's diff, and it reaches main only on merge.
   - This mirrors how the first ＋ New scenario chat sets up scenarios (`drive-scenarios` decision 5).
5. **Stories are written by planning's judgement, never required,** like scenarios (`drive-scenarios` decision 13).
   - A ticket that builds a UI state worth seeing gets an acceptance criterion to ship its story.
   - A copy change gets none.
   - A backend-only project is never asked.
6. **Optional per project.** A project without stories works exactly as today.
7. **The first project is runcastle's own UI (`apps/web`).** It has the most hard-to-reach states (feature states, burn states, review states) and is where the human would use stories daily. None of the human's projects use Storybook today; runcastle, runcastle-demo, JanaLearn_Updated and jewellery-system were all checked.

## What this feature must decide in its own session

- **Where the build command and story file pattern are recorded:** project settings, like `driveSetupCommand`, or a file under `.runcastle/`.
- **When the catalogue is built:**
  - at review only, or at the end of each burn;
  - where the static output is kept (the data dir), per feature and per run;
  - how long it is kept.
- **How a page-level story gets its data,** and how far the setup goes on a project whose pages all fetch.
- **How `apps/web` fits with its existing component-test tiers** (`apps/web/STYLE.md`).
- **What the section shows when the build fails:** the failure, with its output.

## What this feature must NOT swallow

- **The map view in the sidebar.** The draft *The map of stories and scenarios* owns it. This feature shows stories on the feature page only.
- **Before/after comparison of stories across rounds.** It is not wanted now; if it returns, it is a later feature.
- **Drives and scenarios.** End-to-end checks still need a drive, once per feature; *Review hands you a running drive with what it saw* owns that.

## Binding

- **Charter:** language-agnostic by construction; individual developers first; starting the app is the expensive step.
- **ADR-0014:** one drive slot per project. Stories never use it.
- **`drive-scenarios` decisions 5 and 13:** they set the pattern this mirrors.
