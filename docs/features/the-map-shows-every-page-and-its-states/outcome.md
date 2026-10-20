# Outcome — The map shows every page and its states

The map stops showing components and shows the app as you navigate it: every page and each of its states, rendered whole with fake data and arranged by where it sits (Onboarding › 1 Welcome, Project chooser › Empty). Agents write the page stories once, in a mapping pass, and every ticket that changes a page keeps its stories current.

- Shipped: 2026-10-20
- Laps run: 1

## What shipped

23 commits · 145 files

### Lap 1
- 10 tickets landed: #1 Page stories render the whole app at an address, proven on Feature › Review; #2 The map model is pages and states, ordered as you move through the app; #3 The map draws whole pages: place pages, the structure overview, and page frames at review; #4 Onboarding is mapped: every first-run screen and its variants as page states; #7 Page rule: the page-stories guide reaches planning, burns, review and prepare; #9 Page stories: the app fills the viewport, so the sidebar shows; #10 Onboarding: scripted steps wait for each screen, and a failed step shows itself; #12 Web: remove the Map and the UI states section from the app; #13 Repo: take Storybook out of runcastle's own repo, keep the fake-data helpers; #14 Server: remove the map, the story catalogue pipeline and stories from prompts and prepare
- 1 waived: #5 The page rule and the page-stories guide reach planning, burns, review and prepare
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: unknown
- Landed since: 6
- Outcome: cancelled

### Lap 1 · review

- Reviewed commit: d5ac8646c54a0a19bc41b4d54de2d138ac98eb58
- Landed since: 5
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 3ab200b451fea70075926eede63b9c05bf07eb8c
- Landed since: 3
- Outcome: done

### Lap 1 · review

- Reviewed commit: f22220a2d949b60e511b728863707f3f27afdf44
- Landed since: 0
- Outcome: done

- **Scenario listing and the drive's API view could not be checked in the app: runcastle has no scenario runner recorded** — open
- **The criteria held in the drive: no Map, no UI states, no Stories port, /map lands in the project, and the repo grep is clean** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 2. The map model is pages and states, ordered as you move through the app

## What was done
- Core: `isPageStory` / `PAGE_STORIES_DIR` in `stories.ts`; `groupMap` now keeps only page stories, groups by title folded to two levels (deeper segments prefix the state name with ` · `), gives states a `step`, sorts by step then index order (variants after their step, unnumbered last), and orders places by smallest story-file path (numeric `localeCompare`), children after parents, then scenario-only groups, Ungrouped last. A parent with no pages of its own is placed by its children. Schemas: `MapComponent` replaced by `MapState`/`MapPage`; `MapGroup.pages`.
- Server: `mapModel` fills pages with frame URLs; `computeStoryHistory` takes page stories out of the import walk and shared-file cut, so their history is the story file alone (new test). New `mappedPlaces` in `services/map.ts`; `stories.pages` (`string[] | null`) in `featureStories` and the tool description. `UiStatesStory.page` set by path.
- Web: only enough to compile — `PageBlock` replaces `ComponentBlock` (block title is the story file's name), `mapTally` counts states, fixtures/stories use `pages`.
- Tests updated/added in core, server (map, main-catalogue, mcp-tools, ui-states-router) and web. Typecheck clean; full suite green (364 files passed).

## Surprises
- `ClassifiedStory` (persisted manifest) is untouched; `page` is computed in the ui-states model, not stored.
- Two old main-catalogue tests asserted component stories on the map; they now assert the map is empty / dropped the map-side history check (storyHistory record is still asserted).
- `mappedPlaces` reuses `groupMap` with no scenarios, so it never lists scenario-only groups.

## Left undone
- Page-frame variant, map overview/group page redesign (ticket 3), skill/prompt text for the page rule.
- Existing web test fixtures keep `page: false`; no web test yet for page stories at review.
- Drive machinery untouched (no new service/env/seed).

#### 3. The map draws whole pages: place pages, the structure overview, and page frames at review

# Ticket 3 — the map draws whole pages

## What was done
- `StoryFrame` gained a `page` prop. A page frame puts the page in a 16:10 box at 1440 × 900 and scales it to the box's width with a ResizeObserver. The iframe has `pointer-events: none`, and a transparent button over the box opens it. Frames load once they scroll into view (`useVisible`, now shared with the old `WhenVisible`). A module-level queue lets at most 3 load at once, and each frame gives its turn back on `load` or on unmount. `themedFrameUrl` appends `globals=theme:<dark|light>` from `useTheme().resolved`. `StoryLargerDialog` themes the URL too when `LargerStory.page` is set. An optional `openLabel` names the click; the overview uses it as "Open <place>".
- `MapGroupPage` shows each page's "Stories updated by …" history line, then step chips (`nav[aria-label=Steps]`, one per numbered step, which scroll to a `map-step-<id>` anchor). Then it shows each state as a captioned `figure`, one per row, with a step's variants inside the same step block. After that, each child place gets a `PageSection` with an "Open" button, showing its pages or else its tally. Ways in and Calls are unchanged. The old "Groups" fallback list is gone.
- `lib/map.ts` changes: `mapSteps` groups states into steps, and `historyWords('stories')` gives the page wording. The tally now reads "N states" instead of "N UI states", following the spec and the mockup. `mapGap` became `mapGaps` (an array) with a new `no-pages` gap, "No pages on the map yet". It shows when stories are set up, the catalogue is built, and no group has pages. It has no door; the door comes in lap 2.
- `MapOverview` replaces `GroupRows` with a tree of places: a small page frame of the first state (an empty 16:10 box when a place has no pages), then a `ListRow` with the name and tally. Children are indented.
- In `UiStatesSection`, page stories use the page frame for Before and This feature. Among the far matches, a page story becomes a page frame inside the disclosure, and component rows are unchanged.
- Tests: a new `story-frame-dom.test.tsx` covers scale, the queue, the theme and the click. The map and UI-states tests were updated and extended, and an `onboardingGroup` fixture was added. Map component stories were added: `AFlowOfSteps`, `ChildPlaces` and `NoPages`. Typecheck is clean and the full suite is green (365 files).

## Surprises
- The post-commit sync push was rejected as "stale info": the clone had a remote-tracking ref for a branch that did not exist in the mirror. I pushed by hand with a lease that expects no branch, then reset the tracking ref.
- In happy-dom, `about:blank#…` iframes never fire `load` on their own, so tests can drive the queue with `fireEvent.load`.

## Left undone
- `apps/web/STYLE.md`'s Stories line on page stories, and the skill and prompt text for the page rule, belong to other tickets.
- The drive machinery is untouched because no service, env var, seed or process was added.

#### 4. Onboarding is mapped: every first-run screen and its variants as page states

# Ticket 4: Onboarding is mapped

**What was done.** I added `.runcastle/stories/pages/1-onboarding/Onboarding.stories.tsx`. It has the title `Onboarding`, uses `layout: 'fullscreen'` and renders `<AppAt path="/">` with `withShell` fakes. The host has no projects and no git identity, so `/` lands on the wizard. It holds seven states: `1 Welcome` (no step), `2 Git identity`, `3 Coding agents` (Claude Code installed but not signed in, Codex missing), `3 Coding agents · None installed`, `3 Coding agents · Claude Code signed in`, `4 AFK burns` and `5 First project`. The doctor fakes are built from small helpers in the file (`binary`, `login`, `host`), and the probe ids, labels and install fixes match `doctor.ts`'s `RUNTIME_SPECS`. Every state after Welcome has a `play` step that clicks through the wizard like a user: Set up runcastle, type a name and email, Continue, Continue, Skip for now. Each step asserts the screen's heading. The three Coding agents states also assert each card's status and whether Continue is enabled.

**Deviation: one write is answered.** The ticket said never to script a step that needs a mutation. But steps 3–5 cannot be reached without one. IdentityStep only moves on when `setup.gitIdentity` succeeds. The only other way in is a host whose identity is already ok, and then the Claude-signed-in case counts as fully set up, so the app never shows the wizard. The doctor is also never refetched without a write (staleTime is Infinity and there is no doctor poll). So I changed `fake-api.ts`: a story may now answer a mutation it names, and every unanswered mutation is still refused with the same message. The Onboarding stories answer `setup.gitIdentity` and nothing else. No apps/web code was changed and no module was mocked.

**Verified.**
- `bun run typecheck` passes, including the stories tsconfig.
- The full test suite passes: 364 files, 5142 tests, 0 failed.
- The catalogue build's `index.json` lists all seven states under `Onboarding`, with importPath `./.runcastle/stories/pages/1-onboarding/Onboarding.stories.tsx`.
- **The play steps were not checked in a real browser, because the sandbox has none.** Instead, a throwaway happy-dom vitest ran each story's play step through `composeStories` with the real preview. All seven passed, each landed on the expected heading, and no query hit an unfaked procedure. I deleted that test afterwards.

**Surprises.** In setup view the wizard sits in the app frame with no sidebar, so these pages show no sidebar or topbar body. That is how the app draws it. The Skip for now step fires `setup.seedModelDefaults`, which is refused silently and still moves to step 5.

**Left undone.**
- No variant for an identity the host already has (the rail's "passed" row). That probe result does change the rail, so lap 2 could add it as `3 Coding agents · Identity detected`.
- No state for AFK's "Set up now" checklist, which needs container and image probes.
- No drive machinery change was needed, because this ticket adds no service, env var, seed or process.

#### 10. Onboarding: scripted steps wait for each screen, and a failed step shows itself

# Ticket 10 — Onboarding: scripted steps wait for each screen, and a failed step shows itself

**What was done**
- `.runcastle/stories/pages/1-onboarding/Onboarding.stories.tsx`: every step now waits for its screen. `onScreen` runs `waitFor(() => expect(heading).toBeVisible(), { timeout: 15000 })`. `press` finds the button (15s), waits for it to be enabled, then clicks. Typing goes through `userEvent.setup({ delay: null })`, so there is no per-key timer. The seven state names and their end assertions are unchanged.
- New `.runcastle/storybook/fail-loudly.ts`: `failLoudly(play)` wraps a play. On any error it appends a fixed, full-width red banner (`role="alert"`, `data-failed-step`) reading "This state's scripted step failed: <message>", then rethrows. Its doc comment tells lap-2 page stories to use it. Every Onboarding play is wrapped.
- Verified with a throwaway happy-dom vitest (`composeStories` plus the real `preview.tsx`, then deleted): all 7 states landed on their own heading with no banner. A failing play rethrew and showed the exact banner text. A composed story whose assertion fails showed the banner. `bun run typecheck` passed. The full suite passed: 365 files, 5160 tests, 0 failed (the prompt's baseline counts are out of date). The catalogue build passed, and its `index.json` lists all seven `onboarding--*` ids.

**Surprises**
- The app's only reduced-motion switch is the `prefers-reduced-motion` media query in `theme.css`. A story cannot turn that on from inside the page, so the plays just wait.
- happy-dom runs no CSS animations, so the throwaway test cannot reproduce the mid-transition `opacity: 0` failure. It only proves the steps and the banner.

**Repro step:** I could not re-run it. The sandbox has no headless browser (no chromium or playwright), so I could not open the map frames or `onboarding--first-project` and `onboarding--afk-burns` directly. They need checking in the drive.

**Left undone:** If a map frame stays off screen and the browser freezes its animation timeline for more than 15s, a step can still time out. It now shows the banner rather than a wrong screen. Finishing the step's animations through the Web Animations API would remove that case, but the ticket said to wait, so I didn't add it. No drive machinery changed, and I did not touch `app-at.tsx`, `preview.tsx` or `apps/web`.

#### 11. Review: verify page stories show the sidebar and Onboarding lands on every step

Drive verification pass — run in Drive mode over the inherited Gates, because every acceptance criterion names a screen a human operates (Map › Feature › Review, Map › Onboarding, the stories port), and both fix burns said they could not check layout without a browser, which is what a drive gives.

## How it ran

- Booted `feature/the-map-shows-every-page-and-its-states` at `3ab200b` with `review_drive` (dev at :22121, stories port at :22122). The recording is `walkthrough.webm`.
- `review_drive scenario` refused with `no-runner`. This project records no scenario runner, so I ran 'Map of this checkout' by hand, the way its header says (`bun .runcastle/scenarios/map/map-of-this-checkout.ts`, with the `.runcastle/drive.env` overlay and `RUNCASTLE_BRANCH`). It reported `built: at 3ab200b` against the drive's own data dir (`~/.runcastle-drive-…`). I pressed nothing on runcastle's real project.
- The server's gates at `3ab200b` were both green: `bun run typecheck` passed, and `bun run test` passed.

## Fixes

**1. "Page stories render without the sidebar" (ticket 9): held.**
- **Map › Feature › Review › Findings open:** the frame shows the full sidebar beside the topbar and findings:
  - Search;
  - Project;
  - Inbox 1 · Coupon codes;
  - Work | Map;
  - Re-prepare project;
  - the foot.

  The whole 1440 × 900 page fits the frame and is not cut off.
- **Open larger:** the dialog shows the same page with its sidebar.
- **Directly at the stories port** (`/main/<project>/iframe.html?id=feature-review--findings-open`): the sidebar shows, and `#storybook-root` and the `AppAt` wrapper both measure the full viewport height.

**2. "Onboarding 4 AFK burns and 5 First project show earlier wizard screens" (ticket 10): held.**
- **Map › Onboarding:** I scrolled to the bottom and waited. All seven rows show their own screen:
  - 1 Welcome: the pipeline intro;
  - 2 Git identity;
  - 3 Coding agents, with Claude Code not signed in;
  - 3 · None installed;
  - 3 · Claude Code signed in, where Continue is enabled;
  - 4 AFK burns: "Run burns unattended?";
  - 5 First project: "Open your first project".
- **`onboarding--afk-burns` and `onboarding--first-project` opened directly:** each lands on its own screen. Neither shows the `[data-failed-step]` banner or Storybook's error display.

## Other findings from the tour

Nothing plainly broken. One low observation was filed: in page stories the expected "Connecting" label in the sidebar foot pushes the Settings gear partly off the sidebar's edge. It is cosmetic and not a regression from these fixes.

The known items appeared exactly as the ticket listed them, and none is a defect:
- the separate top-level "Review" scenario group;
- the onboarding wizard without a sidebar;
- the "Connecting" live dot.

REVIEW-MODE: drive
REVIEW-VERDICT: verified
REVIEW-REASON: both lap-1 defects fixed in the drive; all four acceptance criteria hold

#### 12. Web: remove the Map and the UI states section from the app

# Ticket 12 — Web: remove the Map and the UI states section

**What was done.** Removed the map and the "UI states" section from `apps/web`, following `removal-inventory.md` areas 1 and 3:
- **Deleted:** `components/map/`, `lib/map.ts`, `lib/sidebar-mode.ts`, `UiStatesSection.tsx` and `StoryFrame.tsx`.
- **Sidebar:** always shows the pinned Inbox and then the Work lanes. `SidebarLanes` keeps only `InboxLane` and `WorkLanes`.
- **Routes and workspace:** the `'map'` location, view and state are gone, along with `openMap`.
- **Drive request:** `ProjectWorkspace`'s request is back to its pre-map shape, a number that `ProjectShell` increments. It only brings the drive to the front.
- **Drive doors:** `DriveFocus`, `ApiView`'s `preselected` prop, `UiStatesModel`, the `storiesPort` setting and the `uiStates` / `project.map` invalidations are gone.
- **Tests:** `sidebar-map.test.tsx` was renamed `sidebar-inbox.test.tsx` and keeps the Inbox tests, plus one check that there is no Map tab or tree. Every other test file the inventory lists was deleted or trimmed. The map-intent describe in `project-drive-workspace.test.tsx` was replaced by a single test for the titlebar pill, and `routes.test.ts` gained a check that `/p/<id>/map` now reads as unknown.

**Deviation.** I deleted three files outside `apps/web`: `.runcastle/stories/map/Overview.stories.tsx`, `GroupPage.stories.tsx` and `sidebar/InboxAndSwitch.stories.tsx`. They import the deleted web components, and `bun run typecheck` checks `.runcastle/stories`, so keeping them would have failed the typecheck. The spec deletes every story anyway.

**Surprises.** The server still sends a `storiesPort` setting. Until the server ticket removes its descriptor, the Settings page will show it as a plain field labelled `storiesPort`, because the web app no longer has a label for it.

**Left undone (other tickets' work).**
- Server and core: `project.map`, `feature.uiStates`, the `storiesPort` descriptor, `runScenario` / `openScenarioChat` (still used by `ScenarioDrive`).
- `.runcastle/storybook/`, the remaining stories (the `Review` page story still fakes `uiStates`), and `drive-setup.ts`'s stories port.
- `IconList` in `icons.tsx` is now unused (optional in the inventory).

**Drive machinery.** No change needed, because this ticket adds no service, env var, seed or process. I did not touch or run the drive scripts.

**Verified.** `bun run typecheck` passes. `env -u GIT_ASKPASS bun run test` passes: 360 files passed and 2 skipped; 5078 tests passed and 48 skipped.

#### 14. Server: remove the map, the story catalogue pipeline and stories from prompts and prepare

# Ticket 14 — Server: remove the map, the story catalogue pipeline and stories from prompts and prepare

**What was done.** Followed `removal-inventory.md` areas 1–4 for core, server, the skill pack, scenarios and drive-setup.
- **Core and server deletions:** core `map.ts` and `stories.ts`; server `services/map.ts`, `main-catalogue.ts`, `stories-store.ts`, `ui-states.ts`, `workflows/stories-build.ts` and `routes/stories-static.ts`, with their tests.
- **Routers:** `project.map`, `project.buildMapCatalogue` and `feature.uiStates` are gone.
- **Boot and settings:** the stories port listener is gone, and so are `storiesPort` / `RUNCASTLE_STORIES_PORT` in config, config-load and settings.
- **Core cleanup:** the catalogue paths and `PROJECT_ID_PATTERN` are removed.
- **Merge and delete:** promotion and story cleanup are gone from both. `git.fileExistsAt` and `repo.setFeatureBranches` are removed because nothing calls them any more. `web.ts` helpers are un-exported.
- **Gate sandbox:** lost `outDir`/`outPath`, `GateSandboxStep` and `afterCommands`. `runSandboxSetup` and `SandboxSetupError` are kept.
- **Review workflow:** `runBranchGates` is restored to its pre-stories shape (resolve the tip, run the gates). `STORIES_NOTES`, `buildStoriesNotes`, the page rule and `planStories` are gone.
- **Database:** `tickets.stories_build` is dropped by the generated `drizzle/0050_tan_manta.sql`; 0048 is untouched. The new `stories-build-drop-migration.test.ts` covers a fresh database and a populated one.
- **MCP:** `get_feature_context` has no `stories` or `mapGroups`, and a test asserts it.
- **Scenario brief:** the "Groups already on the map" block is gone.
- **Prepare:** the prepare brief, launcher, edit guard (`isPackageManifest`) and `PREPARE_BASH_WRITE_RULES` no longer mention stories. Prepare now gets the plain host-session git rules. `LOCKFILES` stays, with a trimmed doc.
- **Skills and templates:** the prepare/tickets/revisit skills, `implement-ticket.md`, `review-ticket.md` and `verify-fixes.md` no longer mention stories. The prepare `references/stories.md` and `page-stories.md` are deleted.
- **Scenarios:** the map and UI-states scenarios and `_fixtures/ui-states.ts` are deleted. `feature-at-review.ts` and its `.http` are back under `scenarios/review/`, with imports re-pathed and the `.http` comment reworded. The three tests that name the paths follow.
- **Drive-setup:** `drive-setup.ts` is back to its pre-stories form (one port, no `RUNCASTLE_STORIES_PORT`).

**Deviations.**
- `.runcastle/preview/shell-fakes.ts` (ticket 13's file) still faked `project.map`, which broke the preview typecheck once the router lost it. I removed that fake.
- I removed `apps/web/STYLE.md`'s "## Stories" section (inventory area 4), which nobody had done and which pointed at deleted files.

**Surprises.** drizzle named the migration 0050, not 0049, because the journal's indexes were already one ahead of the file numbers (there are two 0046 files). That is harmless: the runner reads files in order.

**Left undone.** Some web test comments still mention the Map or UI states (`sidebar-lanes.test.ts:9`, `preview-placement.test.ts:67`; ticket 12's area). `IconList` in `icons.tsx` may be unused. `~/.runcastle/stories/` is left on disk, as the spec says.

**Verified.**
- `bun run typecheck` passes.
- `env -u GIT_ASKPASS bun run test` passes: 351 files passed and 2 skipped; 4914 tests passed and 48 skipped. That run came before the second commit, which only removed a STYLE.md section and an unused type import; typecheck and `review-gates.test.ts` were re-run after it.
- **Drive machinery:** `drive-setup.ts` and the moved scenario both parse with `bun build`. No new env var, service or seed is needed, and I did not run either script.
