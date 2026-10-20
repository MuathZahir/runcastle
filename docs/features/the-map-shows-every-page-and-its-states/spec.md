# The map shows every page and its states — re-scoped: remove the map and Storybook

> Lap 1's spec (page stories, the map of places) is superseded by decisions 14–18. It lives in git history (this file before 2026-10-20).

## Problem

The human wanted one thing from stories: **iterate with the agent on a screen in a given state without test-driving and clicking their way to it.** Three features built something else around that need:
- a map of every story on main, rebuilt and promoted at merge;
- a story catalogue built at every review pass, with a "UI states" before/after section on the review page;
- a rule that workers write and update stories.

All of it is upkeep, and none of it is the live iteration. The live iteration is now the draft *Design mode* (re-briefed 2026-10-20). Screens at review come from the review agent's screenshots (*Review hands you a running drive with what it saw*). This lap removes the rest.

## Approach

### What the human sees after this lap
- **No Map.** The sidebar shows the pinned Inbox and the Work lanes, with no Work | Map switch.
- **No "UI states" section** on the feature page, at review or between reviews.
- **No stories port and no "Stories port" setting.**
- **Prepare no longer sets up stories.** A web project's prepare is shorter, and installs no Storybook packages.
- **Everything else unchanged.** Drives, the Test drive picker, the running drive's Scenario menu and its API view, review, gates and merge all work as before.

### What is removed (decisions 15, 16)

`removal-inventory.md` in this folder lists every file and symbol, by area. Line numbers there are from 2026-10-20 and may drift. The four areas:
1. **The map:**
   - core `map.ts`, server `services/map.ts`, `project.map` and `project.buildMapCatalogue`;
   - the web `components/map/`, `lib/map.ts`, `lib/sidebar-mode.ts`, the sidebar's switch and Map tree;
   - the `'map'` location in `routes.ts` and in the workspace view;
   - the map's drive doors (`DriveFocus`, `ApiView`'s `preselected`, `DriveRequest.intent` and `newScenario`);
   - `mapGroups` and `stories.pages` in agents' feature context and the scenario brief.
2. **The catalogue pipeline:**
   - `workflows/stories-build.ts`, `services/stories-store.ts`, `services/main-catalogue.ts`, `routes/stories-static.ts`, the stories port listener, and core `stories.ts`;
   - the catalogue paths in `paths.ts`;
   - `storiesBuild` on tickets, `storiesPort` in config and settings, `RUNCASTLE_STORIES_PORT`;
   - in the gate sandbox: the out-dir mount and `afterCommands`;
   - promotion and cleanup at merge;
   - the stories port in `.runcastle/drive-setup.ts`.
3. **The UI states section:** `UiStatesSection`, `StoryFrame` and its dialog, `services/ui-states.ts`, `feature.uiStates`, and their places in `ReviewBody`, `RunBody` and `Workspace`.
4. **Stories in the skill pack and prompts:**
   - prepare's "UI states (once per project)" section and its `references/stories.md` and `references/page-stories.md`;
   - the prepare brief's stories branches, and the edit guard's package-manifest exception that existed only for the Storybook install;
   - the tickets skill's `<ship-a-story>` block, including the page rule, its `mapGroups` bullet and self-check items 8–10;
   - revisit's story sentence;
   - the burner's "Page stories" section;
   - `{{STORIES_NOTES}}` in the review and verify templates, with `buildStoriesNotes` and its helpers;
   - `apps/web/STYLE.md`'s "Stories" section.

**The database.** `tickets.stories_build` (migration 0048) is dropped by a new migration generated with `bun run --filter @runcastle/server db:generate` after editing `db-schema.ts`. 0048 stays, because local databases already ran it.

**Kept on purpose:**
- **Scenarios and all drive-scenario code:** `services/scenarios.ts`, `http-request.ts`, `scenarioMenu`, `ApiView`, and `feature-at-review.ts` with its `.http`.
- **The Inbox lane and `sidebarLanes()`.**
- **Fixes:** `runSandboxSetup` / `SandboxSetupError` in the gate sandbox, and `renderTemplate`'s one-pass rewrite.
- **`LOCKFILES`,** which the host probe uses.
- **Old event rows** of the removed `stories.*` and `map.catalogue.*` types stay in event logs.
- **On-disk leftovers:** `~/.runcastle/stories/` is left alone. Nothing reads it; the human can delete it.

### Runcastle's own repo (decisions 16, 18)
- **Deleted:**
  - `.runcastle/storybook/` (Storybook config, preview and `fail-loudly`);
  - every story under `.runcastle/stories/`;
  - `.runcastle/stories.json`;
  - the scenarios `map/map-of-this-checkout.ts`, `feature/review/feature-with-ui-states.ts` and `feature/review/ui-states-every-state.ts`, plus `_fixtures/ui-states.ts`.
- **The lap-1 scenario move is undone:** what remains of `scenarios/feature/review/` goes back to `scenarios/review/`, and the tests that name the paths follow.
- **Kept as plain code in `.runcastle/preview/`** (decision 18), with no Storybook import left:
  - `fake-api.ts` (fake tRPC at the `fetch` edge, including named mutations);
  - `shell-fakes.ts`;
  - `app-at.tsx`;
  - the silent `EventSource` stand-in, moved out of `preview.tsx` into its own module.

  A one-paragraph header in `fake-api.ts` says these are design mode's starting point and are used by nothing else yet.
- **The `typecheck` script** swaps `tsc --noEmit -p .runcastle/storybook/tsconfig.json` for a `.runcastle/preview/tsconfig.json`.
- **Root dependencies:** `storybook` and `@storybook/react-vite` go, and so do the Geist font packages the Storybook preview loaded. Root `react`, `@tanstack/react-query`, `@types/react` and `@types/node` stay only if the preview helpers or the root test setup still need them to typecheck. Remove one at a time with `bun install`, `bun run typecheck` and `bun run test` between.

## Seams

- **Web:** the sidebar, project shell and workspace, routes, review and run bodies, and settings, observable through the existing web component tests (map- and UI-states-only tests deleted, shared ones trimmed).
- **Server and core:** the tRPC routers (`project`, `feature`), the MCP `get_feature_context`, merge, tickets, settings, config, the review workflow and gate sandbox, the prepare brief and edit guard, observable through the existing server tests and the prompt-render tests.
- **Skill pack:** read, plus `tickets-skill.test.ts` and `prepare-session.test.ts`.
- **Repo:** `bun run typecheck` (which covers `.runcastle/**`) and `env -u GIT_ASKPASS bun run test`.
- **The migration:** the existing migration tests (a fresh database migrates to head with no `stories_build` column).

## Out of scope

- **Design mode's preview pane, the agent's tool to open it, its dev server, and tweaks.** The draft *Design mode* owns them.
- **Screenshots at review.** *Review hands you a running drive with what it saw* owns them.
- **The charter's mention of stories** (`CONTEXT.md` lines 63–64). Only a project session writes the charter; the human is told.
- **Deleting other features' docs.** `features-show-their-ui-states-as-stories` and `the-map-of-stories-and-scenarios` stay as records.

## Open questions

None. Every decision above was made with the human on 2026-10-20, except decision 18 (keep the helpers), which is assumed.
