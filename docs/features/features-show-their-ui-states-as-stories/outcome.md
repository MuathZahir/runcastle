# Outcome — Features show their UI states as stories

An agent sets up the project's story tool (Storybook, or Widgetbook for Flutter) the first time a feature needs it. Features then write stories for the UI states they build. Runcastle builds the catalogue in the sandbox and shows the stories a feature added or changed, rendered, on its page. No app start is needed.

- Shipped: 2026-10-19
- Laps run: 2

## What shipped

49 commits · 95 files

### Lap 1
- 11 tickets landed: #1 Story matching, the data-dir lifecycle and the contract types; #2 The catalogue is built beside the gates on every pass; #3 The feature page shows its UI states; #4 Prepare offers UI states, and planning asks for stories; #5 Runcastle's own dashboard gets UI states, by the prepare recipe; #7 The stories port serves base-build.log, a runcastle log, publicly; only manifest.json and build.log are refused; #8 The UI-states build log shown to the human signs its notes "runscastle:" (typo); #9 The UI-states section is gated and labelled by laps, which main has since retired in favour of rounds; #10 When a build's output can't be kept, the section is rewritten to "couldn't run" without an event; #11 Merging this feature into main breaks main's typecheck and the stories build: the CarriedFindings story imports a component main deleted; #12 On Windows the stories port serves manifest.json and build.log through an "::$DATA" suffix
- 0 waived
- 0 failed

### Lap 2
- 6 tickets landed: #14 Merge main into the branch and bring the stories in line; #15 Stories port refuses short names; the build record and prompt tokens are fixed; #16 A drive can show UI states: the Feature with UI states scenarios; #18 Both UI-states scenarios fail on Windows: the stories build gets a quoted output path it can't create; #19 A failed UI-states build shows its log full of raw ANSI color codes; #20 The page-level "Feature page / Review · With Open Findings" story renders a blank frame
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 43cf88de5eda55336ac0d8a71c2d3e165e4b8d78
- Landed since: 12
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 7817893d39389b9e12a3cd8c9d7603b91c96f0f9
- Landed since: 6
- Outcome: done

### Lap 2 · review

- Reviewed commit: 1719d0b8efa7609185a01697f499b31df989754f
- Landed since: 3
- Outcome: done

### Lap 2 · verification

- Reviewed commit: 6be83213d790aa056f335d047727026cacb94156
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Story matching, the data-dir lifecycle and the contract types

# Ticket 1 — story matching, data-dir lifecycle, contract types

**What was done.** Added `packages/core/src/stories.ts`, exported from the `@runcastle/core` barrel. It has `STORIES_CONFIG_REL`, `StoriesConfig`, `parseStoriesConfig` and `renderStoriesBuildCommand`, which replaces every `{out}` with the path in double quotes. It also has tolerant zod schemas for Storybook's `index.json` (`StoryIndex`) and `preview-stats.json` (`PreviewStats`), plus `normaliseStoryPath` (strips `./`, turns `\` into `/`, drops `?query`). `classifyFeatureStories({ changedFiles, index, stats, base })` takes `base: StoriesBase` (`none` | `failed` | `built` with an index). It does a BFS over the reverse import graph, skips node_modules and `docs` entries, and sorts the result changed, new, affected, then by title and name. The module also defines `ClassifiedStory`, `StoriesManifest` and `StoriesBuildRecord`. `StoriesBuildRecord` follows `ReviewGateRun`; `failed.exitCode` is nullable to match the gate results.

`@runcastle/core/paths` gained `storiesRoot()`, `featureStoriesDir(id)`, `baseStoriesDir(commit)` and `STORIES_MANIFEST`. `baseStoriesDir` throws on anything that is not a hex sha, so a commit cannot point outside its folder. The config has a new `storiesPort` (default 4514) with an env override, `RUNCASTLE_STORIES_PORT`, in `config-load.ts`. A matching settings descriptor was added on the server, and web field meta labelled "UI states port", because serverPort appears in the settings UI.

`packages/server/src/services/stories-store.ts` provides `removeFeatureStories` and `sweepBaseStories`. Both are best-effort and never throw. They are called after `retireShippedWorktree` in `mergeFeatureFlow`, and in step (7) of `deleteFeature`. Tests: `packages/core/test/stories.test.ts`, new cases in `paths.test.ts`, and `packages/server/test/stories-store.test.ts`. The server test covers merge, delete and the sweep against a temp data dir, plus a chmod-forced removal failure that still ships.

**Surprises.** None of the existing tests call `mergeFeatureFlow` directly, so the new tests drive it through the tRPC `feature.merge` caller, the same way `merge-conflict.test.ts` does. The fixtures are hand-written to the shape in the ticket. I did not query ctx7 for a real Storybook output.

**Left undone / for #2 and #3.**
- The sweep only keeps a base build if some feature's `manifest.json` lists its commit. So #2 should write the feature manifest before or atomically with caching a new base build, or a merge or delete sweep running mid-build can remove the base.
- Once #3 opens port 4514, a runcastle drive of this repo (a second server process) will collide with the host's listener. `.runcastle/drive-setup.ts` already sets `RUNCASTLE_SERVER_PORT` per drive. #3 should also write `RUNCASTLE_STORIES_PORT`, which `config-load` now honours.
- I did not edit the drive machinery: this ticket adds no service, env var, seed or process.

#### 2. The catalogue is built beside the gates on every pass

# Ticket 2 — the catalogue is built beside the gates on every pass

**What was done.** I added `packages/server/src/workflows/stories-build.ts`. It splits the work into two steps. `planStoriesBuild(input)` reads `.runcastle/stories.json` at the tip with `git show`. When the file is missing or invalid, the result is `none`, and any old feature dir is removed (with a `stories.removed` event) so the section disappears. Otherwise it returns a `GateSandboxStep` plus a `finish()`. `runStoriesBuild(input)` is the stand-alone version: it pins its own throwaway branch `runcastle/stories/<ticketId>` and opens its own sandbox.

`review-gates.ts` changes:
- `runReviewGates` takes an optional `afterCommands` step. It runs in the same sandbox right after the verify commands, so there is no second install.
- With no verify commands, it opens a sandbox just for the step and still returns `none_configured`.
- When no sandbox can be opened, the step's `abandon(reason)` is called.
- `WithGateSandbox` has an optional third argument `{ outDir }`. `burnGateSandbox` (now exported) bind-mounts that dir at `/home/agent/runcastle-stories-out`, or under `noSandbox` uses the host path directly. It hands this to the step as `sandbox.outPath`.
- I extracted `withThrowawayBranch`, `execWithTimeout` and `timeoutReason`, and `runReviewGates` uses them. The old tests stay green and 3 new `afterCommands` tests were added.

How `finish()` handles each outcome:
- **Failed build:** a non-zero exit, or a build that wrote no readable `index.json` or no `preview-stats.json` ("must pass --stats-json"). The feature dir becomes just `manifest.json` plus `build.log`, and `stories.failed` is emitted.
- **Timeout, or a sandbox that won't open:** a `couldnt_run` manifest plus log, and `stories.couldnt_run` is emitted.
- **Success:**
  1. Resolve the base at `git merge-base <baseBranch> <sha>`. Reuse `baseStoriesDir(commit)/index.json` when it exists. Otherwise, if that commit has `stories.json`, build it on `runcastle/stories-base/<ticketId>`. A failed base build is not cached; its log goes into the feature dir as `base-build.log`.
  2. Classify over the three-dot diff and write the manifest.
  3. Swap the build into `featureStoriesDir`, using rename with a copy fallback.
  4. Only then move the new base into its cache dir, so a merge's sweep can't delete it mid-build.
  5. Emit `stories.built` with counts.

`reviewTicketOutcome` now goes through `runBranchChecks`: plan, then gates with the step, then finish. `buildStoriesNotes(record, featureId)` fills `{{STORIES_NOTES}}`, which sits on the same line straight after `{{GATE_NOTES}}` in both templates, so an empty block leaves no extra line. The stories record is not stored on the ticket: that would need a migration.

**Surprises.** Server tests are not typechecked: the server tsconfig includes only `src`. So the existing `renderReviewPrompt` tests would have failed at runtime on a literal `{{STORIES_NOTES}}`, not at typecheck. I updated them. Full suite: 340 files passed, 0 failed. Typecheck is clean.

**Left undone.**
- The stories record is not persisted on the ticket row.
- When the feature has no resolvable base, no stories are classified (the changed-file list is empty).
- I made no drive machinery edits: no service, env var, seed or process was added.

#### 3. The feature page shows its UI states

# Ticket 3 — the feature page shows its UI states

**What was done.**
- **The stories port.** Added `packages/server/src/routes/stories-static.ts`, a pure `createStoriesHandler(root = storiesRoot())` that returns `(req) => Response`. It serves only `/features/<feat_…>/…` and `/base/<40-hex>/…`.
  - It reuses `safeJoin` and `contentType`, now exported from `routes/web.ts` with their behaviour unchanged. The MIME table itself stays private.
  - A directory serves its `index.html`, and every response is `no-store`.
  - Everything else answers 404: `manifest.json`, `build.log`, `/api`, the root, any method other than GET/HEAD, and malformed ids or commits.
  - `startServer` opens a second `Bun.serve` on `config.storiesPort`. It is wrapped in try/catch, so a busy port only logs a warning and never kills boot. It is also stopped on shutdown.
- **`feature.uiStates({featureId})`** lives in `services/ui-states.ts`. It returns null when the manifest is missing or invalid, when the manifest's `featureId` doesn't match, or when the id doesn't match `FEATURE_ID_PATTERN` (that check also blocks traversal through the id).
  - Otherwise it returns `{status, reason, log (last 200 lines, failed/couldnt_run only), commit, baseCommit, base, lap, builtAt, changed, new, affected}`.
  - Frame URLs are built from `ctx.config.storiesPort`. A `baseFrameUrl` is set only for changed stories whose base built.
  - Web types for the model are `UiStatesModel` and `UiStatesStory` in `lib/api.ts`.
- **`components/review/UiStatesSection.tsx`.**
  - Changed stories show as a "Before" / "This feature" pair (stacked below the `@2xl` container width). New stories show alone.
  - Each story carries a "Changed" or "New" `Tag`. "Changed" comes from the approved mock; the ticket asked only for "New".
  - Far matches sit in a `Disclosure` with an "Open larger" button per row.
  - If the base build failed, one line says the before versions didn't build.
  - Failed and couldnt_run states show their message, with the log in a mono block.
  - "Open larger" opens a `Dialog` (size `full`). Frames are lazy and `h-60`, with no `sandbox` attribute.
- **`LaterLapUiStates`** shows the section on lap > 1 only. It is placed in the `RunBody` (after the lanes) and in `PhaseBody`'s planning case, using `className="mt-10"`.
- **Review placement.** `ReviewBody` places the section right after `{!expanded && stage}`.
- **Live refresh.** `live.ts` invalidates `feature.uiStates` on every DB-backed signal.
- **Drive machinery.** `.runcastle/drive-setup.ts` now writes `RUNCASTLE_STORIES_PORT`, set to the next free port above the drive's server port, so a drive no longer collides with the host's 4514. I checked that it parses (`bun build --no-bundle`); I did not run it.

**Deviation.** The manifest has no review-pass number, so the hint cannot say "review pass N". It reads "Built at review · commit abc1234", or "Built at lap N's review · …" when the build comes from an earlier lap.

**Surprises.**
- Six web tests mock the trpc hooks by hand: `review-bands`, `review-blocking-drive`, `review-page-clicks`, `stage-expand`, `run-body-model` and `preview-placement`. Each needed a `uiStates` stub.
- `preview-placement` compares markup byte for byte. The sibling slot shifts React's `useId` numbering, so the test now strips `_R_…_` ids before comparing.
- happy-dom really fetches iframe `src`, and the `disableChildFrameNavigation` setting did not stop it. The tier-2 test swaps frame URLs to `about:blank#…` instead.
- The real baseline is now 345 files and 4952 tests. Both commands are fully green.

**Left undone.**
- I did not touch ticket #2's workflows. The section depends on #2 emitting `stories.built`/`stories.failed` through `emit`; the live sync refreshes on any feature event either way.
- The TicketsBody shown in the building phase before a burn does not show the section, only RunBody does.

#### 4. Prepare offers UI states, and planning asks for stories

# Ticket 4 — Prepare offers UI states, and planning asks for stories

**What was done.** `probePrepareHost` now reports `hasStories` (`.runcastle/stories.json` present), and `PrepareHost.hasStories` is required. `renderPreparePrompt` lists it under "What the server already checked". When it is false, "Still open" gets a **UI states** item placed after the open keys and before any closing dry-run. With every key established, the bare confirmation text is swapped for "keys are established, UI states are still open", and the task line changes to match. One addition beyond the ticket text: `launchPrepareSession` used to type the confirm-and-stop kickoff whenever no keys were open. That line said "stop", which contradicted the brief, so it is now only sent when UI states are also settled. With only UI states open, the session gets the normal agenda kickoff. No UI change was needed: the Prepare entry already opens a session when everything is set.

The edit guard lets `prepare`, and only `prepare`, write any `package.json` outside `node_modules` plus a root lockfile. The prepare denial text names both. `LOCKFILES` moved to a new shared `packages/server/src/launcher/lockfiles.ts`, which both the probe and the guard import. `PREPARE_BASH_WRITE_RULES` adds `git add package.json`, `git add */package.json` and one per-lockfile `git add` for prepare; drive-fix and scenario keep `HOST_SESSION_BASH_WRITE_RULES`.

`get_feature_context` now carries `stories: { setUp }`, read with a new `git.fileExistsAt` helper (`cat-file -e <base>:.runcastle/stories.json`). With no recorded base it is false. The two MCP call sites share a new `featureContextWithGit` helper, and the tool description names the field.

Skill changes:
- prepare SKILL.md gained "## UI states (once per project)" and an entry in the conversation order. It points at `./references/stories.md`.
- tickets SKILL.md gained `<ship-a-story>` and self-check item 8.
- revisit defers to the new rule.

**Surprises.** `./references/stories.md` doesn't exist on this branch yet; ticket #5 writes it, and no test checks that the reference resolves. The full suite had one failure, a timing assertion in `project-drive.test.ts` (`startedAt >= t0`). That file is untouched by this ticket and passes when run alone.

**Left undone.** The stories-file path is a local `STORIES_FILE` constant in `mcp/server.ts` and a literal in `probePrepareHost`. If another ticket adds a core constant for `.runcastle/stories.json`, both should switch to it. The drive machinery is unaffected: no new service, env var, seed or process.

#### 5. Runcastle's own dashboard gets UI states, by the prepare recipe

# Ticket 5 — runcastle's own dashboard gets UI states

## What was done
- Installed Storybook 10.6.2 (`storybook`, `@storybook/react-vite`; peer range covers Vite 5–8 and React 19) with `bun add -d --exact` at the repo root, and committed bun.lock. I checked versions against the npm registry's peerDependencies rather than through ctx7.
- `.runcastle/storybook/`:
  - `main.ts` reuses `apps/web/vite.config.ts` via `builder.viteConfigPath`, with telemetry off;
  - `preview.tsx` imports the app's fonts and CSS entries in main.tsx's order. One decorator stacks trpc.Provider, QueryClientProvider, TooltipProvider and ToastProvider with a story-local client (`retry: false`, `staleTime: Infinity`), and a light/dark `theme` global sets `<html data-theme>`;
  - `fake-api.ts` is the data edge: a `fetch` handed to the app's own `trpcLinks` that answers tRPC's batched or single wire format from handlers typed by `RouterOutputs`. An unfaked query answers NOT_FOUND; mutations are refused;
  - `tsconfig.json` and `env.d.ts` for the stories typecheck.
- **Deviation:** I used no MSW. The page story fakes data at the tRPC fetch edge and seeds the one plain-HTTP read (review artifacts) into the cache. Handler inputs are typed `unknown`; only outputs are typed.
- `.runcastle/stories/` has 8 stories:
  - Feature/ConflictCard ×2, Feature/DependenciesRow;
  - Burn/Lane (failed), Burn/UnrunnableGates;
  - Review/CarriedFindings, Review/NothingVerifiedAlert;
  - the page story "Feature page/Review — with open findings", which is ReviewBody with every query faked. It sits below `App`, so `useLiveSync` / EventSource never starts.
  - It reuses `apps/web/test/fixtures.ts` (`full`, `listItem`). Most other sample data lives inside test files, which can't be imported, so those stories build their own.
- `.runcastle/stories.json` matches recipe step 8. Running it into /tmp exited 0 in about 4s. `index.json` listed all 8 stories and `preview-stats.json` was written, with repo-relative paths like `./apps/web/src/components/review/ConflictCard.tsx`.
- Root `typecheck` now ends with `&& tsc --noEmit -p .runcastle/storybook/tsconfig.json`. Typecheck passes; the full test suite passes (339 files, none of them stories).
- Wrote the recipe at `prepare/references/stories.md` and a Stories section in apps/web/STYLE.md, after Testing.

## Surprises
- Bun's isolated linker: files under `.runcastle/` resolve packages only from the root node_modules. I had to add root devDeps at exactly apps/web's versions (react, @tanstack/react-query, @types/react, @types/node, and both @fontsource-variable fonts). They resolve to the same store directories, so there is one React and one QueryClient context. This is recorded as a gotcha in the recipe.
- `scripts/tsconfig.json` includes `../.runcastle/**/*.ts`, which would typecheck the catalogue with bun-types and no DOM. I excluded `.runcastle/storybook` and `.runcastle/stories` there.
- The baseline's "118 files" is stale: the repo has 339 test files.

## Left undone / not verified
- The sandbox has no browser, so I couldn't watch a story render, and the page story's runtime behaviour is unchecked. The build and typecheck pass.
- I didn't touch SKILL.md; ticket #4 links the recipe from it.
- Drive machinery: none of the triggers apply (dev deps only), so no edits.

#### 13. Verify the fixes that landed

Gates verification pass — verifying review pass #6: 5 of 6 fixes hold, 1 holds only in part, 2 findings left open

I read each fix commit against its finding, re-ran each repro I could from the human's checkout, and read the server's gate results for the branch at 7817893. Both gates passed: `bun run typecheck` (it now includes the stories typecheck) and `env -u GIT_ASKPASS bun run test` (344 files passed, 2 skipped, 0 failed). Nothing outside the baseline failed.

## The fixes

**Held**
- **#7, base-build.log on the stories port.** `PRIVATE_FILES` is now built from `STORIES_MANIFEST`, `STORIES_BUILD_LOG` and `STORIES_BASE_LOG`, so `base-build.log` gets a 404. A test case covers it.
- **#8, the "runscastle:" typo.** `git grep runscastle` over the whole branch finds nothing. Both notes in stories-build.ts now read "runcastle:".
- **#9, laps.** `UiStatesSection` no longer takes a lap. The label reads "Built at review" or "Built at the last review", plus the commit. `LastReviewUiStates` replaces `LaterLapUiStates` without the `lap > 1` gate, so the section shows whenever a build exists. The three call sites and their tests were updated. The only lap left is `StoriesManifest.lap` on the manifest and the model, which nothing in the UI reads.
- **#10, couldn't-run with no event.** The catch in `planStoriesBuild`'s `finish` now emits `stories.couldnt_run` with the same message form as `finishBuild`. The event goes out even when rewriting the manifest also fails. A test covers it.
- **#12, `::$DATA`.** Any path whose resolved relative part contains a colon now gets a 404, after decoding, so `%3A%3A` is caught too. I checked on this Windows machine under Bun:
  - `manifest.json::$DATA` really does stat as the manifest, so the guard is needed, and the colon check catches it.
  - Trailing-dot and trailing-space names don't alias the file under Bun (ENOENT), so ticket 12's leftover worry doesn't apply.
  - Case variants are caught by the toLowerCase.

**Held in part**
- **#11, merging main breaks typecheck.** The cause the finding named is fixed. The CarriedFindings story is gone, and the merge-tree repro now gives `story-absent` and `component-missing`. Every component the remaining stories import exists in the merged tree. The symptom is not gone, though: `NothingVerifiedAlert.stories.tsx` still passes `lap: 2`, and main has removed that prop. Under `satisfies Meta<…>` that extra arg is a type error, so the stories typecheck, and with it the root `typecheck`, still fails once main is merged in. Ticket 11 recorded this itself. The arg can't be dropped on the branch, where the prop is still required; it has to go in the merge with main, along with the five conflicting files (RunBody.tsx, lib/live.ts, edit-guard.ts, routers/feature.ts, revisit/SKILL.md). Reported as an open finding.

## Something new on a fixed surface

- **The stories port serves files under their Windows short names.** 8.3 short names are on for C:, where ~/.runcastle lives. In a probe, `MANIFE~1.JSO` stats as the manifest. The handler checks exact lowercase names, so `GET /features/<id>/MANIFE~1.JSO` would serve the manifest, and `BASE-B~1.LOG` would serve the base build log. Low severity. A fix is to compare the real long name from `realpathSync.native`. Reported as an open finding.

What this pass did not do: it ran no build and drove nothing, as Gates mode prescribes. The end-to-end check after publish and reinstall from pass #6 still stands: a review pass should show the UI states section, with the dashboard stories marked New and framed from port 4514.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON: Gates verification ran in full; #7, #8, #9, #10 and #12 hold, #11 holds only in part (the NothingVerifiedAlert story's lap arg still breaks typecheck once main is merged in), and the Windows short-name bypass is left open.

### Lap 2

#### 14. Merge main into the branch and bring the stories in line

# Ticket 14 — merge main into the feature branch

**What was done.** I fetched `origin/main` (54531354) and merged it into the branch with a merge commit (`2ac208d6`, parents 1131d066 + 54531354). No history was rewritten. The five conflicts were all resolved on main's side, with the branch's additions put back:
- `RunBody.tsx`: kept main's body and imports, re-added the `LastReviewUiStates` import and mount. Lap 1's `StatusStrip` import was dropped because main's RunBody no longer uses it.
- `live.ts`: main's `refetches.push(...)` form, with `u.feature.uiStates.invalidate()` added beside `goWarnings`.
- `edit-guard.ts`: main's imports (`Phase`) plus `sep` and `LOCKFILES`. The prepare-only manifest/lockfile widening and its denial text auto-merged intact.
- `routers/feature.ts`: main's `listRounds` import plus `uiStates`.
- revisit `SKILL.md`: main dropped the whole "Lap mode" section, which held the branch's ship-a-story line. I moved that deferral onto main's step 4 ("New work required"), beside the existing ship-a-scenario sentence.

**Reproduced first** (on the merged tree, before touching the story), `bunx tsc --noEmit -p .runcastle/storybook/tsconfig.json` reported:
`.runcastle/stories/review/NothingVerifiedAlert.stories.tsx(9,5): error TS2353: Object literal may only specify known properties, and 'lap' does not exist in type 'Partial<{ outcome: { kind: "unverified"; line: string | null; reason: string | null; }; agenticReview: { onStart: () => void; blocked?: string | undefined; } | null; }>'.`
I dropped the `lap` arg, then re-ran the same command: exit 0.

**Stories.** I added `.runcastle/stories/review/RoundTrail.stories.tsx` ("After an earlier round": round 1 with a failed worker, an agent fix, a Ready entry, round 2 running, one ticket not yet dispatched). Its sample data is copied from `apps/web/test/round-trail-view.test.ts`, which keeps its data inline and exports nothing. The `Feature page/Review` story now also fakes `feature.rounds`, `feature.readyDeclarations` and `notes.delivery`, which main's ReviewBody/WorkList read. Typecheck passed without these fakes, but without them those reads answered NOT_FOUND at runtime.

**Gates on the merged tree (all exit 0):** `bun install` (no changes), `bun run typecheck`, and `env -u GIT_ASKPASS bun run test` (355 files passed, 2 skipped; 4990 tests passed, 48 skipped; main's suite is much larger than the old baseline). The real `stories.json` build into `/tmp/sb-out` wrote `index.json` with all 9 stories, including `review-roundtrail--after-an-earlier-round`, plus `preview-stats.json`. `git merge-tree --write-tree --name-only origin/main HEAD` reports no conflicts. I re-ran the reviewer's repro (the stories tsc) as described above.

**Surprises.** Migrations: the branch has none of its own, main's is `0047_clear_betty_brant`, so nothing was renumbered. Nothing on the UI-states path shows a lap: `UiStatesSection.tsx` only mentions laps in a comment. The section model and manifest still carry a `lap` field (core `stories.ts`, `ui-states.ts`), which is data, not a label.

**Left undone.** The Review page story's sample data still says "review the lap" and carries `lap: 1` fields; that is cosmetic data, left as is. The drive machinery needed no change (no new service, env var or seed). I didn't run it, as instructed.

#### 15. Stories port refuses short names; the build record and prompt tokens are fixed

# Ticket 15 — short names refused, build record stored, one-pass prompt fill

**What was done.**
- **Stories port, 8.3 short names.** `createStoriesHandler(root, deps?: { realPath? })` now resolves the build dir and the requested file through `realPath` (default `realpathSync.native`). It refuses when the real relative path, lower-cased, is a private file or contains `:`, or when the file is not under the real build dir. Any resolver error is a 404. **Reproduced first:** the new test in `stories-static.test.ts` writes `MANIFE~1.JSO` and `BASE-B~1.LOG` as plain files and injects a resolver that maps them to `manifest.json` and `base-build.log`. Before the fix both cases failed with `AssertionError: expected 200 to be 404` (quoted in the commit body). After the fix all 24 cases pass, including traversal, `::$DATA`, `%3A`, `/api`, bad ids and MIME. I re-ran this repro after the fix and it was green.
- **Stories-build record stored.** I added a `tickets.stories_build` JSON column to db-schema, a `storiesBuild: StoriesBuildRecord.nullable().optional()` field to the Ticket schema (matching `reviewGateRun`), and `storiesBuild` to the `updateTicket` patch in core's `WorkflowCtx` and in the tickets service, with row mapping and a `null` default in `storeTickets`. `review-ticket.ts` now writes `{ reviewGateRun, storiesBuild }` in one update on every review and verification pass. Tests: a tickets round-trip, a new `stories-build-migration.test.ts` that applies the migration to a database with rows, and review-ticket seam assertions (`none` when there is no stories.json, `failed` with commit/exitCode/log, and `couldnt_run` when the branch doesn't resolve).
- **renderTemplate** now does one regex pass with a replacer function. Tests check that a value containing `{{GATE_NOTES}}` stays literal and that `$&`, `$1` and `$$` stay literal. The existing test covers unknown and repeated keys. Every `{{…}}` in `packages/skills` is `[A-Z0-9_]+`, so I didn't widen the pattern.

**Surprises.** `drizzle-kit generate` named the migration `0049_*`, because it numbers by journal entry count and main has two `0046_*` files. I renamed it to `0048_new_northstar.sql` with `meta/0048_snapshot.json` and fixed the journal tag. The journal `idx` stays 49, and a re-run of generate reports no changes. Four existing review-ticket assertions compared the whole patch and needed `storiesBuild` added.

**Gates:** `bun run typecheck` exit 0; `env -u GIT_ASKPASS bun run test`: 356 files passed (2 skipped), 4997 tests passed (48 skipped).

**Left undone.** Nothing reads `ticket.storiesBuild` yet: the UI and review routes still use the manifest. `.runcastle/` and the drive machinery were not touched, and none of the drive triggers apply.

#### 16. A drive can show UI states: the Feature with UI states scenarios

# Ticket 16 — the "Feature with UI states" scenarios

**What was done.**
- **Two scenarios** in `.runcastle/scenarios/review/`, with shared helpers in `.runcastle/scenarios/_fixtures/ui-states.ts`. The helpers cover the drive data-dir guard, the drive db (migrate, then close for the WAL), this checkout as a project, a host sandbox, and seeding a feature at review.
- **`feature-with-ui-states.ts`** registers the checkout through `openProject` (it writes nothing into the repo). It seeds a feature as a draft, then points it at `RUNCASTLE_BRANCH` with base `main`, sets it active and at review, and stores two done tickets plus one done review ticket. It then runs the real `runStoriesBuild` with a host sandbox.
- **`ui-states-every-state.ts`** builds the catalogue once on the host into a temp dir.
  - The compare feature: the build is copied into its feature dir and into `baseStoriesDir(ba5e…ba5e)`. The new story's entry is removed from the base `index.json`. Its manifest lists 2 changed, 1 new and the rest affected, using real ids.
  - The failed feature: a failed manifest plus a Vite-style `build.log`.
  - It prints `ENTRY_URL` and `FAILED_URL`.
- **Server changes (small):**
  - `StoriesBuildDeps.withBranch` (it defaults to `withThrowawayBranch`). `runStoriesBuild` pins a `runcastle/stories/<ticket>` branch and the scenario must leave no refs, so it injects a no-op.
  - `setFeatureBranches` in `services/repo.ts`, which emits `feature.branches`.
- **Tests:** `packages/server/test/ui-states-scenarios.test.ts` uses a temp drive dir and a temp repo whose `stories.json` build is a stub bun script that writes fixture JSON. It asserts valid manifests, the printed URLs, refs unchanged per `git for-each-ref`, and the refusal of `~/.runcastle` for both scenarios.

**Real run in the sandbox** (temp `.runcastle-drive-verify` dir, `RUNCASTLE_BRANCH` set to this branch):
```
[feature-with-ui-states] built: 0 changed, 9 new, 0 also affected
ENTRY_URL=/p/proj_nx87QqugjseS/f/ui-states-fec459
exit=0
refs-unchanged
```
- The manifest lists all 9 stories from the 8 `.runcastle/stories` files, all `new`.
- `ui-states-every-state.ts` also exited 0 and printed both URLs.
- Pointed at `~/.runcastle`, it refused with exit 1.

**Surprises.**
- This sandbox clone has no local `main`, only `origin/main`. With base `main`, the merge base came back null, there were no changed files, and 0 stories matched. The seed now falls back to `origin/main` when `main` doesn't resolve.
- The host sandbox refuses any branch except the feature build's. So once main has `stories.json`, the base build in scenario 1 comes back `failed`, not built from the wrong tree.
- Full suite: 1 failure in `kill-registry.test.ts`. The elapsed time came out as −442ms, which means the wall clock jumped backwards. The file passed 30/30 when run alone, so this is environment flake.

**Left undone.**
- The drive machinery needs no change: no new service, env var or seed. I didn't run drive-setup.
- `feature-at-review.ts` keeps its own copy of the guard; I didn't refactor it.

#### 19. A failed UI-states build shows its log full of raw ANSI color codes

# Ticket 19: strip colour codes from the UI-states build log

**What was done.** `packages/server/src/workflows/stories-build.ts` now gets its log text from a single `buildLog(result)` helper. The helper joins stdout and stderr and removes terminal escape sequences with Node's `stripVTControlCharacters`. Both the feature build and the branch-point build use it. The stored `build.log` is now plain text, so the feature page's "The UI states didn't build" block and the review prompt that inlines the same log both get clean text. I stripped the codes when the log is written rather than setting NO_COLOR. That covers any tool or package manager that ignores NO_COLOR, and it works under cmd.exe, where env prefixes don't work. There is a new test in `packages/server/test/stories-build.test.ts`: it feeds the exact sequences from the report (`[90m│[39m`, 24-bit colour, bold red) through a failed build and checks the log is plain text. It failed before the fix and passes now.

**Repro step.** I could not re-run it as written. This sandbox is Linux with no drive or browser, and the brief says not to run drive scenarios here. The scenario `feature-with-ui-states.ts` calls the real `runStoriesBuild`, so a failed build in a drive now writes its log through the fixed path. The new test reproduces the reported log lines exactly. Someone still needs to confirm this in a real drive.

**Checks.** `bun run typecheck` passed with 0 errors. `env -u GIT_ASKPASS bun run test` passed: 357 files, 5002 tests, 0 failed. No drive machinery changed.

**Surprises.** None.

**Left undone.**
- Logs already on disk from earlier builds keep their codes until the next review pass replaces them. The page renders the log as-is and does not strip it on read.
- The `ui-states-every-state` scenario writes its own failed-build log and does not go through this path. It was not part of this report.
- The Windows quoting defect and the blank page story belong to other tickets.

#### 21. Verify the fixes that landed

Drive verification pass — the three lap-2 fixes all hold on Windows · 0 new defects

I drove the branch at `6be8321` on the human's Windows machine (drive at `localhost:27935`, stories port `27936`). I ran both UI-states scenarios with nothing patched, then toured the review pages they seeded, with the recorder running the whole time. All three fixes listed for pass #17 held.

**#18: the scenarios run on Windows. Held.** With `.runcastle/drive.env` loaded and `RUNCASTLE_BRANCH` set to the branch, `bun .runcastle/scenarios/review/feature-with-ui-states.ts` printed `built: 0 changed, 9 new, 0 also affected` and an `ENTRY_URL`, and exited 0. This is exactly the result the finding expected. `ui-states-every-state.ts` also exited 0 and printed both `ENTRY_URL` and `FAILED_URL`. Unlike the last review, no preload or quoting shim was used. The fixture now reuses the drive hooks' `hookSpawnTarget`, which runs `cmd.exe /d /s /c "<command>"` verbatim, so the quoted output path reaches storybook as a real path.

**#19: a failed build's log is plain text. Held.** The every-state scenario writes its own log, so I checked a real failure instead. A scratch script, kept outside the repo, ran the real `runStoriesBuild` in the drive's data dir. It pointed storybook at a config dir that doesn't exist and set `FORCE_COLOR=1`. Storybook's raw output did contain escape codes, but the stored `build.log` has none. On the feature page, "The UI states didn't build" shows the log as clean text: the box-drawing gutter and the `SB_CORE-SERVER_0006` error, with no `[90m`-style sequences (shot 06). Logs written by older builds keep their codes until the next pass replaces them, as the ticket said.

**#20: the page-level story renders. Held.** The story `feature-page-review--with-open-findings` renders in three places:
- inline in the UI states section (shot 03);
- served directly from the stories port as `iframe.html?id=…&viewMode=story`, where `#storybook-root` holds about 17 KB of markup (shot 04);
- in the "Open larger" overlay (shot 05).

It shows "Notes for the agent" with both open defects ("an expired coupon still discounts the total", High, and "the coupon error is not announced to screen readers", Medium), plus Round 1 with three landed workers and the "Ready for you after round 1" entry. It was blank on the previous drive.

**Rest of the tour.**
- The real-build feature page lists all nine stories as New under "UI states · Built at review · commit 6be8321". Every frame is served from the drive's stories port.
- The comparison scenario shows Before and This feature pairs marked Changed, followed by the New stories (shot 07).
- The scenario's own failed feature shows its failure state (shot 08).

Nothing was plainly broken. One small oddity, outside these fixes: a failed build's section header still reads "Built at review · commit …" above "The UI states didn't build". The question from the last review is still yours: the verbatim failure log names Storybook.

**Gates.** The server ran both verify commands on `6be8321` and both passed: `bun run typecheck` and `env -u GIT_ASKPASS bun run test`. Neither command was run from this checkout.

**Housekeeping.** The drive was stopped, and the checkout is back on `main` and clean. The scenarios and the scratch failure feature wrote only to the drive's own data dir. The recording is `walkthrough.webm` and the screenshots are in `shots/`, both beside this digest. The scratch script and the Playwright driver are in `scratch/`, outside the repo.

REVIEW-MODE: drive
REVIEW-VERDICT: verified
REVIEW-REASON: All three landed fixes (#18 Windows quoting, #19 ANSI-free build log, #20 page story renders) held on a Windows drive.
