# Outcome — The map of stories and scenarios

The sidebar gains a Map view beside Work, with the Inbox pinned above both. The map shows your app by product name: each group's stories rendered live, its scenarios to drive into, and its calls to try, with git history saying which features changed each one.

- Shipped: 2026-10-19
- Laps run: 2

## What shipped

31 commits · 71 files

### Lap 1
- 6 tickets landed: #1 Map foundation: groups, the map model, and the map address; #2 Main's catalogue: build on demand, serve it, promote it at merge; #3 Sidebar: pinned Inbox, Work | Map switch and the group tree; #4 Map pages: the overview, group pages and doors into the drive; #5 Agents reuse the map's group names when they add stories and scenarios; #7 Project home's Test drive card still says "Notes land in the inbox"
- 0 waived
- 0 failed

### Lap 2
- 3 tickets landed: #9 Build the catalogue works in the Docker sandbox; #10 History names what shaped each component, and runcastle gets a call to try; #12 History is still saturated for ConflictCard and the Review page story (50 features each) because the feature-ui barrel is never counted as shared
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: a04680e099736b7f570ecd2cf78269b82aa735ea
- Landed since: 4
- Outcome: done

### Lap 1 · verification

- Reviewed commit: df5c9d2eaf5ea6030a7746740dbd867d0fe81fe7
- Landed since: 3
- Outcome: done

### Lap 2 · review

- Reviewed commit: d4f8cdf5a85ee396d59fb1320e697977a2a0b0ac
- Landed since: 1
- Outcome: done

### Lap 2 · verification

- Reviewed commit: 9900df7b333a94d2cfd6f20fe08c9d5f3d0308d1
- Landed since: 0
- Outcome: done

- **The barrel fix was verified on runcastle-demo, not on runcastle's own ConflictCard** — open

## Notes record

- I got:

┌  Building storybook v10.6.2
│
◇  Cleaning outputDir: ../../../../runcastle-stories-out
│
■  SB_CORE-SERVER_0007 (MainFileEvaluationError): Storybook couldn't
│  evaluate your .runcastle/storybook/main.ts file.

│  Original error:
│  Error: Cannot find module '../lightningcss.linux-x64-gnu.node'
│  Require stack:
│  - /node_modules/lightningcss/node/index.js
│  at Function._resolveFilename
│  (node:internal/modules/cjs/loader:1430:15)
│  at defaultResolveImpl (node:internal/modules/cjs/loader:1040:19)
│  at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1045:22)
│  at Function._load (node:internal/modules/cjs/loader:1216:25)
│  at wrapModuleLoad (node:internal/modules/cjs/loader:254:19)
│  at Module.require (node:internal/modules/cjs/loader:1527:12)
│  at require (node:internal/modules/helpers:147:16)
│  at Object.<anonymous> (/node_modules/lightningcss/node/index.js:22:22)
│  at Module._compile (node:internal/modules/cjs/loader:1781:14)
│  at Object..js (node:internal/modules/cjs/loader:1913:10)
│  at loadMainConfig
│  (file:///home/agent/cache/store/npm/_npx/6fe9a9991b157df1/node_modules/storybook/dist/_node-chunks/chunk-XYQ3GU6K.js:14427:11)
│  at async buildStaticStandalone
│  (file:///home/agent/cache/store/npm/_npx/6fe9a9991b157df1/node_modules/storybook/dist/core-server/index.js:7535:16)
│  at async withTelemetry
│  (file:///home/agent/cache/store/npm/_npx/6fe9a9991b157df1/node_modules/storybook/dist/_node-chunks/chunk-JL3YXRU7.js:142:12)
│  at async build
│  (file:///home/agent/cache/store/npm/_npx/6fe9a9991b157df1/node_modules/storybook/dist/bin/core.js:4821:3)
│  at async _Command.<anonymous>
│  (file:///home/agent/cache/store/npm/_npx/6fe9a9991b157df1/node_modules/storybook/dist/bin/core.js:5003:7)
│
└  Storybook exited with an error


npm warn exec The following package was not found and will be installed: storybook@10.6.2

When I clicked the build catalog button — carried → lap 2

## Per-ticket digests

### Lap 1

#### 1. Map foundation: groups, the map model, and the map address

# Ticket 1: Map foundation (digest)

**What was done**
- **Core:** `packages/core/src/map.ts`, exported from the barrel, has `mapNameKey`, `groupMap`, `touchesCatalogue`, `catalogueDependsOn`, `MAP_UNGROUPED` (`'~ungrouped'`) and `MAP_UNGROUPED_NAME`, and zod schemas for `MapHistoryEntry`, `MainCatalogueRecord`, `MainCatalogueAttempt`, `MapModel`, `MapGroup`, `MapComponent` and `MapScenario`. `isNodeModule` is now exported from `stories.ts`.
  - `groupMap` returns `MapGroupSkeleton[]`. Each scenario carries `hasCall`; the server turns that into `call`.
  - Folding past level 2 keeps only the first two segments.
  - Component `importPath` is normalised (no `./`), which is also the `storyHistory` key.
- **Paths:** `PROJECT_ID_PATTERN` (`/^proj_[A-Za-z0-9_-]+$/`) is in `ids.ts`. `paths.ts` has `mainStoriesDir`, `mainStoriesAttemptDir`, `MAIN_CATALOGUE_RECORD` and `MAIN_CATALOGUE_ATTEMPT`, and both dir functions throw on anything that is not a project id.
- **Server:** `services/map.ts` holds `mapModel(ctx, projectId)` and exports `parseMapHistoryLine`, `creditMapHistory`, `mapHistoryOf` and `MAP_HISTORY_FORMAT` for the next ticket's story history. `project.map` query added.
  - Credits are looked up at read time, so stored `storyHistory` is re-credited with current titles.
  - `MainCatalogueAttempt.log` is read as a file name inside the attempt dir (e.g. `build.log`), the same convention as the feature manifest.
  - `requestLine` is the parsed `METHOD target`, using `parseHttpRequest`, rather than the raw line.
  - Each in-memory cache keeps only the latest tip per project.
- **Web:** added the `map` location kind with its path/parse/`locationFor` handling; `useWorkspace` `map` + `openMap`; `WorkspaceView` `'map'`; the `MapView` stub with `MapDriveIntent`; and `ProjectShell` wiring for landing, pop, body and sidebar props.
  - `Sidebar`'s `mapSelection` / `onOpenMap` are optional props, so existing Sidebar tests still compile.
  - `onOpenDrive` calls `openDrive()` and ignores the intent.

**Surprises**
- No location `switch` exists outside `routes.ts`: `feature-ui/session.ts:135` switches on session kind, and core's `routes.ts` does not mirror location kinds.
- There is no ProjectShell render test. Landing on the map is covered by the `workspaceView`, routes and history-sync tests instead.

**Left undone**
- Main builds and promotion (next ticket).
- Serving `/main/` on the stories port.
- The Map tree in the Sidebar, the real MapView pages, and carrying the drive intent into the drive view.
- No drive machinery change was needed: no new service, env var, seed or process.

#### 2. Main's catalogue: build on demand, serve it, promote it at merge

# Ticket 2: Main's catalogue (digest)

**What was done**
- **Refactor.** `workflows/stories-build.ts` has a feature-free core: `catalogueStep` (the sandbox step plus reading its output) and `buildCatalogueAt({config, project, sha, branch, outDir, deps})`, which returns `built{index,stats,log}`, `failed`, `couldnt_run` or `none`.
  - The feature review path now runs through the same core. Its 11 tests pass unchanged.
  - `readBuildOutput`, `swapInto` and `readStoriesConfigAt` are now exported.
- **New `services/main-catalogue.ts`:**
  - `startMainBuild` is single-flight per project, held in an in-memory map. It emits `map.catalogue.started` before it returns.
  - `buildMainCatalogue` is the awaited core, which the scenario uses directly.
  - `computeStoryHistory` makes one `git log --first-parent -m --name-only` pass and walks the forward import graph from preview-stats `reasons`. It keeps up to 50 entries per story, newest first, with no credit attached (map.ts credits them when the map is read).
  - `promoteOrBuildMain` is the merge step.
  - Test seams: `__setMainBuildDeps` (the default sandbox deps for background builds) and `mainBuildSettled(projectId)`.
- **Attempts.** Each one writes its output to `main-attempts/<id>/out-<rand>/`, not a single `out/`, so two attempts never share a dir. A fresh `startMainBuild` clears the whole attempt dir first.
- **Supersession.** A result is dropped when the slot's `main.json` commit, or a later attempt's commit, has this build's commit as an ancestor. This applies to failures too.
- **Throwaway branch.** It is `runcastle/stories-main/<sha12>`, one per commit, so a newer build never re-pins an older one's branch.
- **Merge.** `merge.ts` reads the merge commit with `git.headSha(target)` before `promoteOutcomeDoc`, then calls `promoteOrBuildMain` before `removeFeatureStories`.
  - Nothing happens when the target is not main, or when the merge commit has no `stories.json`.
- **Stories port.** It serves `/main/<projectId>/` and refuses `main.json`, `attempt.json`, the manifest and both logs. `main-attempts/` is never one of the served areas.
- **tRPC.** `project.buildMapCatalogue` added.
- **Scenario.** `.runcastle/scenarios/map/map-of-this-checkout.ts` prints a relative `ENTRY_URL=/p/<id>/map/review`, because `featureUrl` is relative too and builds no origin. It typechecks but has not been run.

**Surprises**
- simple-git does not raise on `merge-base --is-ancestor`'s bare exit 1, so that check always said "ancestor". It now compares `merge-base` output instead.
- The scenario folder `map/` adds a "Map" group to runcastle's own map.

**Left undone**
- **Stuck "building" record.** In-flight state is in memory only. A server restart mid-build leaves `attempt.json` at `building`, and the map shows "building" until the next start clears it.
- **No new drive machinery.** None was needed: no new service, env var, seed or process.

#### 3. Sidebar: pinned Inbox, Work | Map switch and the group tree

# Ticket 3: sidebar Inbox, Work | Map switch and the group tree (digest)

**What was done**
- `sidebarLanes(features, { showArchived })` in `lib/feature-ui/sidebar.ts` returns `{ inbox, lanes }`. It is `triage()` with the needsYou lane lifted out. `triage()` is unchanged; the Sidebar was its only app caller and now uses the new function.
- New `components/SidebarLanes.tsx` holds four presentational parts the Sidebar composes: `InboxLane` (shows "Nothing needs you" when empty), `SidebarModeSwitch` (the `Tabs` primitive at `sm`), `WorkLanes` (the old lane loop, moved as-is with the Shipped cap, Show all and the archived toggle) and `MapTree`.
  - `MapTree` shows Overview, then the groups in model order. Level-2 groups are indented with `ml-4`. Ungrouped is a quiet `NavItem`.
- `lib/sidebar-mode.ts` has `useSidebarMode(projectId, mapSelection)`. The key is `runcastle.sidebarMode.<projectId>` and every read and write is in try/catch.
  - A defined `mapSelection` forces Map, and leaving the map keeps Map. The forced mode is not written to storage; only clicks on the switch are.
  - `project.map` is queried only while Map is showing.
- The notes card's empty state now reads "No open notes". No other visible notes copy said "Inbox": NoteCapture's button already reads "View". `onOpenInbox` and the other identifiers are kept, since ProjectShell, which ticket 4 owns, passes them.
- The story `.runcastle/stories/sidebar/InboxAndSwitch.stories.tsx` is a prop story over the presentational parts, with `FeatureRow`s built from `test/fixtures`. It has three states: WorkMode, NothingNeedsYou, and MapModeWithSelectedGroup.
- Tests:
  - `test/sidebar-lanes.test.ts` (tier 1): the split, the Inbox markup, and the tree's order, indent and highlight.
  - `test/sidebar-map.test.tsx` (tier 2): the Inbox in both modes, per-project persistence, a throwing localStorage, a map address forcing Map, the switch never navigating, and tree clicks.
  - Two existing Sidebar test mocks gained `project.map`.
  - Full `bun run typecheck` and `bun run test` are green.

**Surprises**
- The `test/fixtures.ts` `listItem` ignores a `title` override, so tests and the story spread the title in afterwards.
- A story file cannot import `@runcastle/core`, because there is no root-level resolution. The story imports `packages/core/src/map` by relative path.
- The collapsed sidebar is `SidebarRail` (search and new chat only) and never renders `Sidebar`, so it needed no change.
- The unit tests live in `apps/web/test/` (vitest only includes `apps/*/test`), not at `lib/feature-ui/sidebar.test.ts` as the ticket said.

**Left undone**
- The Inbox scrolls with the lanes rather than sticking at the top.
- No drive machinery change was needed: no new service, env var, seed or process.

#### 4. Map pages: the overview, group pages and doors into the drive

# Ticket 4: Map pages, overview, group pages and drive doors (digest)

**What was done**
- **Shared frame:** the review page's frame, Open larger button and full-size dialog moved out of `UiStatesSection` into `components/review/StoryFrame.tsx` (`StoryFrame`, `OpenLarger`, `StoryLargerDialog`). `UiStatesSection` now uses them, and its tests pass unchanged. `StoryFrame` takes an opt-in `deferred` flag: with it, the frame shows a fixed-height `data-frame-placeholder` until an IntersectionObserver sees it.
- **`components/map/`:**
  - `MapView` holds the topbar crumbs (Map › parent › group), a wide `Page`, the `project.map` query and the build mutation. An unknown group shows an EmptyState with "Back to the overview".
  - `MapOverview`, plus the `GroupRows` it shares with the group page.
  - `MapGroupPage`.
  - `CatalogueStatus`, the one catalogue line used by the overview and the UI states heading.
  - `HistoryLine` (`HistoryLatest` / `HistoryEarlier`). Pure wording lives in `lib/map.ts`: `mapTally`, `historyDay`, `historyCredit`, `subjectStart` and `mapGap`.
- **Group page extras:** a parent group with nothing of its own lists its child groups. Its UI states section shows the never-built or failed message only when stories are set up; when they aren't, the section is left out, so no group page nags.
- **New `MapView` props:** `onOpenFeature`, `onOpenPreparation` and `onNewScenario` (all optional), wired in ProjectShell.
- **Drive requests:**
  - ProjectShell's `driveRequest` counter is now `DriveRequest | null` = `{ intent?: MapDriveIntent; newScenario?: boolean }`. The titlebar pill sends `{}`.
  - `ProjectWorkspace` handles every case in one effect: a live project drive runs `feature.runScenario`; a free slot starts the drive with the scenario, as the Test drive picker does; anything else (another holder, or no drive commands yet) lands on the resting page and toasts the blocked reason.
  - The requested side reaches the drive view as a `DriveFocus { side, scenario, seq }`, through `ProjectDriveView` to `ScenarioDrive` (which sets its view) and on to `ApiView`. `ApiView` gets a new `preselected` prop and is keyed by `seq`.
  - The intent's `call` file is not used to select anything: the API view's entries are keyed by scenario file, and each call belongs to one scenario.
- **New scenario:** opens `feature.openScenarioChat` on a live, answering project drive. With no drive running, it starts one and opens the chat once `devReady` and `devUrl` are both set.
- **Live refresh:** `lib/live.ts` refetches `project.map` on every event signal. The live stream has no per-event-type mapping (it is an allowlist of queries), so this covers `map.catalogue.*`.
- **Stories and tests:** `.runcastle/stories/map/Overview.stories.tsx` and `GroupPage.stories.tsx` are prop stories built on the new map fixtures in `test/fixtures.ts`. Tests: `test/map-overview.test.ts` (tier 1), `test/map-view.test.tsx` (tier 2), and new cases in `project-drive-workspace.test.tsx` and `live-resync.test.tsx`.

**Surprises**
- `project.buildMapCatalogue` (ticket 2) was not on the router. `MapView.tsx` reaches it through one typed cast, `buildMapCatalogue()`, with a comment to drop it once the router has the procedure. Until ticket 2 lands, Build and Rebuild fail at runtime with "no such procedure".
- `project-triage-launch.test.tsx` mocks trpc per file, so it needed `runScenario` and `openScenarioChat` stubs once ProjectWorkspace started calling those hooks.

**Left undone**
- Set up stories only opens preparation. There is no way to deep-link to its stories step.
- The drive-request effect reads the drive slot as it stands at the ask. It relies on ProjectShell having already polled `feature.driveInfo` (same query key), so the slot is cached when the request lands.
- No drive machinery change was needed: no new service, env var, seed or process.
- Checks: `bun run typecheck` is green, including the stories tsconfig. The full test suite's only failure was `project-triage-launch`, and after the fix that one file passes (6/6); I didn't re-run the whole suite.

#### 5. Agents reuse the map's group names when they add stories and scenarios

# Ticket 5 — agents reuse the map's group names

**What was done**
- `mapGroupNames(ctx, projectId)` in `packages/server/src/services/map.ts` returns main's group display names in map order, level two as `Parent › Child`, Ungrouped left out. It reads main's stored story index (only when the catalogue is built, as `mapModel` does) and main's scenario paths. It computes no history and never builds. It returns `[]` when main has no commits.
- `get_feature_context` carries `mapGroups: string[]` on every git-read reply, empty when main has none. Its tool description documents the field. `featureContextWithGit` is exported so the fixture test can reach the git-reading path.
- The scenario session: `ScenarioBrief.mapGroups` is filled in `launchScenarioSession` via `mapGroupNames`. `renderScenarioPrompt` prints the "Groups already on the map: …" line only when the list is non-empty.
- Skill text: `tickets/SKILL.md` gained a `mapGroups` bullet in `<ship-a-scenario>` and in `<ship-a-story>`, plus self-check item 9. `prepare/references/stories.md` gained a paragraph on matching story title groups to scenario folder names.
- This iteration found the ticket's work already committed by an earlier iteration. It fixed one stacked doc comment on `featureContextWithGit` (commit `e7ff2a95`) and verified the rest.

**Surprises**
- The briefing line and the tickets skill write level-two names as `Checkout › Coupons`, while the folder is `checkout/coupons/`. The agent has to translate the separator into a nested folder. Worth watching in use.
- `mapGroupNames` repeats `mapModel`'s tip and catalogue-built logic rather than sharing it. Extracting a helper would be a small follow-up.
- `FeatureContext.mapGroups` is typed optional, though `featureContextWithGit` always sets it.

**Left undone**
- No drive machinery change: no new service, env var, seed or process.
- The skill text changes were checked by reading only. `packages/skills` has no check script.

**Checks run**
- Targeted: `map.test.ts`, `scenario-session.test.ts`, `mcp-tools.test.ts`, `launch-artifacts.test.ts`: 4 files, 163 tests passed.
- `bun run --filter '@runcastle/server' typecheck`: exit 0. Full `bun run typecheck`: exit 0.
- Full `env -u GIT_ASKPASS bun run test`: 361 files passed, 2 skipped; 5061 tests passed, 48 skipped; exit 0.

### Lap 2

#### 9. Build the catalogue works in the Docker sandbox

# Ticket 9 — Build the catalogue works in the Docker sandbox

## Reproduction (recorded before any code change)

Run in this burn sandbox (Linux, bun 1.4.2), on fresh `git clone`s of this branch, with `.runcastle/stories.json`'s command
`bunx storybook build -c .runcastle/storybook --stats-json --disable-telemetry --quiet -o <out>`:

- **Installed checkout** (the slot setup's install step, `bun install --frozen-lockfile`, run first): the build succeeds and writes index.json.
- **Uninstalled checkout** (no install step): `bunx` falls through to a remote fetch of `storybook@latest`, which then fails to load `@storybook/react-vite`. Same family (a fetched storybook, not the repo's), not the exact npx message.
- **Half-installed checkout** (install ran, but lightningcss's `lightningcss-linux-x64-gnu` package missing): exactly `Error: Cannot find module '../lightningcss.linux-x64-gnu.node'` with the require stack in `node_modules/.bun/lightningcss@1.32.0/.../lightningcss/node/index.js`.

So the human's log is the sign of the command running in a checkout the setup did not (fully) install. I could not reproduce the `npm warn exec` line itself: `bunx` here fetches with bun, not npx.

## Why a failed setup went unnoticed (hypothesis 1, confirmed by reading code)

`createSandbox` in `@ai-hero/sandcastle` 0.12.0 (dist/index.js ~1947 and ~2076) runs `hooks.sandbox.onSandboxReady` with plain `sandbox.exec`, which resolves with a non-zero `exitCode` instead of failing, and it ignores the hook's `timeoutMs`. (`run()`'s path, in the chunk, uses `execOk` plus the timeout; `createSandbox`'s does not.) So in `burnGateSandbox` a slot setup that failed at its fetch, stamp wipe or install was swallowed, and the stories command then ran in whatever the slot held. Every `burnGateSandbox` user (main build, base build, review gates) had this.

## What was done

- `burnGateSandbox` (review-gates.ts) no longer passes the setup as sandcastle's `onSandboxReady` hook. It opens the sandbox, then runs the same slot / isolated / mounted setup script itself through `runSandboxSetup`, which checks the setup's exit code and time limit. In a container it first sets `safe.directory '*'`; on the host it does not touch the global gitconfig. A non-zero exit or a timeout rejects with a new `SandboxSetupError` that carries the setup's stdout and stderr (or, on a timeout, whatever it streamed so far). Nothing then runs in that checkout, and the sandbox is torn down (a hung setup is killed the same way a hung command is).
- `errorDetail` moved into review-gates.ts and now writes a setup error's own output instead of a stack. stories-build.ts uses it, so main's build and the branch-point base build (`resolveBase`, which shares `burnGateSandbox`) end as `couldnt_run`. The reason reads "the sandbox could not be set up: the sync-and-install setup exited N", and the setup output goes in build.log. The gate run's `run.log` uses the same helper.
- The build command's working directory was already the installed checkout (slot repo / `/home/agent/repo`). It is now pinned by a test, along with the order (setup, then build).
- `burnGateSandbox` takes an optional `{ open, setupTimeoutMs }`, so tests fake only sandcastle's `createSandbox`. Tests: three in stories-build.test.ts at `buildCatalogueAt` (build cwd after setup, failed setup, hung setup) and one in main-catalogue.test.ts via `project.buildMapCatalogue` (attempt `couldnt_run` with the setup output in build.log). `computeStoryHistory` was not touched.
- `bun run typecheck`: clean. `env -u GIT_ASKPASS bun run test`: 364 files passed, 2 skipped, 0 failed.

## Surprises

- The swallowing affected the review gates as well: a failed install there showed up as failing verify commands. Those now come back as gate `couldnt_run` with the setup output in run.log.
- `createSandbox` ignores `timeoutMs` on hooks entirely; only sandcastle's `run()` path honours it. Burns use `run()`, so burns were not affected.

## Left undone

- I could not determine *why* the setup failed in the human's drive. That needs the real Docker run (decision 13's review click), and its build.log should now show the setup's own error. I could not reproduce the `npm warn exec` (npx) line either.
- `burn-cache-probe.ts` also calls `createSandbox`. I did not check whether it relies on hooks.
- Drive machinery: no new service, env var, seed or process, so no change was needed. Nothing was run.

#### 12. History is still saturated for ConflictCard and the Review page story (50 features each) because the feature-ui barrel is never counted as shared

# ticket(12) digest

**What was done.** I added a second "shared" rule for story history. A file is now also shared when it is a *hub*: at least 2 story files reach it, at least 3 modules import it directly, and no story file imports it directly (if one does, it is the component on show). The quarter rule (more than a quarter of stories, at least 3) is unchanged. `sharedStoryFiles` in `packages/core/src/map.ts` now takes each file's set of direct importers. In `main-catalogue.ts`, `computeStoryHistory` builds the import graph once in both directions. Each story's walk then stops at shared files, so whatever a barrel re-exports drops out with it. Under the old count-only rule, stopping there and deleting afterwards gave the same result. With the hub rule they differ. Tests: three new core unit cases and one server seam test, a fixture repo with a barrel that 2 of 8 stories reach. The spec's History section records the hub rule.

**Repro re-run.** I built main's catalogue at 1443843 for real (`bunx storybook build … --stats-json` in a detached scratch worktree) and ran `computeStoryHistory` over it against this repo:
- **Before the fix:** ConflictCard 50, Review 50, DependenciesRow 18. This matches the report exactly.
- **After the fix:** ConflictCard 9, Review 50, DependenciesRow 18.

ConflictCard's set is now its story, ConflictCard.tsx, use-resolve-conflict.ts and land-on-chat.ts. Each of the three source files has 3 first-parent commits; the review's "4" counted only the component and its story.

**Surprises.**
- **The Review page story still hits the cap of 50, and that is honest.** ReviewBody.tsx plus its story alone have 37 first-parent commits on main. The rest comes from review sub-components that only that page reaches. No `feature-ui` barrel module remains in its set except three single-purpose modules it reaches directly.
- **DependenciesRow's 18** comes from its own `lib/activity.ts` (10 commits, used only by it) and `test/fixtures.ts`. Those are real dependencies, not a barrel.
- **The first attempt failed an existing test.** It protected every direct import of a story, which broke "theme imported by every story is still left out". So the exemption is limited to the hub rule.

**Left undone.**
- **packages/core paths are not credited.** In the stats, packages/core modules show up as `../../<abs path>/packages/core/...` when core resolves through a symlinked node_modules (in my scratch worktree). If that also happens in the real sandbox, those modules never match git paths.
- **I did not press Build in a live UI.** The repro used a real Storybook build, but called the service function directly rather than going through the drive.
- **Drive machinery:** no changes needed. The ticket adds no service, env var, seed or process.

#### 13. Verify the fixes that landed

Drive verification pass of #11: the barrel fix (#12) holds, so history no longer credits a shared barrel's changes to the components behind it

**The fix that landed.** #12 adds a "hub" rule to story history. A file is now also left out when at least 2 stories reach it, at least 3 modules import it directly, and no story imports it directly. The walk also stops at shared files, so whatever a barrel re-exports drops out with it. The server's gates on 9900df7 both passed: `bun run typecheck` and `env -u GIT_ASKPASS bun run test`.

**How I checked it in the drive.** Runcastle's own project has no main catalogue in this drive's database. Re-running the original repro would mean pressing Build on runcastle, which the owner's instructions forbid, and decision 13's one sanctioned click went to ticket 11. So I rebuilt the same shape on runcastle-demo, the throwaway project:
- **The set-up:** a minimal Storybook with four stories in a Feed group, and a `web/lib` barrel. Two of the stories reach the barrel (EntryCard, FeedHeader) and three modules import it directly. Two stories out of four fails the old "at least 3" floor, which is exactly the case ConflictCard hit.
- **The history to read:** four `Merge branch 'feature/…'` merges on main. Two touch files the barrel re-exports, one touches EntryCard.tsx and one touches EntryMeta.tsx.

**What the drive showed.**
- **The build:** Build the catalogue went to "Building…" and then "Built from main · commit c51344e", in the Docker sandbox. No `runcastle/stories-main/*` branch was left behind.
- **EntryCard:** reads "Changed by entry-meta-date" with "2 earlier": entry-card-border and the set-up commit. Neither barrel tweak appears. Its non-shared sub-part, EntryMeta, is still credited, as it should be.
- **FeedHeader:** credits only the set-up commit, where the old rule would have added both barrel tweaks.
- **Badge and Empty:** credit only the set-up commit.
- **The frames:** render live, each with Open larger.

**What held.** #12 holds. A barrel that only two stories reach no longer leaks the changes it re-exports into their history.

**What I could not re-check.** ConflictCard's 50 → 9 on runcastle's own catalogue rests on ticket 12's own direct run against a real build. As that digest notes, the Review page story honestly stays at 50, from its own large history.

**Nothing plainly broken on the tour.** One small thing: agent-browser's text-click on the "2 earlier" summary did not expand it, but a DOM click did. That is likely the tool, not the app.

**Left in runcastle-demo, which is allowed:** commit ec3ecdf (the stories set-up, adding Storybook and React dev dependencies) and four merge commits on its main. The merged test branches were deleted.

The walkthrough is in walkthrough.webm, and a screenshot of the Feed group is in feed-group.png.

REVIEW-MODE: drive
REVIEW-VERDICT: verified
REVIEW-REASON: the hub rule verified on runcastle-demo's Feed group; runcastle's own catalogue was not rebuilt per the owner's rule
