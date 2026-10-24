# Outcome — Tickets and review are tools, not phases

A feature is one agent with tools — edit code, make tickets, run rounds, run a review, open panels — and no Go button: rounds start from the chat once the human says yes, and the feature's status comes from what is actually happening.

- Shipped: 2026-10-24
- Laps run: 1

## What shipped

28 commits · 292 files

### Lap 1
- 7 tickets landed: #1 Rounds: the chat starts rounds with no Go; #2 Skills: write the one feature-lead skill; #3 Launcher: every feature chat is the lead from its first message; #4 Feature page: status from facts and the Plan / Work / Review / Details panel; #5 Sidebar: Needs you from facts and the ticket-progress glyph; #6 Drive notes: jot and send to the agent, nothing more; #7 Data: phases and laps leave the schema
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 3bd8cabb34fbc9a0eaec1adef5f03f5345121f1e
- Landed since: 0
- Outcome: done

- **A feature declared ready from its open chat shows "Waiting on you" in the sidebar, never "Ready to test"** — fixed
- **The sidebar still says "Building · 0/1" on a feature whose round is running** — fixed
- **Header says "Waiting for you · round N failed/done" while the sidebar files the same feature as "In progress"** — fixed
- **The Create menu still describes New chat as "Features and quick changes alike"** — fixed
- **Header reads "Working · Round 1" while the agent talks, before any round has ever run** — fixed
- **Failed tickets in Work still offer the human Retry / Retry on… / Retry fresh / Waive** — open
- **The criterion about what the diff removes was checked only where it shows in the app** — open
- **Drive quirk: existing demo features cannot resume their chat because the real install's worktree holds their branch** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Rounds: the chat starts rounds with no Go

# Ticket 1 — Rounds: the chat starts rounds with no Go

## What was done
- `dispatchRound` no longer refuses in planning. It refuses a shipped feature by `status === 'shipped'`. Every other refusal is unchanged.
- `declareReady` takes only `{ scenario }` and refuses only a draft or a shipped feature. It writes `''` into the NOT NULL `whatToTest` column, never touches the phase, and sets `waitingReason = 'ready to test'`. The "nothing has reviewed" warning is gone from `readyWarnings`; the "last round had failures" warning stays.
- The `declare_ready` MCP tool now returns `{ ok, waitingReason, warnings }` instead of `{ ok, phase, warnings }`.
- `emit_tickets` emits `panel.show {view:'work'}` after storing. It uses a new `emitPanelShow` helper, which `toolShowPanel` now shares.
- `PanelView` is now `plan | work | review | details | design | drive`, and the tool descriptions are rewritten.
- Deleted:
  - `quickChange` and its helpers, plus `emitTicketShapeWarnings`, which only `quickChange` used;
  - the tRPC `feature.quickChange` procedure;
  - `complete_phase` (registration, handler and audience entry) and `markTicketsReady`;
  - `go_feature` / `toolGoFeature`;
  - `create_feature`'s `tickets` parameter (`oneLiner` is now required in its schema);
  - the planning relay in `send_to_feature`, which now always calls `deliverToLead`.
- Removed the "no review ticket" warning from `burnWarnings`. Its only live caller had been `complete_phase`; the web's burn path uses `goWarnings`.
- Updated `scripts/smoke.ts` and `scripts/prove-lead-wake.ts`: no Go, no `complete_phase`, scenario-only `declare_ready`, and they assert the waiting reason.
- Tests: deleted `quick-change.test.ts` and `planning-steps.test.ts`, which tested only removed behaviour. Added seam tests in `lead-mcp-tools`, `feature-lead-rounds`, `mcp-tools` and `project-mcp-tools`.
- Final state: `bun run typecheck` passes, and the full `bun run test` shows 0 failures (370 files passed).

## Surprises
- The baseline counts in the prompt (118 files / 1768 tests) don't match this repo (372 files / 5196 tests). Either way, nothing failed.
- `registeredFor` registers every tool for an unknown audience. Deleting the audience entries alone would not have retired the tools, so the registration code itself had to go.

## Left undone (other tickets' territory)
- `burnWarnings` now has no caller in `src` (only its tests use it).
- `services/planning.ts` (`PLANNING_STEP_EVENT`) has lost its MCP caller.
- `go()`, `goWarnings`, `burn()` and `agenticReview()` stay, as the ticket said.
- These still mention `complete_phase`: the launcher artifacts (including the allow rule `mcp__runcastle__complete_phase`), `lead-prompt.ts`, and the comment in `trpc/routers/ticket.ts` about the quick-change door.
- Web still reads `whatToTest`.
- No drive machinery change was needed: no new service, env var, seed or process. I did not run the drive scripts.

#### 3. Launcher: every feature chat is the lead from its first message

# Ticket 3 — every feature chat is the lead from its first message

**What was done.**
- **Skills.** Deleted the ideate, lead, spec, tickets, revisit and design skills. `ENTRY_SKILLS` is now `['feature','qa','project','prepare']` and `entrySkillsFor('chat')` returns `['feature']`.
- **One kickoff.** `chatKickoffFor(runtime)` gives a single line: "Proceed with your task: invoke <feature> and continue this feature." `ChatOpening` and `PLANNING_WITHOUT_A_HUMAN` are gone. A new `FEATURE_SKILL` constant and a new `PLANNING_ALONE = 'references/planning-alone.md'` replace them.
- **Other kickoffs.** The self-plan, relay and Go-wake texts and `leadWakeKickoff` now name the feature skill. `leadWakeKickoff` gained a `runtime` first argument. `sideKickoffFor` no longer mentions Go.
- **One brief.** In `artifacts.ts`, `renderSystemPrompt(feature, kind, purpose?, runtime?, headless?)` renders one brief for every chat. The `planning` parameter is gone.
  - Each errand (self-plan, relay, resolve-conflict) adds one sentence (`purposeLine`).
  - Any unattended run gets one shared "No human is present" section (`headlessRule`). A self-plan run always counts as unattended.
  - Removed: `chatOpening`, the revisit and lead renderers, `noCodeRule`, `designRule`, `conflictResolutionRule`, and every "Current phase" line.
- **Guards and permissions.** `isUnguardedLead(kind)` is true for `chat` and `side`, and `isUnguardedChat` is gone. `featurePhase` is removed from the edit-guard and install-guard inputs; `purpose` is also removed from the install guard. As a result, every chat and side session launches with `bypassPermissions` and gets the PreToolUse `allow` answer.
- **Status words.** New `services/feature-state.ts` with `featureStateLine`, which returns "Merged", "Working · Round N" (via `listRounds`), "Waiting for you · <why>" or "Talking with you". These words are used in the UserPromptSubmit line (`status=`), the SessionStart context (`status:`) and the kickoff line ("Feature status: …").
- **Self-plan.** It is now allowed for any started, unshipped feature. Drafts were already refused by the existing spawn check, so I added no second check.
- **Project skill.** The project skill and its triage and health-sweep references no longer mention Go, `go_feature`, quick changes or the `tickets` argument. One English "Go breadth-first" became "Work breadth-first" so a grep for Go stays clean. I also updated qa/SKILL.md, the pack README and plugin.json.
- **Tests.**
  - Replaced lead-skill, tickets-skill and self-plan-skill with one `feature-skill.test.ts`.
  - Added two pins in orchestrator-skill: one checks the project skill has no Go or quick changes, the other checks no remaining skill text names a deleted skill.
  - Pointed preview-skill at the feature skill's references.
  - Rewrote the guard, hooks, launch and kickoff tests around the new facts.

**Surprises.**
- With chat and side unguarded, the edit guard's docs-only "Talk sessions do not write code" fallback and the resolve-conflict merge exemption can no longer be reached by any current session kind. I left them alone, as the ticket asked. The install tests now use `scenario` as the guarded kind.
- The old conflict brief claimed "package installs are blocked". That had already been false for chats.
- The kickoff's review "Drive outcome" clause depended on the phase, so I dropped it.

**Left undone (other tickets' files).**
- `services/features.ts:387` and `mcp/server.ts:462/1156` still mention "the tickets skill" or `/runcastle:ideate` in comments.
- qa/SKILL.md and project/SKILL.md still mention `complete_phase`, which a later ticket removes.
- The launcher's relay emit still says "planning conversation".
- The drive machinery needs no change: no new service, environment variable or seed. I did not run it.

**Verification.** `bun run typecheck` passes with 0 errors. `env -u GIT_ASKPASS bun run test` passes: 370 files passed, 2 skipped; 5181 tests passed, 48 skipped.

#### 5. Sidebar: Needs you from facts and the ticket-progress glyph

# Ticket 5 — Sidebar: Needs you from facts and the ticket-progress glyph

## What was done
- `needsMe` (apps/web/src/lib/feature-ui/sidebar.ts) now reads facts only. It returns null for a draft, shipped or archived feature, for an active run and for a session mid-turn. It returns kind `'input'` when the live chat is awaiting input, and kind `'waiting'` (label = the reason) when `waitingReason` is set. The phase, pending tickets and failed tickets no longer count. The old kinds `grill`/`burn`/`attention`/`ship` are gone.
- New exports in sidebar.ts: `READY_TO_TEST`, `ticketShare` (done ÷ non-cancelled, from `ticketCounts`) and `progressState` (draft / shipped / active). `ticketProgress` ("3/7") now reads `ticketCounts` (done/non-cancelled) instead of `lapTally`.
- In SidebarParts.tsx:
  - `featureStateWords` returns 'Ready to test', the reason capitalised, 'Waiting on you', or 'In progress' (replacing 'Stopped').
  - `rowDot` is amber only for Needs you. The red failure dot and the grey dot are gone.
  - A new `FeatureProgressIcon` wraps `ProgressIcon`. Sidebar rows and CommandPalette rows use it.
  - The palette's words are now `featureStateWords` instead of `PHASE_NAME`.
- Sidebar.tsx keeps its layout. The in-progress lane still sits unheaded under the Needs you region, as the committed design has it. The only changes there are a variable rename (`stopped` → `inProgress`) and its comment.
- lib/projects.ts needed no edit: it already counts via `needsMe`.
- Preview sample data now uses `waitingReason` and `ticketCounts`, with no phase or lapTally.
- Tests updated in five files: sidebar-row, sidebar-lanes, feature-ui, command-palette-rows, sidebar-inbox and projects.
  - The skipped `rowChip` and `turn-aware feature states` suites in feature-ui.test.ts were rewritten to the new facts and un-skipped.
  - `test/fixtures.ts` `listItem` now carries `waitingReason`.

## Surprises
- apps/web/preview is not in the web tsconfig `include`, so `bun run typecheck` never checks it. I checked it with a temporary tsconfig that extends the web one (0 errors), then deleted that file.
- sidebar-inbox.test.tsx (not named in the ticket) pinned the old 'Run failed' and 'Stopped' words, so I updated it too.

## Left undone
- `PhaseIcon` and `PHASE_NAME` are still used by Workspace.tsx and NoticeDeck (ticket 4 and others).
- The skipped `draft derivations` suite in feature-ui.test.ts still references the old 'grill' kind. It is skipped, and it is about the retired DRAFT_GLYPH.
- No drive machinery changed, so there was nothing to check.

#### 7. Data: phases and laps leave the schema

## What was done
- Migration `0052_strong_sprite.sql` (drizzle-kit generated) drops features.phase/lap/tickets_ready_lap, tickets/sessions/events.lap, the lap/carried_lap columns of review_findings and test_notes, and ready_declarations.what_to_test. I appended one hand-written data fix to it: findings with status `carried` become `open`, because `carried` left `FindingStatus`. `test/phase-lap-drop-migration.test.ts` checks the dropped columns and that every other column keeps its data.
- Core: `Phase`, `parsePhase` and pipeline.ts are gone. `ticketTally`/`workTickets` count the feature's tickets. `isDependencySatisfied` is now `status === 'shipped'`.
- Server: removed `setPhase`, `go`, `goWarnings`, `agenticReview`, `latestRunDeniedDirty`, burn-warnings.ts, planning.ts, carried-work.ts, `goWakeText`, `listByTypeThisLap`, `git.uncommittedOutsideDocs`, the findings router's `reopen`/`fixOpenDefects` (with `promoteOpenDefects`), and `lapTally` on list items. `burn()` is now only the restart under `retryTicket`. Merge emits `feature.shipped` and sets status. Unarchive restores `shipped` from the `feature.shipped` event. A self-plan run counts as complete when it ended with a waiting reason. `resolve_finding` takes `addressed`/`dismissed` and needs a note for both (new `dismissAsAgent`).
- `get_feature_context` now has no phase, lap, carriedDefects, testNotes or currentLapReview. `openDefects` lists every open defect, `reviewEvidence` is the latest burned review (or null), and `findings` comes from that review. When rows overflow, `ticketsNotInlined` lists the seqs of settled tickets moved out, lowest first. `list_tickets` and the outcome doc have no laps. The dev tool's `feature phase` command is gone.
- Web: no phase or lap reads. Drive freshness changed from lap-based to `lastTestDriveAt` + `testDriveFigure(drivenAt, tickets)`: a drive is stale once work lands after it. `unverifiedLap` became `unverifiedReview`. `PhaseTag`, `PhaseDot` and `statusChips` were deleted. `PhaseIcon` stays only as a design glyph (wizard rail, notice hues, first-run intro) and its type no longer imports core `Phase`.
- The feature-at-review scenario now seeds a ready declaration through `declareReady` (waitingReason "ready to test"). I kept its name.

## Surprises
- A shipped feature that is later archived no longer counts as a satisfied dependency, because the ticket says satisfied means status shipped. I changed the tests to match.
- My first bulk regex over the web tests also stripped real `PhaseIcon` glyph props in `ui.test.ts`. I restored that file and redid it by hand.
- Server tests are not typechecked, so fixtures still passing `phase`/`lap` were silently ignored. I stripped them in a separate commit.

## Left undone
- `TestNoteStatus` still includes `carried`/`promoted`/`done`. Note filing is gone, but I left the enum alone.
- `deferredScope`, which reads the spec's "Later laps" section, still drives the DeferredScope card and a merge-dialog warning.
- Prompt and comment prose still says "lap" in places, for example the review prompt's "this lap" and orchestrator-notify's `start-lap` text.
- Drive machinery: no new service, env var or seed. The migration applies at boot, and the scenario only calls existing services. Nothing needed to change there, and none of it was run.
