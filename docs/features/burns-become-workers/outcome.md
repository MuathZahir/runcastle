# Outcome — Burns become workers

Burn tickets, review tickets and conflict resolvers run as workers on the same runner as interactive ones: the human can step into any of them, their transcripts are kept, and the digest becomes the handback — with the burn engine's landing, retries and limit handling intact.

- Shipped: 2026-11-08

## What shipped

48 commits · 362 files

- 7 tickets landed: #7 Workers: recover by themselves from transient errors, stalls, restarts, account errors and landing conflicts; #8 Workers: warm sandboxes, the burn's working rules, CPU cap, test-suite guard and token counts; #9 Workers: the end-of-feature review runs as a Review worker; #10 Web: the live Work view and rounds leave the app; old tickets read as history; Stop stops workers; #11 History: freeze tickets, rounds and runs; get_work_record over workers; the upgrade note; #12 Server: delete the burn engine and every ticket and round writer; #14 Workers: tie off what the burn engine's deletion left behind
- 5 waived: #1 Workers: recover by themselves from transient errors, stalls, restarts and landing conflicts; #2 Workers: warm sandboxes, the burn's working rules, CPU cap, test-suite guard and token counts; #3 Workers: the end-of-feature review runs as a Review worker; #4 Web: retire the Work view, rounds and tickets from the app; #5 Server: delete the burn engine, tickets, rounds and runs
- 0 failed

## Review record

### Ticket 6 · review

- Reviewed commit: unknown
- Landed since: 7
- Outcome: cancelled

### Ticket 13 · review

- Reviewed commit: 6847fc44cb401a9a7d18a5dbb2b6eff4df9d6010
- Landed since: 0
- Outcome: done

### Ticket 15 · review

- Reviewed commit: 15c6cbc4925cdcf456d5702a6473e69dd2194fe5
- Landed since: 0
- Outcome: done

- **Test gate fails: pty-bun "kills the whole tree" — in terminal code this branch does not touch** — dismissed
- **The sandcastle name lingers after the engine's removal: vitest config, CONTEXT.md and the "Sandcastle image" row** — open

## Notes record

- No human notes

## Per-ticket digests

### 7. Workers: recover by themselves from transient errors, stalls, restarts, account errors and landing conflicts

# Ticket 7 — workers recover by themselves

**What was done.**
- **Error classifier.** The burner's error patterns moved into the new pure module `services/agent-errors.ts`. `classifyAgentError(text, runtime?)` returns `transient`, `fatal` or `account`; "prompt too long" and "context length exceeded" are now fatal. `classifyTicketRunError` in `ticket-burner.ts` is built on it. The burner keeps its own "usage limit" and missing-agent-binary checks as run-fatal, and re-exports `retryDelayMs`.
- **What the lifecycle hears.** The agent host now passes the turn's end (`TurnEnding {reason, error}`) to `lifecycle.turnEnded`, and has a new `humanPrompted` hook that fires on every human-sourced prompt.
- **Stall watchdog.** A new `AgentHostDeps.stallBounds` dep watches worker turns. It tracks the last output and the open tool calls. Silence past the silence bound with no call open, or one call open past the command ceiling, cancels the turn, which then ends as the error `stalled: …`. A turn waiting on an ask is never counted as stalled. The bounds are `WORKER_STALL` (10 min silence, 45 min per command), wired through `workerStallBounds()`.
- **Retry step.** `workerTurnEnded` re-prompts the same thread with a `[runcastle] … Carry on where you were.` line after a 5s/10s/20s backoff, up to 3 times. Each retry emits a `worker.retrying` event. The 4th transient error, or any fatal or account error, goes through `failWorker`, which wakes the lead once. Usage-limit errors are skipped, so they still follow `carryOnAfterLimit`. The attempt count is kept in memory and is reset by a clean turn end or a human message.
- **Account hold.** `agent-slots` gained `take/tryTake(runtime)`, `hold`, `holdOf` and `lift`. An account error holds that runtime's queue. The hold is set synchronously before `workerTurnEnded` first awaits, because the host frees the slot before the hook runs. An admitted turn re-checks the hold and goes back to waiting if needed. `worker.list` has a new `heldBy` field, and each held worker gets a `worker.queue_held` event. The lift happens in `humanWrote()`, called by the lifecycle's `humanPrompted`.
- **Restart.** `reconcile.ts carriesOn` now includes worker sessions whose row is working or queued.
- **Landing conflicts.** `landWorker` sends an on-its-own worker back on a conflict, up to 2 times. The count comes from `worker.sent_back` events with `conflict: true`, so no migration was needed. The message lists the conflicting files and the feature commits the worker lacks, and the result carries `sentBack: true`. Otherwise the lead gets both options. Every send-back (the lead's too) first runs a new engine method, `refreshFeatureBranch`, which fetches the feature tip into the worker's bare `origin.git`.
- **Tests.**
  - `agent-errors.test.ts`: classifier table and backoff.
  - `agent-slots.test.ts`: hold and lift.
  - `workers-recovery.test.ts`: retry in the same conversation; 4th transient fails with one lead wake; fatal fails at once; usage limit not retried; account hold with `heldBy` and lift on a human message; silence stall; command-ceiling stall; conflict send-back ×2 then to the lead; with-you goes straight to the lead; a real-git check that the refreshed bare copy can be merged inside a clone.
  - `restart-carry-on.test.ts`: workers case added.
- I also added `heldBy: null` to the web `chat-column` test fixture so the typecheck passes.

**Surprises.** The host releases a turn's slot before the lifecycle hook runs. That is why the account hold has to be set synchronously and the admitted turn re-checks it. No column was needed for the conflict count; it is read off events.

**Left undone.**
- If an agent ignores the stall cancel, the turn still hangs (there is no kill escalation).
- The web does not yet show `heldBy`.
- No drive machinery changed: no new service, env var or seed, so nothing to check there.
- The project-wide typecheck passes, and the targeted test files pass.

### 8. Workers: warm sandboxes, the burn's working rules, CPU cap, test-suite guard and token counts

# Ticket 8 — warm worker sandboxes, working rules, CPU cap, guard, tokens

**What was done.**
- Moved `burn-guard`, `burn-image`, `burn-cache` and `burn-user` from `workflows/` to `workers/`. The burner and every other importer, including the tests, now point at the new paths.
- Added a new engine method, `SandboxEngine.prepare` (`workers/prepare.ts`). `startWorker` calls it before `create`, inside the existing failed-start `try`. `prepare` runs `ensureBurnImage`, whose ctx type is now a narrow `BurnImageCtx`, and then `ensureBurnCacheVolume` when `burnCache` is `volume`. A build failure throws, so the worker goes `failed` and the start raises a `GateError`. The image is re-resolved after the build, because it may have adopted a new project image.
- **Cache.** I chose the second option from the ticket: the worker installs against the warm package-manager store on the project's cache volume. I did not copy a warm slot's `node_modules`, so no slot is ever claimed, held or copied from.
  - The volume is mounted at `/home/agent/cache` with `burnCacheEnv(pm)`.
  - pnpm gets no store env, because the clone is not on the volume and pnpm could not hardlink out of it (ADR-0004).
  - `burnCache: off` mounts nothing, so installs run cold. The old `runcastle-worker-cache` volume and `IN.cache` are gone.
- The install is unchanged, and the project's `setupCommand` now runs after it (a `projectSetupScript` step). `--cpus <burnCpus>` is passed when set.
- **Guard.** `copyWorkerSetup` takes `{guard}`. For a Claude Code worker with `burnGuard` on, it writes the guard script and merges a PreToolUse hook into the sandbox's `settings.json` after the copy and before the fingerprint. It is a merge rather than `buildGuardInstallCommand`'s overwrite, so the copied `permissions.defaultMode` and the other copied settings stay. The setup fingerprint gains `-guard`, so flipping the setting re-copies. Codex gets no guard.
- The briefing gains the check rule.
- **Conversation and tokens.**
  - New `workers.tokens` column (migration `0064_worker_tokens`), exposed on `WorkerRow`. I added no breakdown column: only the total is needed.
  - `keepConversation` finds the agent's file through the new engine method `conversationPath`. It copies it to `sessionDir(id)/agent-conversation.jsonl` with `copyOut`, reads the total with `readTranscriptUsage` and records it. It runs in `retireWorker` (drop and feature cleanup) before `remove`.
  - A landed worker keeps its sandbox until feature cleanup, so I did not add a copy to `landWorker`; cleanup keeps it.
  - `promoteOutcomeDoc` calls `keepFeatureConversations` first. The merge writes `outcome.md` before the sandboxes are removed, and the tokens would not be on the rows yet otherwise.
  - `outcome.md` gets a `## Workers` section with each worker's label, kind, outcome and tokens. Old ticket lines are untouched.
  - A failure to keep the file emits `worker.conversation_unkept` and never blocks removal.
- **Tests.** New `workers-warm.test.ts`:
  - start order (`prepare` before `create`) and the failed start;
  - cache, CPU and setup inputs for bun, pnpm and cache off;
  - the `runArgs` command line;
  - the guard flag with `burnGuard` on and off, and the merge script;
  - the briefing rule;
  - copy-out before remove, with the tokens recorded;
  - a missing conversation file;
  - the outcome's workers line.
  
  Also updated the fake engine and the two `workers-sandbox` assertions. I ran the worker, burn, outcome and migration test files, and `bun run typecheck` is clean.

**Surprises.**
- `ensureBurnImage` needed only five fields of `WorkflowCtx`, so I narrowed its type rather than faking a whole workflow ctx.
- The server's typecheck does not cover `test/`, so the fake engine needed hand-updating.
- Vitest must be run from the repo root, not `packages/server`.

**Left undone.**
- **Timings:** no before/after start timings. This sandbox has no container engine, so I could not measure either option, and I kept the warm-store install without a measurement.
- **Guard not exercised in a container:** the guard install script ran only as generated text.
- **Cache off:** it mounts nothing, where ADR-0004's host bind mount would warm bun, npm and yarn. I left that out as scope.
- **ADRs:** 0004, 0005, 0008 and 0018 are not amended; the spec leaves that to a later ticket.
- **`workers/` imports `workflows/ticket-burner`:** `service.ts` takes `detectPackageManager` and `readRepoToolchain` from it, and `burn-cache.ts` takes the `PackageManager` type. The ticket that deletes the burner must move those helpers.
- **Claude subagent transcripts** are not copied out, so the token count covers the main conversation file only.
- **No drive-machinery change:** nothing new for the dev environment to run, so I did not touch `.runcastle/`.

### 9. Workers: the end-of-feature review runs as a Review worker

# Ticket 9: the end-of-feature review runs as a Review worker

## What was done

**The worker kind.**
- Added a new worker kind, `review`. Its row has two new fields:
  - `reviewMode`: `drive` or `gates`.
  - `reviewVerify`: the finding ids and fix commits a verify review is given.
- The label is "Review", or "Review: verify" for a verify review.
- The lead starts one with a new tool, `start_review({ mode?, verify?, model? })`. I chose a separate tool over a review kind on `start_worker`.
- When the lead gives no mode, it is drive if the host can drive the project (same check as `driveWithheldReason`), and gates otherwise. Asking for drive on a host that cannot drive is refused.

**Drive review** (the code is in `workers/review.ts` plus the worker service).
- It has no sandbox. It is a host thread whose working directory is `project.repoPath`.
- It starts `queued`. Runcastle starts the review drive itself, through a seam (`ReviewDriveHost`) that tests replace:
  - While another drive holds the slot, it waits and asks again every 15s.
  - A refusal that waiting cannot clear (for example a dirty tree) fails the worker.
- It gives the slot back, and reaps the recorder, when it hands back, fails, is dropped, its process stops, or its turn is cancelled. If sent back, it takes the slot again before the prompt goes in.
- Its MCP audience is a new `review` audience: `review_drive`, `report_finding`, a review-specific `hand_back` (it writes a file the turn-end reads), `show_file`, `get_feature_context` and `read_feature_doc`.
- The `review_drive` and `report_finding` paths now accept a host review as well as the old run header (`requireReviewer`).

**Gates review.**
- It is an ordinary sandboxed worker. The feature's base branch is also copied into its bare origin (new `baseBranch` field on `NewSandboxInput`), so it can diff against the base.
- `report_finding` is added to the in-sandbox MCP script when `RUNCASTLE_WORKER_REVIEW=1`, and is answered over the relay.

**Findings.**
- `review_findings` gained `review_worker_id`, and `review_ticket_id` is now nullable. This is migration 0065. Drizzle's generated INSERT selected a column that did not exist yet, so I changed it by hand to select `NULL`.
- `reportFinding` takes either a review ticket or a review worker. It mints no fix tickets.

**Handback and the Review Package.**
- On handback the lead gets a new prompt display, `{ reviewPackage: { workerId, label } }`. The web draws it as the existing `ReviewPackageItem`, in place of the plain handback card. The text the lead reads lists the findings and the next steps (`resolve_finding`, then `start_review({ verify })`).
- `services/review-package.ts` now works over a `ReviewPass`, which is either a review ticket or a review worker. The package, shot, walkthrough and artifacts routes, `reviewShots`, `show_review_package` and `get_feature_context`'s `reviewEvidence` (a new worker variant) all read both kinds.

**Other changes.**
- Landing a review is refused. A review that has handed back does not block `declare_ready`.
- The assignments are new templates in `packages/skills/review/`: `review.md`, `review-drive.md`, `review-gates.md` and `verify.md`. They are adapted from the burner's templates: the reviewer runs the project's `verifyCommands` itself, with the `knownFailures` baseline subtracted. The old templates in `burner/` are untouched because the old path still uses them. `build-package.ts` now ships the new directory.
- `review-capture.ts` and `recorder-reap.ts` moved to `services/`.
- The lead's skill text (`SKILL.md`, `references/workers.md`, `references/preview.md`) now describes the Review worker and the verify review. The tests for that wording were updated.
- On the web: the Review kind has an icon and words, the composer meta line says where the review runs, and a Review worker's package header shows no "Ticket #".
- The scenario `.runcastle/scenarios/review/feature-at-review.ts` now seeds a drive review that has handed back, with two findings, one screenshot and the package card, and the feature declared ready.

**Tests.**
- New `test/review-worker.test.ts`:
  - A drive review waits queued, runs on the host, gives the slot back and posts its package.
  - A drive review gives the slot back when dropped or stopped, and fails when the drive cannot start.
  - A gates review is sandboxed and its `report_finding` goes through the relay.
  - A drive review is refused where the host cannot drive.
  - A verify review's assignment carries only the findings and commits it was given.
  - `resolve_finding` closes a worker's finding.
- Updated: the MCP audience assertions (in `mcp-tools` and `chat-contract`), the feature and preview skill tests, the dogfood scenario test, and the web tests (`worker-cards`, `review-package`).
- `bun run typecheck` is clean. 84 server test files around the change pass.

## Surprises

- The old `review_drive` description test requires the word "stop", so the description keeps it.
- The fake ACP agent ends a cancelled turn as `end_turn` unless its script returns `'cancelled'`.
- Making a pass's `seq` nullable spread into the web review helpers (`latestReview`, `ReviewPassFigure`).
- `_fixtures/` holds a sample project and no images, so the scenario embeds a 1×1 PNG instead of reusing a fixture.

## Left undone

- **Drive helpers still in `workflows/`.** `probeDriveHost`, `driveWithheldReason`, `buildDriveInstructions` and `buildScenarioBlock` are imported from `workflows/review-ticket.ts`. The ticket that deletes `workflows/` must move them first. I could not move them: the guard blocked the multi-range shell move.
- **Queued drive reviews and restarts.** A queued drive review's wait timer does not survive a server restart; nothing re-arms it at boot.
- **Restarts generally.** The review drive's slot state is in memory, so a restart cuts the drive off.
- **Feature Stop.** Decision 15's feature-wide Stop of workers is not built yet, so only a per-thread stop gives the drive back.
- **No token count for drive reviews.** A host review keeps no copied conversation file, so its tokens are not counted.
- **Gates review scope.** It still offers `start_dev_server` and `park_feature`.
- **Orchestrator skill.** `project/SKILL.md` and `rounds.md`/`tickets.md` still speak of the review round; those belong to later tickets.
- **Drive machinery.** It needed no change: there is no new service, env var or process. I did not run the drive scripts.

### 10. Web: the live Work view and rounds leave the app; old tickets read as history; Stop stops workers

# Ticket 10: the live Work view leaves the app; old tickets read as History; Stop stops workers

## What was done

**Stop (server, decision 15).**
- `stopFeature` now does four things:
  - It cancels every working or queued worker's turn, through the new `stopFeatureWorkers` in `workers/service.ts`. That also clears a pending transient retry and a drive review's wait for the drive slot. Each of those workers is marked `needs-you` and stays enterable.
  - It cancels the turn of each of the feature's `chat` threads, which ends the lead's turn.
  - It still stops any old running round.
  - The Stop note to the lead is now `news`: it rides the human's reply and wakes nothing.
- Until the human replies, `requireNotStopped` (exported from `services/features.ts`) refuses the lead's `start_worker`, `start_review`, `message_worker` and `send_back_worker`.
- The thread host had a gap: `cancel` did nothing to a turn still waiting for its agent slot, so a queued worker would start once the slot freed. Such a turn now ends `cancelled` without reaching its agent (`endWaitingTurn` in `threads/host.ts`).
- Tests:
  - New, in `workers-life.test.ts`: Stop cancels a working and a queued worker; the queued one never reaches its agent; both stay open; lead tools are refused until `markHumanMessage`.
  - Two `lead-delivery` tests that encoded "the lead hears Stop at its turn end" now assert the turn is cancelled and the note is held.

**Web.**
- The panel's Tickets view (`work`) is now a read-only **History** view (`components/bodies/history/HistoryView.tsx`). It shows:
  - each round folded to one line;
  - each ticket's status, goal and digest;
  - a review ticket's findings;
  - "Never run" tickets.
- It is offered only when the feature has tickets, as before. It uses `<details>`, so there are no buttons. A new tier-1 test is in `history-view.test.ts`, and `feature-page.test.ts` covers that History appears only with tickets and has no ticket actions.
- Deleted:
  - `TicketsView`, `TicketEditor`, `ModelMenu`, `run/LaneTranscript`;
  - `lib/feature-ui/run.ts` and `rounds.ts`;
  - `ticketConflictKickoff`, `ticketDurations`, `ticketModelChip`, `pendingTickets`;
  - the dead `openBurnSettings` action;
  - `emit_tickets` opening Work on trust;
  - each deletion's tests.
- The status line no longer reads rounds. It takes `workersWorking`, the count of working or queued workers from `worker.list`. While workers work it reads "Working · N workers at work" with Stop as its primary. The merge dialog's "a round is running" warning became a workers-at-work warning. The Stop dialog's words changed to match.

**Settings (decision 18).**
- The "Workers" page is now **Sandboxes**: page id `sandboxes`, file `SandboxesPage.tsx`, test `settings-sandboxes.test.tsx`.
- It keeps the image and cache checklist, "Agents working at once" and the CPU limit, worded for workers.
- `burnMaxIterations`, `burnAttempts`, `burnConflictAttempts` and the `sandbox` on/off select render on no page (`RETIRED_KEYS` in `lib/settings.ts`).
- Server fix strings now say "Settings → Sandboxes". The link regex still accepts Workers, Burns and AFK burns.

## Surprises

- `burnGuard` was never on the settings page; it is config-only. I added no UI for it.
- Burn workspace mode was never in the web either.

## grep survivors (`ticket`, `round`, `run.`, `burn` in apps/web/src)

- **History view, Review Package, findings and old-review helpers** (`review.ts`, `review-package`, `ReviewPackagePage` "Round N"/"Ticket #"): these are history and old reviews.
- **The `work` view id:** kept so addresses stay stable. It is labelled History.
- **Remaining ticket counts:** `landedShare`, `ticketCount`, `ticketCountText`, and the sidebar progress pie read the frozen tickets.
- **Comments and decision slugs** (`the-feature-lead-runs-rounds`), and the burn-cache names, which the server still uses.
- **Still live, left for the ticket that deletes the burn engine and the round tools:**
  - `chat-notices.ts` still maps `tickets.*`, `ticket.failed` and `run.finished` events to "View round" cards.
  - `live.ts` still invalidates `feature.rounds`.
  - `ProjectCard`'s "A round is in flight" message.
  - `SendToAgent`'s "can't start a round".
  - `standing-notices` review-round wording.
  - The dead `statusProperties`/`burnProperty` in `review.ts`.
  - The glossary's "round" entry.

## Left undone

- `packages/core` `feature-need` needed no change.
- Drive machinery: no new service, env var or process, so it needed no edit. I did not run the drive scripts.

### 11. History: freeze tickets, rounds and runs; get_work_record over workers; the upgrade note

## What was done
- `get_work_record` now lists each feature's workers (label, kind, goal, doneWhen, status, handback summary, files changed, commits, tokens) next to the old runs and tickets. A feature with no workers has no `workers` key, so old features read as before. The seam lookup also matches a worker whose changed files, goal or done-when contain the text. Under the read ceiling, worker summaries are moved out whole (`summaryNotInlined`) after the ticket digests. The tool descriptions and `routing.md` say "seams or files changed, workers or tickets".
- The worker row already kept `handbackFiles`, `handbackCommits` and `handbackSummary` after landing, so no migration was needed.
- The project index line shows `[in flight: 2 working, 1 queued, 1 needs you]` from the worker rows. `FeatureListItem.activeRun` and `ticketCounts` were left in place because the web still reads them. `featureStatusView` (`get_feature_context`) still reports `roundRunning` and `ticketCounts`.
- `services/outcome.ts` writes no ticket-count lines for a feature without implementation tickets. Old features still list their tickets and digests.
- New `services/upgrade-note.ts`, called from `index.ts` at boot. For each active feature with implementation tickets that are pending, burning or failed, it holds one note on the lead's thread (`prompt` with `hold: true`, which wakes nothing) naming each ticket's seq, title and goal. It records an `tickets.upgrade_note` event on the feature as the run-once marker. No new table or setting was needed. A feature whose lead has no conversation yet is skipped and tried at a later boot.
- Tests: `upgrade-note.test.ts` (held once, a second run adds none, finished and shipped features get nothing, nothing sent). In `project-mcp-tools.test.ts`: workers by slug, seam match on changed file and assignment, the old ticket seam path, the ceiling, and the index line. `outcome.test.ts` covers a worker-only feature. The old index-line assertion changed from "2 pending" to "[in flight]". All 42 pass, and `bun run typecheck` is clean.

## Surprises
- Nothing in the data model blocked this.
- The upgrade note's "once" is tracked per feature by event. A ticket created after that first note, before the next ticket deletes the machinery, would not get a second note.

## Left undone
- **Freeze guard not added.** Guarding `storeTickets`, `updateTicket` and the run writers would break the still-live burner and its tests. The next ticket deletes all writers, so the freeze is by deletion.
- The review record in the outcome still prints "No completed review pass" for worker-only features. It does not list the Review worker's findings, which are keyed by worker.
- No drive-machinery change was needed, and none was run.

### 12. Server: delete the burn engine and every ticket and round writer

# Ticket 12 — delete the burn engine and every ticket and round writer

## What was done
- Deleted `packages/server/src/workflows/` whole (ticket burner, review ticket/gates, gate reuse, kill registry, run reconcile, runner, registry, cache probe, sandcastle typings), `@ai-hero/sandcastle` and its patch (`bun.lock` regenerated, root `patchedDependencies` gone), the `ticket` and `run` tRPC routers (the web only calls `feature.rounds` and `docs.read`; `docs.digestSize` went too), `scripts/smoke.ts` and `scripts/burn-cache-probe.ts`, and `core/src/workflow.ts`.
- Survivors moved out first: `services/repo-toolchain.ts` (env parsing, package-manager detection) and `services/drive-host.ts` (drive probe, withheld-drive record, drive instruction and scenario blocks).
- Tickets, rounds and runs are frozen: `services/tickets.ts` and `services/runs.ts` keep reads only; `freezeStaleRuns` (boot, in `runs.ts`) closes a run the old server left `running` so the "run in progress" guards cannot wedge. `storeTickets`/`updateTicket` for tests live in `test/helpers/tickets.ts`.
- MCP: removed `emit_tickets`, `update_ticket`, `cancel_ticket`, `list_tickets`, `get_ticket`, `dispatch_round`, `stop_round` and the docs-checkpoint helper. `get_feature_context` has no rounds, runs, ticket rows or `burnConcurrency` (review evidence is the Review worker's only); the orchestrator's status view reports `workerCounts` instead of `roundRunning`/`ticketCounts`/review verdict. `declare_ready` returns no warnings. Allow rules, lead brief and edit-guard texts, the feature-state line ("Working · N workers at work"), hook context and the kickoff header lost their ticket/round wording.
- Config: removed `burnMaxIterations`, `burnAttempts`, `burnConflictAttempts`, `burnWorkspace` and `noSandbox` (`sandbox` now `.catch('docker')`, so old files load; a core test pins it); settings service/web follow.
- Skills: deleted `packages/skills/burner/`, `references/tickets.md` and `rounds.md` (the scenario guidance moved into `workers.md`), and scrubbed qa, project, code-review, planning-alone, design and the READMEs. ADR-0020 written; ADRs 0002/0003/0006/0007/0011 say superseded, 0004/0005/0008/0018 amended. CLAUDE.md rows updated.
- Also removed now-dead code the deletion exposed: `buildFixTicket`/fix-lifecycle helpers in `review-findings.ts`, `composeRoundWake`, sandcastle worktree and ticket-attempt helpers in `git.ts`, two chat-branch functions, `agent-stream.ts`, `addTicketTokens`.
- Tests: deleted the burn/ticket/round/gate/kill/runner tests (~35 files) and rewrote the rest for the new shapes (MCP audience, chat contract, ceiling, repeat-reads, skill texts, config). Full `bun run test`: 5151 passed, 1 failed; `bun run typecheck` clean.

## Surprises
- `pty-bun.test.ts` ("kills the whole tree, the grandchild behind the shell included") fails; `src/pty` is untouched by this branch, so it is environmental (process-group kill in this sandbox), not mine.
- Lost with the burner, deliberately not rebuilt: the burner's "worker cache volume not writable" / image-UID refusal rewording and its setup-failure cause leading (`burnCacheDeniedMessage`, `leadWithCause`). Workers do not have equivalents.
- Not drive machinery: no new service, env var or process; `.runcastle/drive-setup.ts` still points at `src/assets/sandcastle`, which exists. I did not run the drive scripts.

## Left undone / survivors of the closing grep
- The legacy `run` MCP audience and run-identity header (`X-Runcastle-Run`, `requireRunIdentity`, `review_drive`/`report_finding` for a run) stay: nothing can create a live run now, but removing it means reworking the review-wires tests. Next ticket candidate.
- Web leftovers from ticket 10 (chat-notices "View round" cards for old `tickets.*`/`run.finished` events, `ProjectCard`/`SendToAgent` round wording, the `transcript` live signal) are untouched; they read old events.
- Survivors of `git grep sandcastle|ticket-burner|dispatch_round|emit_tickets`: `sandcastle:runcastle` is the image tag and `.sandcastle/`, `assets/sandcastle`, `sandcastle-template`, `RUNCASTLE_SANDCASTLE_TEMPLATE`, `sandcastle-image` are the image-build template and probe id (ADR-0018, still live); CONTEXT.md, docs/SPEC.md, docs/research/*, docs/features/* and ADR bodies are history (CONTEXT.md is only the project session's to edit); comments in core/doctor/git/sandbox-image and old-event web fixtures name the retired engine as history; `services/runs.ts` keeps the string `'ticket-burner'` to tell old rounds from other runs; the preview data and web tests keep it as old-run fixtures.

### 14. Workers: tie off what the burn engine's deletion left behind

# Ticket 14 — tie off what the burn engine's deletion left behind

## What was done
- **Run identity gone.** Removed the `run` MCP audience, the `X-Runcastle-Run` header (`RUN_HEADER`, `renderRunMcpConfig`), `requireRunIdentity`/`resolveRunIdentity`, the withheld-drive map in drive-host, and `add_test_note` (only a run could reach it; its audience was already empty). `review_drive` / `report_finding` now answer a host drive review alone (`requireReviewer`); a gates review still reports over its sandbox relay. `resolveFeatureReader` takes a session. Tests: review-wires is rewritten around a seeded host Review worker (new `seedHostReview` fixture); drive-scenarios, drive-per-project, mcp-tools, repeat-reads and several audience tests now use `review` where they used `run`.
- **Outcome.** `composeOutcomeDoc` lists each Review worker: label, mode (`drive`/`gates`, `, verify`), its outcome, the verified fix commits for a verify review, and every finding with kind, severity, status and resolution note. "No completed review pass" shows only when there is neither a review ticket nor a Review worker. The workers have no reviewed-commit column, so that line is not printed for them. Test in outcome.test.ts.
- **Held queue.** `workerStatusWhy` gives "held: <reason>" for a queued worker with `heldBy`. The sidebar row reads "Queued · held: …" and so does the chat header status line. Tier-1 test in `apps/web/test/worker-held.test.ts`.
- **Queued drive review after a restart.** `driveThenPrompt` writes the prompt it is waiting to send to `drive-wait.txt` beside the thread log. At boot, `resumeDriveReviewWaits` in index.ts (skipped on a copied database) re-arms the wait for every queued drive review that wasn't cut off mid-turn. Test in review-worker.test.ts.
- **Stall escalation.** After a stall's cancel, the host arms a kill timer (`StallBounds.killGraceMs`, default `STALL_KILL_GRACE_MS` = 60s). If the turn hasn't ended by then, it kills the process, logs the turn as the stall error and calls `turnEnded` and then `stopped` with the new StopReason `'stalled'`. The worker retry step then re-prompts, and `session/load` resumes the conversation. Test in workers-recovery.test.ts, with a fake agent that ignores the cancel.
- **Drive review tokens.** `keepConversation` handles a host review: it reads the session's `transcriptPath`, or Claude Code's file under `CLAUDE_CONFIG_DIR/projects/*/<id>.jsonl` (new `claudeTranscriptPath`), copies it to `agent-conversation.jsonl` and records tokens. This runs at handback, at drop/retire and from `keepFeatureConversations`. Test in review-worker.test.ts.
- **Web wording.** Old `tickets.*`, `ticket.failed` and `run.finished` events become one "Ticket history" note with a "View history" button that opens the `work` view. The `tickets` prop of FeatureNoticeDeck is gone. Other removals: ProjectCard's round-in-flight refusal, SendToAgent's "start a round", the review-round wording in standing-notices, the dead `statusProperties`/`burnProperty` (and its test), the unused `BURN_EXPLAINER`, the unused `ticketProgress`, the `feature.rounds` invalidation (rounds are frozen) and NoteRow's dead `onViewLane` link. The glossary's ticket/round entries now read as history, and `review-round` became `review`.
- **`FeatureListItem.activeRun` is now `workersWorking`** (working + queued workers, from `workersWorkingByFeature`). It drives the row chip, the triage lane, "Working · N workers", and the project stats (`activeRuns` is now `working`). `ticketCounts` stays for the progress pie and History. Test in feature-list.test.ts.
- Beyond the list, two live texts were also fixed: the lead's handback state line said "no rounds yet" (it now says "N workers at work"), and the merge dialog showed an amber "no tickets built" for every worker-built feature (that row is now omitted when a feature has no tickets).

## Grep survivors in apps/web/src
- `round`: HistoryView and ReviewPackagePage's `Round n` (they render the frozen history), glossary `round` (a history entry), chat-notices and live.ts comments about frozen history, comments citing the feature slug `the-feature-lead-runs-rounds`, and FeatureChat's "no ticket or round of any kind" (a history check).
- `run.`: activity.ts colours old `run.finished` events in the activity log, and chat-notices maps them to history. Neither offers an action.

## Surprises
- Tests are not typechecked by `tsc -p packages/server`, so stale `'run'` audiences only showed up as test failures. They were in workers, push, show-file and other test files.
- A host review's session may never record a `transcriptPath`, so the Claude projects lookup is the fallback.

## Left undone
- Server-side `hasActiveRun` still guards `testDrive` (`active_run`), chat-branch, feature-worktrees, feature-need's `agentWorking`, and `closeProject`'s `projectHasActiveRun`. All of these read only frozen runs, and `freezeStaleRuns` closes any left running, so they never fire. They should be removed in a follow-up.
- A drive review cut off mid-turn by a restart gets the carry-on prompt without its drive. It has to call `review_drive start` again.
- `DECK_CAP` (4) can no longer be reached, because only four notice kinds remain.
- I checked the drive machinery: no new service, env var, seed or process, so nothing to update.

Verification: `bun run typecheck` passes. The full `env -u GIT_ASKPASS bun run test` ran with one failure I fixed afterwards (push.test's `run` audience, rerun green), plus the known environmental `pty-bun` "kills the whole tree" failure.
