# Outcome — Drive scenarios

A test drive lands you in the state you want to test, already signed in, instead of on a blank app. A scenario is a project command that seeds the state and returns an entry URL. Scenarios are picked at Test drive, created from a visible New scenario chat, and shipped by features when the agent judges the state hard to reach.

- Shipped: 2026-10-17
- Laps run: 2

## What shipped

46 commits · 82 files

### Lap 1
- 7 tickets landed: #1 Scenario runner, discovery and drive integration; #2 The scenario session: launch, briefing, guard and run_scenario; #3 Scenario picker, Scenario menu, failure panel and docked chat; #4 Runcastle's dogfood scenario: Feature at review; #6 Test gate red: pty-teardown deadline test measures a 5s timer with Date.now and read 3476ms; #7 A scenario the chat just created is missing from the Scenario menu until a page reload; #8 Fix it reopens the live scenario chat without telling it about the failure
- 0 waived
- 0 failed

### Lap 2
- 9 tickets landed: #10 API calls: TOKEN, .http requests, and sending a call over the live drive; #11 Scenario replay for review agents; get_feature_context reports scenarios; #12 Web: API view with Try it, the Blank app nudge, and the dock header's errand; #13 Prompts and skills: .http and TOKEN in the scenario chat, features ship scenarios, prepare's drive.env rule; #15 Test gate red at 17de078: merge-conflict.test.ts failed because the clock stepped back 13ms between two events (not caused by this lap's code); #16 A .http call file that opens with a "### Name" line, the usual REST Client/JetBrains layout, is rejected as "no request line"; Try it never offers that call; #17 An unknown or unfilled placeholder in a .http path is shown percent-encoded (%7B%7Bfoo%7D%7D), not left as written; #18 Try it with the URL field cleared raises a request-validation toast instead of showing an error result in the response area; #19 "List a feature's scenarios" is written three times with different runner and base-branch rules
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 1dc6fc9376c3e8c86f015b56f7e6cea0afd7a662
- Landed since: 12
- Outcome: done

### Lap 1 · verification

- Reviewed commit: dcfc9e0eee9f05122ff54eb8fa88d0ce246418ed
- Landed since: 9
- Outcome: done

### Lap 2 · review

- Reviewed commit: 17de078925a2b07948e391278227ebf391cfb730
- Landed since: 5
- Outcome: done

### Lap 2 · verification

- Reviewed commit: f10c100711aff0e8ef25d43b7c4ffc2173d1dd65
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Scenario runner, discovery and drive integration

# Ticket 1 — Scenario runner, discovery and drive integration

**What was done.**
- **Host setting.** `scenarioRunner` is a project-only host setting end to end: core `Project`, the db column, migration `0046_project_scenario_runner.sql`, `rowToProject`, the settings descriptor and `projectOverrides`, and web FIELD_META (it sits right after "After a test drive"). The placeholder is `e.g. bun {file}` to match the `e.g.` convention of the other command fields.
- **Wire types.** `ScenarioEntry`, `DriveScenario`, `ScenarioFailure` and `ScenarioFailureReason` are zod schemas in `@runcastle/core`.
- **Scenario service.** New `services/scenarios.ts` with `listScenarios` (git ls-tree; own detection via `base...ref` diff) and `runScenario`.
- **Hook runner.** `runDriveHook` gained `onData(chunk, stream)` and a full `stdout` field.
- **Drive integration (git.ts).**
  - `testDrive` (human only) and `projectDrive` take `opts.scenario`. The scenario runs from `watchAppReadiness` once the app answers.
  - The drive state keeps `envOverlay`, the parsed `drive.env` values.
  - `DriveInfo` carries `scenario` and `scenarioSessionId`.
  - `runScenarioOnDrive`, `attachScenarioSession` and `listDriveScenarios` are exported.
  - Events `scenario.started`, `scenario.landed` and `scenario.failed` are emitted at the drive's scope.
- **tRPC.** `feature.driveScenarios`, `feature.runScenario` (fire and forget), `feature.openScenarioChat`, and a `scenario` input on `feature.testDrive` and `project.testDrive`. `launchScenarioSession` is a stub in launcher.ts that throws `NotImplementedError('scenario session')`.

**Deviations, for tickets 2 and 3.**
- **Run id.** `runScenario` itself adds a fresh `RUNCASTLE_SCENARIO_RUN` on every run, so callers do not.
- **Sync start half.** `runScenarioOnDrive` is split, and there is also a synchronous `startScenarioOnDrive(ctx, projectId, file)`. It returns `{ok:false, denied}` or `{ok:true, result: Promise}`. The fire-and-forget mutation uses it so it can still report a refusal. Ticket 2's MCP `run_scenario` can just await `runScenarioOnDrive`.
- **Path guard (added).** A file that is not under `.runcastle/scenarios/`, or that contains `..` or quotes, is refused before it reaches the shell.
- **Listing excludes dot-files.** Dot-files such as `.gitkeep` are not listed, the same as `_` names.

**Surprises.**
- `runDriveHook` already tails the combined output to 40 lines, so the live output and the failure tail both reuse `tailLines`.
- Live output changes do not emit events. Only status changes do, as the ticket specified. So while a run is in progress, the UI sees output only as fast as it polls `driveInfo`.

**Left undone.**
- A scenario process still running when the drive stops is not killed. Its result is discarded.
- A scenario pending at start never runs if the readiness poll times out.
- `listDriveScenarios` still lists scenarios for a bare drive (no dev command). The UI should hide them using `devConfigured`.
- No drive machinery changed (no new service, env var, seed or process), so the `.runcastle/` drive scripts needed no edit.

**Verification.** `bun run typecheck` is clean. The full `env -u GIT_ASKPASS bun run test` passed: 330 files, 4730 tests, 0 failed. It ran before the final small path-guard commit; after that commit, its two test files and the typecheck were re-run green.

#### 2. The scenario session: launch, briefing, guard and run_scenario

# Ticket 2 — The scenario session

**What was done.**
- **Kind and purpose.** `SessionKind` gained `scenario` and `SessionPurpose` gained `scenario-setup`. The kind is NOT in `PROJECT_SESSION_KINDS`; its scope comes from `session.featureId`.
- **Exhaustive switches.** These handle the new kind: entry skills (none), the kickoff line, the hooks-route noun ("scenario chat"), and web `sessionKindName` ("Scenario"). `launchSession` refuses it.
- **Callers audited.** The hooks route already branches on `!session.featureId`, and `emitForSession` already picks the scope from the row. The MCP `isProjectSessionKind` caller (`createFeatureProject`) refuses the kind correctly.
- **Launch.** `launchScenarioSession(ctx, input, opts?)` replaced the stub. It gained an optional third `opts` argument (`spawn: false` for tests); the tRPC call is unchanged.
  - It refuses unless a human feature drive or a project drive is live with `devReady`.
  - It reopens the drive's live `scenarioSessionId`.
  - Otherwise it creates a row scoped to the drive, in `project.repoPath`, with the purpose `scenario-setup` when `.runcastle/scenarios/` is absent.
  - It uses the `prepare` model step, always starts a fresh conversation, attaches to the drive, and emits `scenario.chat_opened` (plus `session.launching` and `session.kickoff`) at the drive's scope.
- **Feature terminal rule.** `assertSpawnable` now ignores `scenario` sessions, so a scenario chat never blocks the feature's own terminal and is never blocked by it.
- **Briefing.** `ScenarioBrief` and `renderScenarioPrompt` are in artifacts.ts, wired through `WriteArtifactsInput.scenario`.
  - Two new helpers feed it: `git.scenarioDriveEnv(ctx, projectId)` (identity plus the `drive.env` values; server-only, so `driveInfo` still carries no values) and `listScenarioPaths(repoPath, ref)` in scenarios.ts.
  - `startScenarioOnDrive` was refactored to share `scenarioDriveScope`.
- **Edit guard.** In setup mode the session may write anywhere in the checkout; otherwise only `.runcastle/` (`SCENARIO_WRITABLE`). `.gitignore` is deliberately excluded.
- **Settings.** `scenario` joined `HOST_SIDE_KINDS`. `sessionBashAllowRules` now takes the purpose, and setup mode gets a blanket `Bash(git add:*)`. Commits still prompt the human, as for every host-side kind.
- **MCP.** `run_scenario` and `set_scenario_runner` are offered to the `scenario` audience only, alongside `record_event`.
  - `run_scenario` refuses unless the live drive's `scenarioSessionId` is this session. That is stricter than matching the scope: a restarted drive of the same feature is not "this session's drive".
  - `set_scenario_runner` requires `{file}` and writes through `updateSettings`.

**Surprises.**
- `launch-artifacts.test.ts` asserted that no purpose other than `orchestrate` changes settings. It now skips the deliberate `scenario`/`scenario-setup` pair.
- Ticket 1's placeholder test expected NotImplemented. It now expects the no-drive refusal.
- `schemas.test.ts` pins the full `SessionKind` options list.
- Full suite: one failure on the first run, that pinned list. Fixed and re-run in isolation, not as a second full run. Typecheck is clean.

**Left undone.**
- No web UI. Ticket 3 owns docking the chat, ＋ New scenario and Fix it.
- `updateSettings` stamps the runner with human provenance. It is not a prepared key, so nothing reads that stamp today.
- A scenario session still live when its drive stops stays open; its `run_scenario` calls are then refused.
- No drive machinery changed (no new service, env var, seed or process), so `.runcastle/` scripts needed no edit.

#### 3. Scenario picker, Scenario menu, failure panel and docked chat

# Ticket 3 — Scenario picker, Scenario menu, failure panel and docked chat

**What was done**
- **SplitButton** (`apps/web/src/ui/split-button.tsx`, exported from `ui.tsx`, row in STYLE.md). It is a Button plus a caret that opens a DropdownMenu. `Button` gained an `attached` prop (`none` · `start` · `end`) so each half rounds only its outer corners, which avoids a caller writing `rounded-r-none`. `rounded-md` moved out of `BUTTON_BASE` into that lookup.
- **Shared scenario list.** `lib/feature-ui/scenarios.ts` holds pure helpers:
  - `scenarioMenu` gives the sections: own in path order, then others by group with ungrouped last, then Blank app. On a project drive the second heading is "Scenarios". With no runner, only Blank app is listed.
  - `testDriveLabel`, `scenarioTarget` (entry URL plus landingId as the frame key) and `scenarioFailureLine`.
  - `components/review/ScenarioMenuItems.tsx` renders the rows.
- **Feature next step.** I did not add a marker to NextAction. `NextStepBar` instead takes a `split` prop keyed by action kind, and Workspace passes it for `testDriveStart`. Workspace queries `driveScenarios` at review. `startDrive(file|null)` sends `scenario`, and the main click uses the first own scenario.
- **Deviation:** with no own scenario the label stays the resolver's "Start test drive", not "Test drive", so the ~20 resolver tests stay untouched.
- **Project.** TestDriveCard's ready state is a SplitButton whose main click is Blank app. `useProjectDrive.start(scenario, onStarted)` changed signature (its only caller is ProjectWorkspace). Scenarios are hidden when the project has no dev command.
- **Running drive.** The new `ScenarioDrive` is used by EvidenceStage's human-drive default case (only with the new `projectId` prop and not readonly) and by ProjectDriveView.
  - `DrivePanel` gained `frameKey` (iframe key) and a `toolbar` slot; the Scenario menu lives there.
  - It also shows the running strip, the failure strip with Fix it, and the dock (TerminalView in an ErrorBoundary, header "New scenario · Describe the state you want to land in"). The dock stacks below `md`; close only hides it, and it closes when the session ends. Blank app sends the panel back to devUrl until the next landing.

**Surprises**
- Several existing tier-2 tests mock `trpc` per procedure, so the new queries and mutations had to be added to the mocks in project-drive-workspace, project-triage-launch and stage-expand.
- Live scenario output only refreshes at the driveInfo poll rate, because the server emits no event per output chunk (ticket 1's note).

**Left undone**
- A feature drive's start picker does not hide scenarios for a bare project (no dev command). Workspace has no project row at hand. The running menu cannot appear on a bare drive anyway, since there is no URL.
- The "Blank app" nudge is a later lap. No server or `session.ts` files were touched. No drive machinery changed.

**Verify:** `bun run typecheck` is clean. `env -u GIT_ASKPASS bun run test`: 334 files passed, 4761 tests, 0 failed.

#### 4. Runcastle's dogfood scenario: Feature at review

# Ticket 4 — Runcastle's dogfood scenario: Feature at review

## What was done
- Added `.runcastle/scenarios/review/feature-at-review.ts`, a Bun script for `bun {file}`. It refuses to run unless `RUNCASTLE_DATA_DIR` is set and is a `.runcastle-drive-*` dir, so the real `~/.runcastle` is refused. It then opens `dbPath()` with `createDb` and `runMigrations`. It finds the open project named `runcastle-demo`, by name or by repoPath basename (`SCENARIO_PROJECT` overrides the name). It calls `createFeature` with the title `Scenario feature <RUNCASTLE_SCENARIO_RUN or random hex>`, which cuts a real `feature/scenario-feature-<run>` branch and scaffolds docs through a talk worktree in the drive data dir. It stores 2 tickets, marks them done, and calls `setPhase(..., 'review')`. Finally it prints one `ENTRY_URL=/p/<projectId>/f/<slug>` line. Any error goes to stderr with a `[feature-at-review]` prefix and exit 1. The db is closed at the end so the WAL is checkpointed.
- I pulled the drive-dir naming rule out into `.runcastle/drive-dir.ts` (`DRIVE_PREFIX`, `isDriveDataDir`). `drive-stop.ts`, `drive-setup.ts` and the scenario now all import it instead of keeping copies of the prefix.
- `scripts/tsconfig.json` now includes `../.runcastle/**/*.ts`. A plain `"../.runcastle"` entry would have checked nothing, because tsc's wildcards skip dot-folders. The drive scripts typechecked clean.
- Added `packages/server/test/dogfood-scenario.test.ts` with 3 tests: the happy path, an unregistered project, and a refusal of the real data dir. The temp repo is named `runcastle-demo`, so the default lookup is what gets tested.

## Surprises
- Vitest runs under node, and node cannot open `bun:sqlite`. So the test writes the drive db file with sql.js (`openProject`, then `export()`), runs the scenario as a bun child, and reads the file back with sql.js. Reading it back depends on the scenario closing its db.

## Left undone
- Recording the `bun {file}` runner host setting has to wait until after merge, as the spec says.
- I did not run drive-setup or drive-stop. They only gained an import, and the typecheck covers them. This ticket adds no new drive infrastructure.

#### 9. Verify the fixes that landed

Drive verification pass — verifies pass #5 · all three landed fixes held

I drove the inner runcastle (the feature/drive-scenarios build, at dcfc9e0) on runcastle-demo: a project drive of `main`, recorded in `walkthrough.webm`. Screenshots 01–14 sit beside it.

**Gates (the server's run at dcfc9e0).** `bun run typecheck` passed. `env -u GIT_ASKPASS bun run test` passed: 335 files passed, 2 skipped; 4779 tests passed, 48 skipped, 0 failed. The test gate that was red in pass #5 is green now.

**#6 pty-teardown deadline test: held.** The diff changes exactly the two `Date.now()` calls in `tearDownEntry › returns within the deadline even when killTree never settles` to `performance.now()`, a monotonic clock like the timer it measures, and adds a comment. No production code changed. The full suite is green on the gate.

**#7 New scenario missing from the Scenario menu until a reload: held.** I walked the repro with a new scenario.
- With no runner set, the project Test drive picker offered only Blank app (02). I recorded `bun {file}` as the Scenario runner in settings. Without a reload, the picker then listed Broken and Home under Smoke, then Blank app (03), so the `settings.updated` path refreshes the list too.
- I started a Blank app drive and opened ＋ New scenario. The chat docked beside the panel (05). I asked: "this is a test — make a scenario named smoke/feed that seeds nothing and lands on /". The chat committed `9c9283c runcastle: scenario smoke/feed` on main and landed through `run_scenario`, and the panel read "Scenario: Feed" (08).
- With no reload, the Scenario menu listed Broken, **Feed**, Home (all under Smoke), Blank app and ＋ New scenario (09).

**#8 Fix it with a live scenario chat: held.** With that chat still open, I picked Broken. The red strip read `Scenario "Broken" failed: exit 1`, with its output `broken scenario: seeding failed on purpose` and a Fix it button (10). I clicked Fix it, and the same docked chat received the ask in its terminal (11):
- the file, `.runcastle/scenarios/smoke/broken.ts`;
- "It exited 1";
- the output tail;
- the instruction to repair, commit and land with `run_scenario`.

The agent then repaired the file, committed `eacebd6 runcastle: fix smoke/broken to seed an entry and land on the feed`, and landed it. The failure strip cleared, and the feed showed the unique-per-run entry "Smoke entry 58a2fd" (13). I stopped the inner drive cleanly (14).

**Plainly broken on the tour:** nothing. One small thing seen in passing, not pursued and not filed: the drive header kept showing `@ 15f3d73` after the chat had committed two newer commits on the driven `main`. It may simply be the SHA the drive started at.

**Side effects:**
- runcastle-demo's `main` gained two throwaway commits from this walk (smoke/feed, and the repaired smoke/broken). smoke/broken no longer fails, so a later Fix it check needs a new failing scenario.
- The inner instance's dev command and runner settings lived only in the review drive's data dir.

REVIEW-MODE: drive
REVIEW-VERDICT: verified
REVIEW-REASON: all three landed fixes held on the tour and both gates are green at dcfc9e0

### Lap 2

#### 10. API calls: TOKEN, .http requests, and sending a call over the live drive

# Ticket 10 — API calls: TOKEN, .http requests, sending over the live drive

## What was done
- `runScenario` (services/scenarios.ts) now generates the run id itself and returns it as `run` on the ok result, plus `token` from the last trimmed `TOKEN=` line (empty → absent). The failure result is unchanged (no `run`), since nothing needed it.
- Discovery: `.http` files are never scenarios; `ScenarioEntry.hasCall` (core, now required) is true when the same-path `.http` sibling is listed (`callFileOf(file)` exported from scenarios.ts). Orphan `.http` files are ignored.
- New pure `services/http-request.ts`: `parseHttpRequest` / `fillHttpRequest`, types `HttpRequestTemplate`, `ParseHttpRequestResult`. A malformed header line (no colon) is a parse error. `fillHttpRequest` throws only if the target can't resolve to a URL; the landing code catches that into `callError`.
- Core: `FilledHttpRequest` (zod), `DriveCallResult` (TS type), and `DriveScenario` gains `token`, `run`, `call`, `callError`.
- git.ts `recordScenarioOutcome` now takes `{repoPath, driveUrl}` and, on landing, reads only the `.http` sibling from the checkout (via `scenarioCall`), storing `call` or `callError`.
- New `services/drive-call.ts`: `sendDriveCall(ctx, projectId, request, {allowReview?, fetchFn?})`, plus `DRIVE_CALL_TIMEOUT_MS` and `DRIVE_CALL_BODY_CAP` (256K characters, not bytes). It works out the drive from `activeDriveInfo`, so git.ts needed no new export. It never throws and emits nothing.
- tRPC `feature.sendCall({projectId, request})`.
- Tests: http-request.test.ts (table-driven), plus new cases in scenarios.test.ts and drive-scenarios.test.ts (call fill, malformed .http, send/cross-origin/cap/network error/review admission, tRPC). Web test fixtures got `hasCall: false` (the only web edit).

## Surprises
- The fake app also receives the readiness poll's GETs, so the drive test only checks POSTs.
- Full suite: 336 files / 4801 passed / 48 skipped. That is more than the prompt's baseline counts but entirely green.

## Left undone
- No drive.env / drive machinery change was needed (no new service, env var or seed).
- MCP `try_call`/`scenario` (ticket 11) should call `sendDriveCall(..., { allowReview: true })`. The web API view (ticket 12) reads `driveInfo.scenario.call` / `callError` and calls `feature.sendCall`.

#### 11. Scenario replay for review agents; get_feature_context reports scenarios

# Ticket 11 — scenario replay for review agents; get_feature_context reports scenarios

## What was done
- **git.ts** (done by the earlier attempt, kept as is): `runScenarioOnDrive`/`startScenarioOnDrive` take `{ allowReview }`, and `reviewDriveFor` is now exported. tRPC `feature.runScenario` doesn't pass the option, so it still refuses review drives. A drive test covers this, and it checks that switching scenarios on a review drive doesn't restart it.
- **review_drive** (mcp/server.ts): the input is now `{ action: start|status|stop|scenario|try_call, file? }`. The new actions don't go through `toolReviewDrive`. They live in a separate exported `toolReviewScenario`, because changing `toolReviewDrive` would have broken the `ReturnType<typeof toolReviewDrive>` typing that existing tests rely on. Both new actions are refused (`retriable: false`) when the drive was withheld, when the live drive is not this run's review drive, or when `file` is missing.
  - `scenario` returns `{ ok, action, entryUrl, token? }` or `{ ok:false, failure }`. The runner's own refusals (app not ready, a scenario already running) come back as a `deniedReason` with no `retriable` flag.
  - `try_call` requires `file` to be the landed scenario. If it hasn't landed, the denial says "run the scenario first: review_drive({ action: 'scenario', file: … })". If the scenario has no call, the denial says "this scenario has no .http call", or gives the `callError` when the `.http` file failed to parse.
- **Review prompt**: a `SCENARIOS` placeholder in both review-ticket.md (just before "Walk the app with agent-browser") and verify-fixes.md (after DRIVE_INSTRUCTIONS). `buildScenarioBlock(entries, runnerConfigured)` in workflows/review-ticket.ts builds it, and `reviewTicketOutcome` fills it from `listScenarios` at the feature branch.
- **get_feature_context**: a new header field `scenarios: { setUp, runnerConfigured, scenarios, fixtures }`, computed by the new async `featureScenarios(ctx, featureId)`. `featureContext` stays synchronous and takes the result as an optional third argument. Both MCP handlers pass it in. Direct callers (tests, `toolGetFeatureContext`) leave it out, which is why the field is optional on the type. The tool description mentions the field.

## Surprises
- A `running` run row blocks a human drive from starting, so the "not this run's drive" test puts another feature's review drive in the slot.

## Left undone
- `toolGetFeatureContext` (sync, used only by tests) doesn't carry `scenarios`.
- The drive machinery isn't touched: there are no new services, env vars or seeds.
- Verified: `bun run typecheck` passes, and the full `bun run test` run had 336 test files pass, 2 skipped, 0 failed.

#### 12. Web: API view with Try it, the Blank app nudge, and the dock header's errand

# Ticket 12 — Web: API view with Try it, the Blank app nudge, the dock header's errand

**What was done.** I added `apps/web/src/lib/feature-ui/api-call.ts`, a set of pure helpers: `callMenu`, `hasCalls`, `CallForm` with `callForm`/`callRequest`, `callMethods`, `statusTone` and `prettyBody`. I also added `showsScenarioNudge` to `scenarios.ts`. `ScenarioDrive.tsx` now has these:
- An App | API `SegmentedControl` in the toolbar. It only appears when some scenario has a call.
- In API mode the DrivePanel's wrapper switches to `hidden`, so the iframe stays mounted and is not reloaded. The new `ApiView.tsx` takes its place.
- The Blank app nudge, placed as a quiet line above the panel. Its ✕ state is keyed by `drive.branch`, with `devUrl` as the fallback. I added an optional `branch` to `ScenarioDriveInfo`; both callers already pass it through their spread.
- A `ChatErrand` state, set when the button is clicked. This means Fix it renames the dock header even when the server reuses a live chat.

ApiView works like this:
- It lists the calls in the Scenario menu's sections and runs a scenario through the parent's `pick`.
- It shows the parent's running/failed strip, including `ScenarioFailed` with Fix it.
- Its form (method Select, URL, header rows, body) and the last response are keyed by `landingId`, so Re-run discards both.
- Try it becomes "Send again" once a response exists.
- If a landed call is already on the drive when you switch to API, it is preselected.
- At phone width the list stacks above the form.

**Deviations.** There was no need to build `src/ui/segmented.tsx`: `SegmentedControl` already exists in `ui/choice.tsx`. In API mode, the toggle and the Scenario menu sit in ApiView's own header row, because the DrivePanel toolbar is hidden along with the panel. The nudge sits above the panel rather than inside its floating toolbar.

**Surprises.** None of note. The full suite passed (337 files, 4819 tests), more than the baseline the prompt quotes, and typecheck is clean.

**Left undone.** The API view does not show the token or run id on their own; they only show up inside the filled request. No server or skills files were touched. No drive machinery changed, because this is UI only.

#### 20. Verify the fixes that landed

Gates verification pass — all five landed fixes held

This is a Gates verification pass of `feature/drive-scenarios` at `f10c100`, the mode inherited from pass #14. I read each fix diff against its finding and read the server's gate results. I did not tour the app.

**Gates at f10c100:** `bun run typecheck` passed: core, server and web each exited 0, and so did scripts/. `env -u GIT_ASKPASS bun run test` passed: 337 files passed and 2 were skipped (339). The two skipped files are dev-pane-stop-bun and job-object-win32, which are platform-gated. Every test file these fixes touched ran and passed: merge-conflict (13), http-request (18), drive-scenarios (18), mcp-tools (46). The baseline's "118 files" is out of date. Nothing failed, so there is nothing to subtract.

**#15 merge-conflict clock flake: held.** The assertion at merge-conflict.test.ts:171 now compares the events' insertion `id`, which is the order `listAfter` sorts by, instead of the wall-clock `ts`. A clock stepping back can no longer turn it red. Only the test changed. The fix ticket admits that other tests comparing `ts` between consecutive events were not searched for, so the same flake may exist elsewhere.

**#16 a leading `### Name` line in a .http file: held.** `parseHttpRequest` now skips leading `###` lines along with blanks and comments. A `###` after the request line still ends the request. The repro (`### Blocked only\nGET /api/entries?mood=blocked\n`) is now a parse case that expects `{ method:'GET', target:'/api/entries?mood=blocked', headers:[] }`. There is a second case for "a leading ###, then comments, then a later ### that still ends the request". The old test case that locked the bug in is gone. In its place, "only separators" still fails as "no request line". This is the parser that the drive's call loading, Try it and `try_call` all use, so the fix reaches all three.

**#17 placeholders shown percent-encoded: held.** `fillHttpRequest` still resolves the URL with `new URL`. It then turns each `%7B%7B<name>%7D%7D` back into `{{<name>}}`, including `%20` padding inside the braces, and leaves a lone `%7B` the author wrote alone. The repro is now a test that expects `http://localhost:4000/api/{{foo}}`. Sending is unaffected: `sendDriveCall` runs the URL through `new URL` again, which re-encodes it.

**#18 cleared URL raises a toast: held.** `FilledHttpRequest.url` is now `z.string()`, so `feature.sendCall` no longer throws BAD_REQUEST on an empty URL. `sendDriveCall` returns `{ ok:false, error:'No URL to send the call to' }` for a blank URL. ApiView already shows `!result.ok` as "Couldn’t send: …" in the response area (ApiView.tsx:225-228), and its `callRequest` trims the URL before sending. The caller test in drive-scenarios.test.ts covers the empty URL, and it ran in the gate. Not covered: `method` is still `min(1)`, so clearing the method would still raise a toast, but the finding was about the URL only. The UI repro was not run, because this pass had no drive.

**#19 three versions of "list a feature's scenarios": held.** `isScenarioRunnerSet` and `listFeatureScenarios` in services/scenarios.ts are now the single rule. `listDriveScenarios`, `featureScenarios` (get_feature_context) and the review prompt's SCENARIOS fill all use them, and so does `runScenario`'s runner check. A whitespace-only runner now reads as "not configured" on all three paths, and mcp-tools.test.ts has a test for it. Two side effects, both reasonable:
- `featureScenarios` no longer falls back to `'main'`: a draft with no recorded base gets `setUp:false`.
- The drive now lists scenarios at the recorded `feature.branch` instead of `featureBranch(slug)`. These are the same for every real feature.

One small leftover: launcher/artifacts.ts still has its own `runner.trim() !== ''` check, which agrees with the shared rule.

**Nothing broken.** I found no new defects, so I reported no findings.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON: all five landed fixes read correct against their findings; typecheck and the full test suite are green at f10c100
