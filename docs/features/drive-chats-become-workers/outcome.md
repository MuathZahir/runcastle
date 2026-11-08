# Outcome — Drive chats become workers

The Fix-drive chat and the scenario chat docked beside a test drive become workers of the feature, under the same two-level model as every other delegated agent.

- Shipped: 2026-11-08

## What shipped

17 commits · 83 files

- 5 tickets landed: #1 Drive workers: worker kinds, owner and host placement; #2 Drive workers: the drive buttons start and resume them, and they hand back quietly; #3 Drive workers: the drive's stop hands them back; #4 Drive chats: retire the drive-fix and scenario chat kinds; #5 Drive workers: the sidebar groups, the docked worker chat and old drive chats
- 0 waived
- 0 failed

## Review record

### Ticket 6 · review

- Reviewed commit: fbdfaa270d9d73d51278eb126dbccc68a5568e43
- Landed since: 0
- Outcome: done

- **Test gate failed: pty-bun "kills the whole tree" test, in code this branch does not touch** — dismissed
- **Project Scenarios worker's handback does not name main; only the agent's own text does** — fixed
- **Lead-chat handback card counts commits ("1 commit") rather than naming the commit** — open
- **Server-test and gate criteria not checked by this drive-mode pass** — open
- **Review captures came out blank and closed the walking browser** — open

## Notes record

- No human notes

## Per-ticket digests

### 1. Drive workers: worker kinds, owner and host placement

# Ticket 1 — Drive workers: worker kinds, owner and host placement

## What was done
- Core: `WorkerKind` gains `fix-drive` and `scenario`, and there is now a `DRIVE_WORKER_KINDS` list with `isDriveWorkerKind`. `WorkerRow.featureId` can be null, and rows gain `projectId`. A new pure helper, `workerFeatureId(w)`, gives the feature on paths only a feature's worker reaches, and throws for a worker owned by the project.
- Migration `0066_drive_workers.sql` (generated, then edited by hand) rebuilds `workers` and fills `project_id` by joining on `features`. It adds the `workers_project` index. Every place that inserts a worker row (service, tests, `.runcastle/scenarios/*`) now sets `projectId`. There is a new `listProjectWorkers`. `emitWorker` sends a project-owned worker's events to the project timeline.
- New `workers/drive.ts`:
  - `isHostWorker`: true for the drive review and both drive kinds.
  - `driveWorkerOf`.
  - `guardKindOf`: maps fix-drive → `drive-fix` and scenario → `scenario`. It is used by the edit, install and checkout guards in `routes/hooks.ts`.
  - `DRIVE_WORKER_REFUSAL`.
  - A **stub** `driveWorkerBriefing`, which ticket 2 fills in.
- In `service.ts`, these now use `isHostWorker`: `withWorkers`, the host-handback read in `workerTurnEnded`, `keepConversation` and `hasConversation`. The checks that belong to the review alone still use `isHostReview`.
- `acpLaunchInput` launches a drive worker in `project.repoPath` with `hostWorker` and `hostSidePosture`. A project-owned worker gets no feature. `resolvedThreadModel` puts drive workers on the `prepare` step.
- Slots: `workerTurnSlot` returns no slot for drive workers, and `queueHoldOf` never holds them.
- Refusals: `landWorker`, `sendBackWorker`, `dropWorker` and `messageWorker` refuse drive workers, and `workersHoldingReady` leaves them out. To keep the human's "Hand back" button working, `askWorkerToHandBack` now goes through a private `promptWorker`, which skips the refusal.
- MCP:
  - New audiences `fix-drive-worker` and `scenario-worker`, resolved by `sessionAudience(ctx, session)`.
  - They get the ticket's tool lists. Their own `hand_back` (`toolDriveWorkerHandBack`) writes the host handback file.
  - `toolRetryDrive` and `requireScenarioSession` accept the matching drive worker.
- Web: kind words and icons for the two new kinds, so its typecheck passes.

### Tests added
- `drive-workers-migration.test.ts`: an existing worker survives 0066 with `project_id` filled in, and a worker with no feature can be inserted.
- `drive-workers.test.ts`:
  - **Owner:** project versus feature listing.
  - **Host placement:** `isHostWorker`; the `acpLaunchInput` placement and posture on both runtimes; `withWorkers` routing.
  - **Slots:** no slot and no hold.
  - **Guards:** the hook route gives the same answer to a drive worker session as to today's `drive-fix` / `scenario` / `scenario-setup` chat, over 11 tool calls.
  - **MCP:** the audience tool lists, and the call-time kind checks.
  - **Hand back:** `hand_back` writes the handback file.
  - **Lead refusals:** all four refusals, and `workersHoldingReady`.
- New fixture `seedDriveWorker` in `test/helpers/fixtures.ts`.

## Surprises
- The `hasConversation` / `keepHostConversation` comment edits went wrong once (a line-number `sed` hit the wrong line). I fixed them, and typecheck caught it.
- `toolLoadLine` in `hooks.ts` used to read `toolsForAudience(session.kind)`. A drive review was therefore told to load the `worker` list. It now uses `sessionAudience`, so the drive review gets its `review` list as well. This changes behaviour slightly for the review.
- The migration's `INNER JOIN` drops any worker row whose feature no longer exists (`project_id` is NOT NULL). Deleting a feature already removes its workers, so this should drop nothing in practice.

## Things I added beyond the ticket
- A drive worker's account error does not set the queue hold (decision 7: "they fail on their own").
- `workerTurnEnded` now marks a drive worker that hands back as `handed-back` with its summary. It does not wake the lead and does not record commits. Without this, the host handback note would have been read and then lost.

## Left undone (later tickets)
- The real briefing and kickoff (ticket 2).
- Commits and branch in the handback, and the quiet lead card (decision 4).
- The drive-stop handback.
- The routes that create drive workers.
- `session-start` and the other project-scoped hook paths for a project-owned `worker` session (`projectScopedNoun('worker')`) are unchecked.
- No drive machinery changed (no new service, env var, seed or process), so `.runcastle/drive-*` needed no edit. Only the two `.runcastle/scenarios/*` seeds gained `projectId`. I checked that by typecheck only; I did not run them.

### 2. Drive workers: the drive buttons start and resume them, and they hand back quietly

# Ticket 2 — the drive buttons start and resume drive workers; their handback is quiet

## What was done
- `workers/drive.ts` gained `startDriveWorker(ctx, press)`. A press is either `{ kind: 'fix-drive', featureId }` or `{ kind: 'scenario', projectId, description?, fixFile? }`, rather than the `{ project, feature, ask }` shape the ticket sketched.
  - It keeps today's guards and refusal texts from `launchDriveFixSession` and `launchScenarioSession`.
  - It refuses while the owner's other drive worker is working ("Fix drive is working — wait for it to finish").
  - It finds the owner's latest worker of that kind (the feature's, or the project's when `featureId` is null), or creates one. A new one gets a `worker` session in `project.repoPath`, the `prepare`-step model, `startedBy: 'human'`, the label "Fix drive" / "Scenarios", and the purposes from the ticket.
  - It sets the worker working, records the driven branch in `featureBranch`, and redecides `scenario-setup` on every press. It calls `git.attachScenarioSession`, counts the press as the human writing (`humanWrote`), and sends the ask with a plain-words display summary.
  - A new conversation opens with today's kickoff line. A feature drive's Scenarios worker also gets the lead's latest turns, as today. The Fix-drive ask always includes the failure tail, so a process still running from an earlier drive sees the new failure too.
- The tRPC routes `feature.fixDrive` and `feature.openScenarioChat` now call it and return `{ sessionId, resumed }`. The old launch functions are still there but nothing calls them.
- `driveWorkerBriefing(ctx, w, row, project)` is now async. It is today's `renderDriveFixPrompt` / `renderScenarioPrompt` built from the live drive, plus a "You are a worker" section:
  - only the human talks to it;
  - what its guard lets it commit;
  - name the branch after every commit (with a base-branch warning on a project drive);
  - call `hand_back` when the human is done;
  - Fix drive only: hand back once `retry_drive` has the app answering again.

  If there is no drive, or no failure, the brief says so instead of throwing.
- Commit tracking: an in-memory tip of the driven branch, taken at the press and refreshed at each turn end. `workerTurnEnded` adds `base..tip` of the **driven branch** (not HEAD, so a checkout switched back is never counted) to the row's `handbackCommits` and `handbackFiles`, and emits `worker.committed`. The tally resets when a handed-back worker is pressed again.
- Handback: the worker becomes `handed-back`, never landed. `deliverDriveHandback` puts a card naming the branch, commits and files on the lead's chat through `deliverToLead` with `reason: 'news'`, so it is held. For a project-owned worker it goes to the newest project chat that has a conversation under way, held; with no such chat only the event is recorded.
- The handback display gained an optional `branch` (core `thread.ts`), and the web `HandbackCard` shows "· on <branch>".
- `updateWorker`, `emitWorker` and `setStatus` in `service.ts` are now exported for `drive.ts`.
- New test, `drive-worker-start.test.ts` (7 tests: real repo, real drives, fake ACP behind the real host):
  - Fix drive: the refusal; create, then resume in a later drive; the model and the first prompt; the briefing.
  - Scenario: create, with the `run_scenario` attach and the resume.
  - The busy refusal.
  - Commits and files recorded, and a held lead card with no turn started.
  - A project drive's worker is project-owned, and its held card goes to the project chat (needs a PTY, so not on Windows).

## Surprises
- `applyResumeCap` counts ended session rows of a kind. A worker's thread is one row for life, so I applied only the transcript-size half (`resumeCapExceeded` with `reentries: 0`). A worker past the cap is moved to Done (`worker.resume_capped`) and a fresh one starts.
- The needs-you ping (decision 8) comes from the feature-need watcher. It reads feature-owned workers only, so a project-owned Scenarios worker shows "needs you" but does not ping.

## Left undone
- The drive-stop handback and the refusal of messages between drives (later tickets). Commit bases live in memory, so a server restart loses the current turn's tally.
- Deleting `launchDriveFixSession` / `launchScenarioSession` and their tests (ticket 4).
- Drive machinery: no new service, env var, seed or process, so `.runcastle/` was not touched.

### 3. Drive workers: the drive's stop hands them back

## What was done
- `git.ts` gained a drive-ended listener registry (`onDriveEnded`, `DriveEnded`). Both stop paths (`testDrive` stop, after the checkout is back and the carried-changes notice; `projectDrive` stop) call it. `DriveStartOptions.retry` marks `retry_drive`'s stop (`toolRetryDrive` passes it), and the handler ignores retries.
- `workers/drive.ts`:
  - `handBackDriveWorkers` cancels each working/needs-you drive worker of the drive's owner (feature or project), records its last commits, and hands it back with the summary "The drive stopped." + its last agent message + the carried files its guard may write ("Left uncommitted"). It delivers the held card like a self-made handback.
  - `handBackOrphanedDriveWorkers` runs at boot for workers left working with no drive held.
  - `driveWorkerBetweenDrives` backs the refusal in `thread.send` ("starts with your next drive's <button> button"). It checks that the drive matches the owner and, for scenario, that `scenarioSessionId` matches.
- `index.ts` registers the listener and the boot hand-back (skipped on a copied database). `reconcile.ts` `carriesOn` skips drive workers, so they are not told to carry on.
- Tests (added to `drive-worker-start.test.ts`):
  - A feature drive stop hands back with commits and a left-uncommitted file, and the lead gets a held card.
  - A project drive stop goes to the project chat.
  - `retry_drive` leaves the Fix-drive worker working.
  - The between-drives refusal.
  - The boot hand-back.
- Typecheck is clean. Ran drive-worker-start, drive-state, drive-scenarios, review-worker and workers-life: all green.

## Surprises
- `__resetTestDriveState` now clears the listeners, so tests re-register in `beforeEach`.
- Hand-back of a worker the stop cancelled relies on `cancel` finishing before the handback is written. A turn-end event arriving later finds the worker already handed back and does nothing.

## Left undone
- A drive worker that handed itself back mid-drive can still be messaged by the human until the drive stops. Only "drive not running" refuses.
- A restart's hand-back lists no left-uncommitted files and no commits, because the in-memory commit bases are lost.
- `.runcastle/` drive machinery untouched (no new service, env var, seed or process).

### 4. Drive chats: retire the drive-fix and scenario chat kinds

Ticket 4 — retiring the drive-fix and scenario chat kinds.

What was done: Deleted `launchDriveFixSession` and `launchScenarioSession`, the `driveFix`/`scenario` fields on the launch input, their `renderBrief` branches, the `openingSummary` and `projectScopedNoun` cases, and the "Scenario chat" entry in `listFeatureSessions`. `acpLaunchInput` and the `thread.send` route now refuse `drive-fix` and `scenario` rows with the new `OLD_DRIVE_CHAT_READ_ONLY` (in `threads/launch.ts`). `threads/read.ts` maps both kinds to a new thread role, `old-drive-chat`. The MCP audience registry and the `toolRetryDrive` and `requireScenarioSession` checks now name only the drive workers. `packages/skills/packs/README.md` now says the drive's chats are workers. Tests: added one in `thread-router.test.ts` for the old rows' role, `thread.send` refusal and `acpLaunchInput` refusal. I cut the launch tests from `drive-fix-session.test.ts` and `scenario-session.test.ts` (`drive-worker-start.test.ts` covers launching), kept the retry, brief and guard assertions, and re-pointed the MCP audience tests at `fix-drive-worker` and `scenario-worker`. Typecheck passes. The targeted vitest files I ran pass (the one I changed, the files that grep for the old kinds, and a few neighbours); I did not run the whole suite.

Deviations and surprises:
- `guardKindOf` (ticket 1) still returns the strings `'drive-fix'` and `'scenario'` as the guard kind. The checkout and edit guards, and `guardsEdits`, still branch on those strings. I left that, because it is the drive-worker mapping and not a session kind. Renaming it would be a larger change than this ticket asked for.
- The `'drive-fix'` and `'scenario'` entries in the kickoff-line and entry-skill tables in `skills.ts` stay. `drive.ts` still uses `kickoffLineFor`, and the tables are exhaustive over `SessionKind`.
- An unrecognised audience registers every MCP tool, by design (see `registeredFor`), so an old-kind audience would see all tools. I made the tests that iterate audiences skip those kinds. Nothing can run an old row anyway.
- I kept `'scenario'` in the `ThreadEntry.role` union with a TODO for ticket 5, because `ProjectWorkspace.tsx`, `use-feature-chat-column.ts` and some web tests still name it. Nothing returns it now. I changed the one filter in `FeatureSidebar.tsx` to `'old-drive-chat'`.
- Some existing type errors in `drive-fix-session.test.ts` remain (`DriveFixBrief` and the `phase` field). Tests aren't covered by the server tsconfig.

Left undone: the web labels and read-only handling for "Old drive chat" (ticket 5). I did not touch `.runcastle/` — no new service, env var, seed or process.

### 5. Drive workers: the sidebar groups, the docked worker chat and old drive chats

# Ticket 5: drive workers in the web

## What was done
- **Old chats.** `WorkerEntry.oldSideChat: boolean` is now `old?: 'side' | 'drive'`. `lib/workers.ts` adds `OLD_CHAT_WORDS`, `oldChatOf(role)` and `oldChatEntry`. `featureWorkerEntries` puts `old-drive-chat` threads into Done as "Old drive chat". `WorkerInFront` has `{ kind: 'old-chat', old, thread }`, and `OldChatNote` replaces the composer of an old side or drive chat.
- **Feature sidebar.** The separate drive-chat list under the Lead card (`leadThreads`) is gone. Fix drive and Scenarios workers sit in Needs you / Working / Done by status.
- **Drive worker chat.**
  - The text under the composer reads "Your checkout · commits on <branch>".
  - A handed-back drive worker shows the closed note "Done for this drive", because it takes no messages between drives.
  - A project-owned worker's handed-back line says "the project chat".
  - Handback cards for drive kinds never show a Landed, Sent back or Dropped line. The branch line was already there.
- **The column.** The stand-in for the Scenarios worker is named "Scenarios", and `scenarioChatLabel` is deleted. Fix drive now brings its worker to the front through a new `front` call on the column context (`ScenarioChatContext`). A refused press shows the server's reason inline (`DriveButtonRefusal`) instead of in a toast.
- **Project drive.** I added `worker.listProject`. The router shares a `listed()` mapper between `list` and `listProject`, and `live.ts` invalidates both. In `ProjectWorkspace` the project's Scenarios worker is a `SidebarWorkerItem` in the Orchestrator card (never also a chat row), and it opens as a worker chat with the worker header.
- **Core.** Removed `'scenario'` from `ThreadEntry.role` (ticket 4's TODO). `sessionKindName` names old `drive-fix` and `scenario` rows "Old drive chat".
- **Scenario.** `.runcastle/scenarios/workers/feature-with-drive-workers.ts` seeds the state the ticket describes and prints `ENTRY_URL`. The lead's held card is a log prompt with `held: true`. It adds no held card to the project chat, because it seeds no project chat.
- **Tests.**
  - New tier 1 file `drive-worker-list.test.ts`: groups, lanes markup with no Chats list, and the old drive chat's read-only note.
  - `worker-cards`: the branch on the handback card, no Landed line, and the placement words.
  - `chat-column`: the drive worker's header and assignment card, the inline refusal, and the lanes plus closing the errand.
  - `project-drive-workspace`: the project worker row, its column, and New scenario docking it.
  - `dogfood-scenario.test.ts`: actually **runs** the new scenario and checks the rows. It passes.

## Surprises
- The "dock" on a feature drive is the chat column (design-mode decision 9), not a pane in the drive. I kept it that way.
- The web had no land, send back or drop controls, so the criterion that none show holds by construction.
- Two hand-rolled tRPC mocks (`project-drive-workspace`, `project-triage-launch`) needed `worker.listProject`.

## Left undone
- I took no screenshots: there is no browser in the sandbox, so the visual check against STYLE.md and DESIGN.md was not done.
- A Fix-drive worker that hands itself back mid-drive now shows "Done for this drive". The server still accepts messages to it until the drive stops (ticket 3's note).
- The project worker row always shows in the Orchestrator card, even when Done.
- I made no `.runcastle/` drive machinery changes; nothing new is needed.

`bun run typecheck` is clean. All the web test files I touched pass, along with neighbouring ones. I did not run the full suite.
