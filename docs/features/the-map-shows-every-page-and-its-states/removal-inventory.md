# Removal inventory (2026-10-20)

This is a read-only sweep of the branch at `3ab200b` (lap 1 landed). Line numbers will drift, so trust the symbol names over them. **DELETE** means the whole file goes; **EDIT** means cut only what is named. Scenarios and drive code not listed here stay.

## 1. The map

### Core
- `packages/core/src/map.ts`: DELETE.
- `packages/core/src/index.ts`: EDIT. Remove `export * from './map'`.
- `packages/core/src/ids.ts`: EDIT. Remove `PROJECT_ID_PATTERN` once `paths.ts`, `stories-static.ts` and `services/map.ts` are gone.

### Server
- `packages/server/src/services/map.ts`: DELETE.
- `packages/server/src/trpc/routers/project.ts`: EDIT. Remove the map and main-catalogue imports and the `map` and `buildMapCatalogue` procedures.
- `packages/server/src/mcp/server.ts`: EDIT.
  - `mapGroups` (the import, the field, the `featureContext` parameter and its spread, the `mapGroupNames` call in `featureContextWithGit`);
  - `stories` / `pages` (the field, `FeatureStories`, `STORIES_FILE`, `featureStories`, the parameter, the spread);
  - their sentences in the `get_feature_context` description.
- `packages/server/src/launcher/launcher.ts`: EDIT.
  - Remove the `mapGroupNames` import and `mapGroups: await mapGroupNames(...)`.
  - Remove `hasStories` and its use in `confirmOnly`.
- `packages/server/src/launcher/artifacts.ts`: EDIT the scenario brief. Remove the `mapGroups` field, its destructure, and the "Groups already on the map" block.

### Web
- `apps/web/src/components/map/` (all five files): DELETE.
- `apps/web/src/lib/map.ts`: DELETE.
- `apps/web/src/lib/sidebar-mode.ts`: DELETE.
- `apps/web/src/components/SidebarLanes.tsx`: EDIT.
  - Remove the map imports, `SidebarModeSwitch`, `MapTreeGroup` and `MapTree`.
  - Fix the doc comment.
  - Keep `InboxLane` and `WorkLanes`.
- `apps/web/src/components/Sidebar.tsx`: EDIT.
  - Remove `useSidebarMode`, `MapTree` and `SidebarModeSwitch`, the `mapSelection` and `onOpenMap` props, `mode` and the `project.map` query, the switch, and the Map branch.
  - Always render the Work lanes.
- `apps/web/src/components/ProjectShell.tsx`: EDIT.
  - Remove the `MapView` import and `map` / `openMap`.
  - Remove the map branches in landing and pop handling, the `map` argument to `locationFor`, and the `view === 'map'` body.
  - Remove the map props passed to the Sidebar.
- `apps/web/src/components/ProjectWorkspace.tsx`: EDIT.
  - Remove `MapDriveIntent` and the `intent` / `newScenario` fields of `DriveRequest`.
  - Remove `runScenario`, `openScenarioChat`, `refreshDrive`, `driveFocus`, `focusOn`, `newScenarioOnceUp` and `driveUp`.
  - Keep only the `showDrive()` path of the driveRequest effect, and drop `focus={driveFocus}`.
- `apps/web/src/components/project/ProjectDriveView.tsx`: EDIT. Remove `DriveFocus` and the `focus` prop.
- `apps/web/src/components/review/ScenarioDrive.tsx`: EDIT. Remove the `DriveFocus` interface and the `focus` prop and its uses.
- `apps/web/src/components/review/ApiView.tsx`: EDIT. Remove the `preselected` prop, which only the map used.
- `apps/web/src/lib/workspace.ts`: EDIT. Remove the `map` state, `openMap`, `setMap` and its resets.
- `apps/web/src/lib/routes.ts`: EDIT. Remove the `'map'` `AppLocation` variant, its `pathFor` case, its `parsePath` branch, the `InProjectLocation` member, and `locationFor`'s map param and branch.
- `apps/web/src/lib/project-workspace.ts`: EDIT. Remove `'map'` from `WorkspaceView`, and the `map` param and branch.
- `apps/web/src/lib/live.ts`: EDIT. Remove `u.project.map.invalidate()`.
- `apps/web/src/icons.tsx`: EDIT, optional. Remove `IconList` if only `SidebarLanes` used it. Keep `IconCube`.

### Scenarios
- **DELETE:** `.runcastle/scenarios/map/map-of-this-checkout.ts` and `.runcastle/scenarios/_fixtures/ui-states.ts`.
- **KEEP:** `.runcastle/scenarios/feature/review/feature-at-review.ts` and `feature-at-review.http`.
  - Reword the `.http` comment that says it exists for the map's Calls / Try it; the drive's API view uses it.
  - Undo the lap-1 move, so both files go back to `.runcastle/scenarios/review/`, and update `dogfood-scenario.test.ts` and `drive-scenarios.test.ts`.
- **KEEP all of these:** `services/scenarios.ts`, `http-request.ts`, `scenarioMenu`, the drive's API view.

### Tests
- **DELETE:**
  - `packages/core/test/map.test.ts`
  - `packages/server/test/map.test.ts`
  - `apps/web/test/map-overview.test.ts`
  - `apps/web/test/map-view.test.tsx`
- **EDIT:**
  - `apps/web/test/sidebar-map.test.tsx`: keep "the pinned Inbox"; drop "the Work | Map switch", "the Map tree", the `project.map` mock and the map props.
  - `apps/web/test/sidebar-lanes.test.ts`: drop the `MapTree` describe and its import.
  - `apps/web/test/history-sync.test.tsx`: drop the "the map" describe.
  - `apps/web/test/live-resync.test.tsx`: drop the map invalidation case.
  - `apps/web/test/project-workspace.test.ts`: drop the map view test.
  - `apps/web/test/routes.test.ts`: drop the map cases.
  - `apps/web/test/project-drive-workspace.test.tsx`: drop the map-intent describe.
  - `apps/web/test/project-note-badge.test.tsx` and `sidebar-delete.test.tsx`: drop the `project.map` mock.
  - `apps/web/test/project-triage-launch.test.tsx`: drop the `runScenario` and `openScenarioChat` mocks.
  - `packages/server/test/scenario-session.test.ts`: drop the `mapGroups` cases.
  - `apps/web/test/fixtures.ts`: drop the map fixtures (`MAP_FRAME`, `day`, `mergedBy`, `onMain`, `couponsGroup`, `onboardingGroup`, `mapModel`).

## 2. The catalogue pipeline

### Core
- `packages/core/src/stories.ts`: DELETE. Also remove its export in `index.ts`.
- `packages/core/src/paths.ts`: EDIT. Remove `storiesRoot`, `featureStoriesDir`, `baseStoriesDir`, `STORIES_MANIFEST`, `assertProjectId`, `mainStoriesDir`, `mainStoriesAttemptDir`, `MAIN_CATALOGUE_RECORD`, `MAIN_CATALOGUE_ATTEMPT` and the `PROJECT_ID_PATTERN` import.
- `packages/core/src/schemas.ts`: EDIT. Remove `storiesBuild` and its import.
- `packages/core/src/workflow.ts`: EDIT. Remove the stories import and its line.
- `packages/core/src/db-schema.ts`: EDIT. Remove `storiesBuild` / `stories_build`, then generate the drop migration. See "Shared or entangled".
- `packages/core/src/config.ts`: EDIT. Remove `storiesPort`. The schema is not strict, so old config files are simply stripped.
- `packages/core/src/config-load.ts`: EDIT. Remove `RUNCASTLE_STORIES_PORT`.

### Server
- **DELETE:**
  - `workflows/stories-build.ts`
  - `services/stories-store.ts`
  - `services/main-catalogue.ts`
  - `routes/stories-static.ts`
- `routes/web.ts`: EDIT, optional. Un-export `contentType` and `safeJoin`.
- `index.ts`: EDIT. Remove the stories-static import, the stories port listener and `storiesServer?.stop()`.
- `services/merge.ts`: EDIT. Remove the catalogue imports, the `mergeCommit` read used only for promotion, `promoteOrBuildMain`, `removeFeatureStories` and `sweepBaseStories`.
- `services/features.ts`: EDIT. Remove the stories-store import and its two lines, and fix the comment.
- `services/tickets.ts`: EDIT. Remove `StoriesBuildRecord` and `storiesBuild` handling.
- `services/settings.ts`: EDIT. Remove the `storiesPort` descriptor.
- `services/git.ts`: EDIT, optional. Remove `fileExistsAt` if it has no callers left.
- `services/repo.ts`: EDIT, optional. Remove `setFeatureBranches`, which only the UI-states fixture used.
- `workflows/review-gates.ts`: EDIT.
  - Remove `outPath` / `outDir`, `GATE_SANDBOX_OUT_PATH`, `GateSandboxStep`, `afterCommands` and its step handling, the out-dir mount, and the Storybook / map comment.
  - KEEP `SandboxSetupError`, `runSandboxSetup` and `errorDetail`.

### Settings and env
- `apps/web/src/lib/settings.ts`: EDIT. Remove `storiesPort`.
- `.runcastle/drive-setup.ts`: EDIT. Remove the `storiesPort` pick and `RUNCASTLE_STORIES_PORT`. `pickPort`'s `after` parameter is then unused.

### Tests
- **DELETE:**
  - `packages/core/test/stories.test.ts`
  - `packages/server/test/stories-build.test.ts`
  - `packages/server/test/stories-build-migration.test.ts`
  - `packages/server/test/stories-store.test.ts`
  - `packages/server/test/stories-static.test.ts`
  - `packages/server/test/main-catalogue.test.ts`
- **EDIT:**
  - `packages/core/test/paths.test.ts`: drop "story catalogue dirs".
  - `packages/server/test/tickets.test.ts`: drop the `storiesBuild` cases.
  - `packages/server/test/review-gates.test.ts`: drop the `afterCommands` describe.
  - `packages/server/test/mcp-tools.test.ts`: drop "get_feature_context stories" and the `featureStories` import.

## 3. The UI states section

### Web
- **DELETE:** `components/review/UiStatesSection.tsx` and `components/review/StoryFrame.tsx`.
- `lib/api.ts`: EDIT. Remove `UiStatesModel` and `UiStatesStory`.
- `components/bodies/ReviewBody.tsx`: EDIT. Remove the UI-states import, query and render.
- `components/bodies/RunBody.tsx`: EDIT. Remove the UI-states import and render.
- `components/Workspace.tsx`: EDIT. Remove the UI-states import and render.
- `lib/live.ts`: EDIT. Remove `u.feature.uiStates.invalidate()`.

### Server
- `services/ui-states.ts`: DELETE.
- `trpc/routers/feature.ts`: EDIT. Remove the import and `uiStates`.

### Tests
- **DELETE:**
  - `apps/web/test/ui-states-section.test.ts`
  - `apps/web/test/ui-states-section-dom.test.tsx`
  - `apps/web/test/story-frame-dom.test.tsx`
  - `packages/server/test/ui-states-router.test.ts`
  - `packages/server/test/ui-states-scenarios.test.ts`
- **EDIT:**
  - `apps/web/test/preview-placement.test.ts`: drop the `uiStates` store, its mock and its describe.
  - Drop the `uiStates` tRPC stub from these five tests:
    - `review-bands.test.ts`
    - `review-blocking-drive.test.tsx`
    - `review-page-clicks.test.tsx`
    - `run-body-model.test.tsx`
    - `stage-expand.test.tsx`
  - `apps/web/test/fixtures.ts`: drop `FEATURE_FRAME`, `BASE_FRAME`, `uiStory` and `uiStatesModel`.

### Scenarios
- **DELETE:** `.runcastle/scenarios/feature/review/feature-with-ui-states.ts` and `ui-states-every-state.ts`.

## 4. Storybook in the repo and the skill pack

### Repo
- **DELETE:**
  - `.runcastle/storybook/`, except the helpers that move to `.runcastle/preview/` (spec, decision 18);
  - `.runcastle/stories/`;
  - `.runcastle/stories.json`.
- `package.json`: EDIT.
  - In the `typecheck` script, swap the storybook tsconfig for the preview one.
  - Remove `@storybook/react-vite`, `storybook` and the Geist font packages.
  - `react`, `@tanstack/react-query`, `@types/react` and `@types/node` came in with the Storybook setup (commit `ae8132b0`). The root `vitest.setup.ts` and `@testing-library/react` may now resolve `react` from the root, so remove them one at a time and run `bun install`, `bun run test` and `bun run typecheck` after each.
  - Regenerate `bun.lock`.
- `scripts/tsconfig.json`: EDIT. Remove the comment and the `exclude` that mention the storybook dir.

### Skill pack and prompts
- **DELETE:** `packages/skills/packs/runcastle/skills/prepare/references/stories.md` and `references/page-stories.md`.
- `prepare/SKILL.md`: EDIT.
  - Remove the description's "once-per-project UI-states setup" and step 5.
  - Remove the parenthetical that widens the edit rule to the manifest and lockfile.
  - Remove the "## UI states (once per project)" section and "unless it also lists UI states as open…".
- `tickets/SKILL.md`: EDIT.
  - Remove the `mapGroups` bullet in `<ship-a-scenario>` and the whole `<ship-a-story>` block.
  - Remove self-check items 8–10, then renumber.
- `revisit/SKILL.md`: EDIT. Remove "Whether one ships a story…".
- `packages/skills/burner/implement-ticket.md`: EDIT. Remove "## Page stories".
- `packages/skills/burner/review-ticket.md` and `verify-fixes.md`: EDIT. Change `{{GATE_NOTES}}{{STORIES_NOTES}}` to `{{GATE_NOTES}}`.
- `packages/server/src/workflows/review-ticket.ts`: EDIT.
  - Remove the stories imports, `'STORIES_NOTES'`, `PAGE_RULE_NOTE`, `featureHasPageStories` and `buildStoriesNotes`.
  - Remove the `planStories` dep and `runBranchGates`'s `afterCommands` param.
  - Trim `runBranchChecks` to the head resolve and the gate run, and drop `storiesBuild` from `updateTicket`.
- `packages/server/src/launcher/artifacts.ts`: EDIT the prepare brief.
  - Remove `hasStories`, `uiStates`, the manifest/lockfile sentence, the stories.json probe, and the UI-states branches.
  - Remove `PREPARE_BASH_WRITE_RULES`' package.json and lockfile `git add` lines.
- `packages/server/src/launcher/edit-guard.ts`: EDIT. Remove `isPackageManifest`, its use and its denial text, and fix the doc.
- `packages/server/src/launcher/lockfiles.ts`: EDIT the doc only. `LOCKFILES` stays.
- `apps/web/STYLE.md`: EDIT. Remove "## Stories".

### Tests
- `packages/server/test/review-ticket.test.ts`: EDIT. Drop the stories imports, the `STORIES_NOTES` keys, the stories-notes tests, and the stories case of the gate-run test (including `storiesBuild` in the patch expectation).
- `packages/server/test/prepare-session.test.ts`: EDIT. Drop the `hasStories` / UI-states cases, the UI-states skill test, the manifest-guard tests, and the `stories.json` write.
- `packages/server/test/tickets-skill.test.ts`: EDIT. Drop the `<ship-a-story>` test.

## Shared or entangled

- **DB.** `tickets.stories_build` came from `drizzle/0048_new_northstar.sql`, which is on main and has run in local databases, so never delete it. Add a new drop migration with `db:generate` after editing `db-schema.ts`. No other column or table belongs to these features.
- **Events.** `stories.built`, `stories.failed`, `stories.couldnt_run`, `stories.removed` and `map.catalogue.*` stop being emitted. Nothing in the web code labels them; only the `live.ts` invalidations go.
- **On disk.** `~/.runcastle/stories/` and any lingering `runcastle/stories*/` throwaway branches are left alone.
- **Config keys and env vars.** `storiesPort` appears in core config, server settings and web settings. `RUNCASTLE_STORIES_PORT` appears in `config-load.ts` and `.runcastle/drive-setup.ts`.
- **Keep:** the Inbox lane and `sidebarLanes()`, `runSandboxSetup`, and `renderTemplate`'s one-pass rewrite.
- **Final greps.** After the cut, grep for `'../map/`, `StoryFrame`, `uiStates`, `storiesPort`, `storiesBuild`, `STORIES_NOTES`, `mapGroups`, `fileExistsAt` and `PROJECT_ID_PATTERN`. Then run `bun run typecheck`, which covers `scripts/` and `.runcastle/**`.
