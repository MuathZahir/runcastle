# Outcome — The orchestrator prepares the project

Retire the separate preparation session: a new project lands on a "Start the project" button that opens the orchestrator, which reads the repo, prepares it, then asks what to build — plus an onboarding scenario that starts from a brand-new install.

- Shipped: 2026-11-06

## What shipped

24 commits · 149 files

- 4 tickets landed: #1 Orchestrator: it prepares the project itself; #2 Project home: Start the project, and the Preparation screens go; #3 Sessions: delete the prepare kind; #4 Onboarding drive: start runcastle as a brand-new install
- 0 waived
- 0 failed

## Review record

### Ticket 5 · review

- Reviewed commit: f390431f7a9ccd075d4001b630e5261898d974bb
- Landed since: 0
- Outcome: done

- **Test gate red: the terminal's kill-tree test failed (1 of 5933), outside the fully-green baseline** — dismissed
- **Setup wizard unverified: a review drive cannot start on a scenario, so it never boots as a brand-new install** — open
- **The dry run's Stop on the drive panel was not seen: the whole dry run took under 25 seconds** — open
- **While the orchestrator is preparing, the header offers "Set up drives", which opens a second orchestrator chat** — open
- **A deliberate none shows "None" but its chip still says "Global"** — open
- **The orchestrator's first words are generic; what it understood of the repo comes after its work, not before** — open
- **No walkthrough video: each screenshot capture closed the reviewer's browser and its recording** — open

## Notes record

- No human notes

## Per-ticket digests

### 1. Orchestrator: it prepares the project itself

# Ticket 1 — Orchestrator: it prepares the project itself

**What was done**
- **"None" findings.** `recordFinding` treats a blank value as a deliberate none: the column is stored as NULL, and the provenance row stays with its evidence. `toolRecordFinding` refuses a none that has no evidence (`InvalidInputError`), and the `record_finding` description explains the none form. `keysToPrepare` now means "no value AND no finding row" (new `hasFinding` in findings.ts). `isPrepared`, `preparedAt` and `hasCompletedProjectSession` (now unused) are deleted, and `PrepView` has lost `prepared`/`preparedAt`. On the web side, `ProjectShell`, `Sidebar` and `PreparationWorkspace` now work out "prepared" from `pendingKeys.length === 0`, so the old interfaces of `workspaceView`/`prepRailRow` still hold for ticket 2/3 to rewrite. `isEmptyRepo` is exported, and there is a new `hasEverHadFeature` in prep.ts.
- **Start note.** A `project` session's SessionStart digest (`routes/hooks.ts`, which is now async) lists the open keys, whether the repo is empty or has code, whether the project has ever had a feature, and the opening those add up to. That opening is one of: prepare first, offer in one line, or as usual. The `prepare` arm is unchanged.
- **Landing.** New `landProjectBranchNow` in `launcher/sessions.ts` is called by `dry_run_drive start` (project kind) and at the top of `start_feature`. If nothing is ahead, it does nothing. It refuses when the human's checkout is not on the base branch, on a conflict, and on a merge failure such as uncommitted edits that overlap the landed files. It never stashes or forces. It reports on the timeline through `reportProjectLanding` with `midChat: true`. It keeps `runcastle/project` (new `keepTemp`/`keepBranch` options on `mergeTempBranch`/`landProjectBranch`), so the orchestrator's worktree is not detached mid-chat. `dry_run_drive` is offered to `PROJECT_KINDS` (prepare still has it until ticket 3).
- **Skill.** New `project/references/preparation.md` covers the method rewritten for the orchestrator: worktree and landing, ask only what you can't find, "later", can't-finish, recording a none, and the dry run. New `project/references/preparation-recipes.md` is a copy of the prepare recipes; the prepare skill is untouched. SKILL.md: the tools list adds `record_finding` and `dry_run_drive`, the §0 exception is driven by the start note, and the on-demand list is now "Four procedures".
- **Tests.** findings.test: none closes a key, clearing it by hand reopens it, a none without evidence is refused. hooks-route: four start-note cases. dry-run-drive: lands first, wrong branch, conflict, and overlapping dirty edits, all against a temp repo. orchestrator-acting-tools: `start_feature` lands first, wrong branch, conflict. mcp-tools: the audience list. orchestrator-skill: §0, the reference and the method. I removed the tests for `preparedAt` and for the session-ended clause of `isPrepared`.

**Surprises**
- `mergeTempBranch` deletes the temp branch after a successful merge. That is fine when a chat closes, but mid-chat it would have detached the orchestrator's worktree, hence the keep option.
- orchestrator-skill.test bans the word "setting" (and "Go", "burn") in project/SKILL.md, so §0 says "prepared keys".

**Left undone**
- A project-kind `dry_run_drive start` lands the commits before it checks whether the drive slot is held. If the slot is held, the landing still happens and only the drive is refused. That is harmless, but it could be reordered.
- The mid-chat conflict report reuses the timeline wording "retried at the next launch".
- Drive machinery: no new service, env var, seed or process was added, so no `.runcastle/` edit was needed (not run, by design).

### 2. Project home: Start the project, and the Preparation screens go

# Ticket 2 — Project home: Start the project, and the Preparation screens go

## What was done
- `ProjectWorkspace`: Start the project now calls `project.talkToProject({ projectId, fresh: true })` (no `holdOpening`), opens the returned thread in the column, and drives the card's `starting` (edge light) from that mutation. The same `askOrchestrator` launch backs the two drive doors that used to open Preparation: the header's "Set up drives" (was "Prepare drive"; `ProjectDriveCard` state renamed `prepare` → `setUp`) and the failed drive's "Ask the Orchestrator" (was "Open preparation"), which also closes the drive page so the new chat is in view. The `onOpenPreparation` prop is gone.
- A running dry run is now "this project's drive" (`isThisProjectDrive` accepts `slot.dryRun`): it shows on the Orchestrator's drive page and its Stop calls `project.dryRunStop` (`use-project-drive.ts`). On a feature's drive page, `DriveStage`'s held-by-dry-run state now says "The Orchestrator's dry run…" and offers "Stop the dry run" (`dryRun` prop is now `{ onStop, stopping } | null`, wired in `FeatureDriveView`).
- Deleted: `PreparationWorkspace` + its test, the prep test in `chat-surface-controls`, the `prepare` WorkspaceView, `prepRailRow`, `matchesPreparation`/`PREPARATION_TERMS`, the `preparing` state (`runcastle.preparing.v1`, `startPreparation`, `closePreparation`), the `{kind:'prepare'}` route (`/p/<id>/prepare` now parses to `{kind:'project'}`), `PrepRow`, the Re-prepare menu item, the palette's Preparation row, the glossary `preparation` entry, the 'unprepared' sidebar preview sample and Re-prepare items in other previews. `workspaceView` now takes only `creating/projectSelected/selectedFeatureId`; the `pendingKeys` stopgap is gone from ProjectShell and Sidebar.
- Settings: a finding with no effective value (a deliberate none) reads placeholder "None" with note "None, on purpose. <provenance>" and its evidence behind the chip. Copy now names the Orchestrator (stale tooltip, unverified warning, "Yours" title, drive-instructions tooltip); the retired `prep` source reads "measured by an older automatic run" in the evidence popover, matching `findingSource`. Model step `prepare` is labelled "Drive chats" / "Scenario and drive-fix chats".
- Tests added: Start launches via talkToProject with no `thread.new`/`thread.send` and opens the chat; the edge light runs while launching; Set up drives / Ask the Orchestrator launch a fresh chat; a dry run shows on the drive page and Stop calls `dryRunStop`; `/p/<id>/prepare` parses to the project home; drive-card dry run is `running`; describeField renders a none as None. Existing tests updated as listed in the ticket (+ drive-notes, settings, settings-project).

## Surprises
- `prep`-sourced findings are the retired headless run's, not the Orchestrator's (record_finding writes `session`/`human`), so the evidence popover was reworded to the history rather than "established by the Orchestrator".
- `ProjectShell` defaults `empty` to true until `project.prep` answers, so the Start card can briefly show the empty-repo line on a repo with code before the answer lands (the card's name is likewise blank until `project.list` answers).

## Left undone
- Server `prepare` kind, `talkToPrep`/`prepSession` (still invalidated in `lib/live.ts`), `ThreadStart`'s `'prepare'`, `sessionKindName`'s prepare arm and chat-sessions role — ticket 3.
- `preview/start-the-project.tsx` fakes still return `prepared/preparedAt/dryRun` (untyped fakes; harmless).
- Drive machinery: no infra change, nothing under `.runcastle/` touched.

### 3. Sessions: delete the prepare kind

# Ticket 3 — Sessions: delete the prepare kind

## What was done
- `prepare` is out of `SessionKind`, `PROJECT_SESSION_KINDS` (now `['project']`), `ThreadEntry.role`, the thread kind/role tables (`threads/read.ts`, `threads/launch.ts` STEP), `ENTRY_SKILLS`/`entrySkillsFor`, the kickoff tables, both guards (`guardsCheckout` is drive-fix + scenario; the edit guard's prepare `.runcastle/` exception is gone, and its featureless fallback now just refuses), the hooks route (noun, prompt label, digest arm), the MCP audiences (`PROJECT_KINDS = ['project']`, `dry_run_drive: ['project']`) and `toolDryRunDrive`'s kind gate, tRPC (`project.talkToPrep`, `project.prepSession`, `thread.models` kind enum is `['project']`), and the web (`ThreadStart`, `sessionKindName`, `live.ts` prepSession invalidation).
- Deleted with it: `launchPrepareSession`, `buildPrepareBrief`, `probePrepareHost`, `renderPreparePrompt` and its `PrepareBrief/Host/Finding` types, `prepareConfirmKickoffFor`/`PREPARE_CONFIRM_KICKOFF`, `launcher/lockfiles.ts` (only the prep host probe used it), `packages/skills/packs/runcastle/skills/prepare/`, and its listings (packs README, skills README, NOTICE, plugin.json description). The model step `prepare` stays (scenario/drive-fix launches in `launcher.ts`, `threads/launch.ts` STEP, web settings roster).
- Migration `0060_drop_prepare_sessions.sql` (hand-written, registered in `meta/_journal.json` like 0058): `DELETE FROM sessions WHERE kind = 'prepare'`. No table has a foreign key to sessions; thread metadata lives on the row; events stay. Test `prepare-sessions-drop-migration.test.ts` applies migrations to a DB with a prepare session, an orchestrator session and a finding: only the prepare row goes.
- Round-1 follow-ups: `toolDryRunDrive` start checks the slot first (new `git.driveSlotHeldReason`), so a refused start lands nothing. Test in `dry-run-drive.test.ts` holds the slot with a feature drive, puts the checkout back on main, and shows main unmoved and no `project.landed`. A mid-chat landing's conflict/failure report now ends "the orchestrator's work stays on runcastle/project and the landing is retried at its next dry run or feature start" (`LANDING_KEPT_MID_CHAT` in `sessions.ts`). The existing conflict test asserts that wording.
- Tests: deleted `prepare-session.test.ts`; removed or moved prepare cases in ~20 server/web tests (onto `project`, `drive-fix` or `scenario` where the case still meant something). Typecheck is green across the project. Every touched test file passes.

## Surprises
- Server tests are not typechecked (`tsconfig` includes only `src`), so test-file leftovers only show up when the tests run.
- The edit guard's featureless fallback can no longer be reached by any known kind; it stays as a fail-safe, and its resolve-conflict test case was dropped.
- Host-side permission posture (`hostSidePosture`) lost its only direct test, the prepare row in `thread-launch.test.ts`. Drive-fix and scenario need a live or failed drive to build a launch input.

## Left undone
- Saved logs of deleted prepare sessions under `sessionDir(<id>)` are left on disk. Migrations are SQL-only and have no clean place to learn the deleted ids.
- The acceptance grep still hits three things that aren't session kinds: `routes.ts` keeps the `/p/<id>/prepare` segment as an old-link redirect (ticket 2), the migration test seeds a `'prepare'` row on purpose, and the `launcher.ts:572/670` model-step uses are the scenario and drive-fix launches.
- No drive machinery change was needed, and nothing under `.runcastle/` was touched.
