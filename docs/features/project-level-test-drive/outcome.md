# Outcome — Project-level test drive

Drive the merged whole — a base branch, default main — from the project surface with the same dev-pane, video and annotation tooling a feature drive has, and land what you notice as project notes rather than feature test-notes.

- Shipped: 2026-09-24
- Laps run: 1

## What shipped

13 commits · 48 files

### Lap 1
- 4 tickets landed: #1 Project drive on the server: a third drive kind, note stamping, merge stops it; #2 Project drive UI: Test drive card, drive view with live project-notes rail; #3 Name a blocking project drive on feature surfaces; merge confirm warns it will stop; #5 Test drive card's blocked reason starts lowercase ("a project drive of main is running") instead of using holderSentence
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: fcb20e1e62cf4a3d56e1323e1d0ba95ef9fc46f0
- Landed since: 1
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 8d87387b7c7a4ac0b88a414c4e1e8f2fb59edbf3
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Project drive on the server: a third drive kind, note stamping, merge stops it

# Ticket 1 — project drive on the server

**What was done.** `git.ts` now has a third drive kind in the one slot, `kind:'project'`, plus a new function `projectDrive(ctx, project, 'start'|'stop')`. It is shaped on the dry run. It never switches branches and has no dirty-tree guard. It runs as `RUNCASTLE_SLUG=project-drive` (`RUNCASTLE_ID=project_drive`) with the real branch. It records `commit` (short SHA, `+dirty` on a dirty tree) and `startedAt`, and emits `projectdrive.started`, `projectdrive.stopped`, `projectdrive.url` and `projectdrive.ready`/`ready_timeout`. The tRPC mutation is `project.testDrive({projectId, action})`.

`DriveInfo` gains `projectDrive: true`, `projectId`, `commit` and `startedAt`. Every kind now also carries a server-computed `holderLabel`:
- "a project drive of main"
- "a test drive of feature/x"
- "the review agent's drive of feature/x"
- "a preparation dry-run"

Where a slot refusal is caused by a project drive, the reason reads "A project drive of main is running — stop it first". That covers feature start and stop, review start (`slot_held`, retriable) and dry-run start. A project-drive start refused by any other holder uses the same label-based wording. The existing DENY_ACTIVE and DENY_DRY_RUN_ACTIVE strings are unchanged for non-project holders.

`feature.merge` stops a project drive of the same project before merging. `addNote` stamps `driveBranch`/`driveCommit` from `activeProjectDriveStamp(projectId)`, with migration `0041_round_harpoon`. `list_project_notes`, triage.md and project/SKILL.md now carry and document both fields. The tests are in `packages/server/test/project-drive.test.ts` (13 tests; the PTY one ran here).

**Deviation.** A feature/review drive start now checks for a project-drive holder *before* the dirty check. Otherwise a project drive running on a dirty tree would make the review agent see a non-retriable `dirty` denial, and the pipeline-docs commit would land underneath the live drive.

**Surprises.**
- The full suite here reported 278 files / 4015 tests, not the baseline's 118 / 1768.
- Two tests failed outside this diff:
  - `dev-pane.test.ts` "kills the child process tree…" fails on its own too. It is a process-group kill in this sandbox; `dev-pane.ts` is untouched.
  - `merge-conflict.test.ts` "lets a recorded conflict be retried" failed on an event-timestamp ordering assertion, then passed on rerun (flake).
- The post-commit sync push was rejected once with "stale info". A `git fetch` of the tracking ref followed by a re-push fixed it.
- No import cycle between `project-notes.ts` and `git.ts`.

**Left undone.**
- All web work: the card, the drive view, the pill, the DrivePanel note target, and showing `holderLabel` in banners and tooltips.
- `mergeFeature`'s own GateError still says "a test drive is active" for any other holder; it does not use the label.
- Drive machinery: no new service, env var, seed or process, so `.runcastle/drive-*.ts` needed no change (only a migration, which setup already covers). Nothing was run.

#### 2. Project drive UI: Test drive card, drive view with live project-notes rail

# Ticket 2 — project drive UI

**What was done.**
- `apps/web/src/lib/project-drive.ts` holds three pure helpers:
  - `projectDriveCard()` returns a tagged union. `blocked` carries `reason = "<holderLabel> is running"`, so it is `{state}` rather than a bare string.
  - `splitDriveNotes()` splits open notes by `createdAt >= startedAt`.
  - `driveTag()` gives the label and tooltip.
- `lib/use-project-drive.ts` wraps `feature.driveInfo` and `project.testDrive`. A `{ok:false}` answer is toasted with its `deniedReason`.
- New components under `components/project/`:
  - `TestDriveCard`, with a ghost button. Its branch comes from `project.branches.current`, the same query key useSessionBranch already reads.
  - `ProjectDriveView`, which composes DrivePanel, DriveFooter, and the failure/bare/starting states. It also exports `ChatDriveSwitch`.
  - `ProjectNotesRail`, with a composer that attaches a pasted image.
  - `NoteRow` and `DriveTag`. NoteRow was moved out of NotesCard, which now shows the tag on open and triaged rows.
- `DrivePanel` now takes `featureId` *or* `projectId`:
  - The project path creates the note via `utils.client.projectNotes.add.mutate`, so feature-only test mocks stay valid.
  - `saveAnnotatedNote` became generic over the note type.
- `drive-parts` gained a presentational `DriveFailureReport`. `DriveSetupFailed` renders it with the same markup as before.
- ProjectWorkspace:
  - adds a `front: 'chat'|'drive'` state beside `showList`
  - takes new props `empty`, `onOpenPreparation`, `driveRequest`
- ProjectShell passes those props and feeds the Titlebar's new `drivingBranch`/`onOpenDrive` pill.
- LiveChat takes an optional `switcher` slot.

**Tests.**
- New: `project-drive.test.ts`, `project-drive-workspace.test.tsx` (tier 2) and `drive-panel-target.test.tsx`. The last one runs the capture chain for both targets against stubbed getDisplayMedia and canvas.
- Changed: the titlebar pill cases in `chrome-bars.test.ts`, and `project-triage-launch.test.tsx`, whose mocks gained `driveInfo`, `branches` and `testDrive`.

**Surprises.**
- Setting `showList` with no chat open would have stopped the next chat from taking over the body. "Project page" and Stop therefore only set it when a session exists.
- The rest content is not rendered at all, not just hidden, while something else is in front.
- The full suite ran 281 files / 4040 tests. Its only failure is `dev-pane.test.ts` "kills the child process tree", which ticket 1 already reported as failing in this sandbox. This diff touches no server code.
- The post-commit sync push was rejected once with "stale info". Fetching the tracking ref and re-pushing fixed it.

**Left undone.**
- The titlebar breadcrumb still reads "Chat" while the drive is in front.
- Naming a blocking project drive in the review banner, feature tooltip and dry-run refusal is ticket 3's job.
- Drive machinery: no new service, env var, seed or process, so `.runcastle/` needed no change. Nothing was run.

#### 3. Name a blocking project drive on feature surfaces; merge confirm warns it will stop

# Ticket 3 — naming a blocking drive on feature surfaces; merge confirm warns

**What was done.**
- Two pure helpers were added to `lib/feature-ui/drive.ts`. `holderSentence(label)` capitalises the server's `holderLabel`. `slotHeldReason(label)` builds "<Label> is running — stop it first", the same wording as the server's refusal.
- The next-step context's `dryRunActive: boolean` was replaced by `slotHolder?: string`. It holds the `holderLabel` of any drive that is not this feature's. `Workspace.tsx` sets it from `driveQ.data`, and the review bar's Start test drive is disabled with that reason.
  - Behaviour change: another feature's drive now disables the bar's start too. Before, only a dry run did; the server refused the others on click.
  - The dry-run wording changed from "…is in progress…" to "A preparation dry-run is running — stop it first". The two existing tests were updated to match.
- `ReviewBody` shows the same reason in the status strip's Test drive tooltip, for every kind of holder.
- When the holder is a project drive, `ReviewBody` also renders a new component, `components/review/ProjectDriveBlocking.tsx`. It is a quiet "<Label> is running · Stop it" line with a ghost xs button that calls `project.testDrive({projectId, action:'stop'})` and invalidates `feature.driveInfo`. It is a separate component so the mutation hook only exists while a project drive is in the way, and the other ReviewBody test mocks did not need a new `project.testDrive` stub.
- `mergeSummary` takes a new input, `projectDrive?: { holderLabel }`, and warns "A project drive of main is running on your checkout — merging stops it." `Workspace.tsx` passes it only when the project drive belongs to this feature's project.
- Merge was never disabled by a drive on the web. `next-step/review.ts` has no disabled Merge, and the `merge` case just opens the dialog. Nothing changed there.
- Review-agent `slot_held` denials are not shown on the review page: the server emits `reviewdrive.denied` only for dirty-tree denials (`git.ts` ~2396). No banner was added.
- Tests:
  - `merge-summary.test.ts` and `merge-dialog.test.ts` cover the new warning.
  - `feature-ui.test.ts` covers the next-step reasons.
  - A new tier-2 test, `review-blocking-drive.test.tsx`, checks the tooltip for all three holder kinds, and that Stop it calls the mutation and Test drive comes back afterwards.

**Surprises.**
- The `review-bands.test.ts` fixture built a DriveInfo with no `holderLabel`, and the new tooltip code crashed on it. I fixed the fixture, not the code: the real type requires the field.
- The post-commit sync push was rejected with "stale info", the same as in ticket 1. A fetch of the tracking ref and a re-push fixed it.

**Verification.**
- `bun run typecheck` is clean.
- One full `env -u GIT_ASKPASS bun run test` run: 278 files and 4022 tests, 2 failures.
  - `dev-pane.test.ts` "kills the child process tree" is the known sandbox failure from ticket 1's digest.
  - `review-bands.test.ts` was the fixture above. I fixed it and re-ran that file alone (39/39 pass), not the whole suite.
- The drive machinery needed no change: this ticket adds no service, env var, seed or process. Nothing was run.

**Left undone.**
- `mergeFeature`'s own GateError still says "a test drive is active" for other holders (already noted by ticket 1).
- A project drive holding the slot while the review agent wants to drive is only visible through the tooltip and line above, because `slot_held` review denials emit no event.

#### 5. Test drive card's blocked reason starts lowercase ("a project drive of main is running") instead of using holderSentence

## What was done
`projectDriveCard`'s blocked branch (apps/web/src/lib/project-drive.ts) now builds its reason with `holderSentence(drive.holderLabel)` + " is running", imported from `./feature-ui/drive`. That is the same phrasing `ProjectDriveBlocking` uses, so the card's caption and title start with a capital letter like every other surface that names a blocking drive. I used `holderSentence` and not `slotHeldReason` because the card has no "— stop it first" suffix. I updated the expectations in apps/web/test/project-drive.test.ts and in the card's component test (apps/web/test/project-drive-workspace.test.tsx:210) to the capitalised text. The unit test failed before the fix and passes after it.

Repro re-run: `bun test apps/web/test/project-drive.test.ts` with the input `{ holderLabel: 'a test drive of feature/x' }` now returns 'A test drive of feature/x is running'. It passes: 10 tests, 0 failures. I did not check it in the running app because the sandbox has no app to run.

## Surprises
- The prompt says the baseline is fully green, but it is not. `bun run typecheck` has 4 errors in apps/web/test/review-bands.test.ts: `holderLabel` is missing from that fixture's drive type. That file is outside this diff. It looks like ticket 3's fixture change clashing with the merged ticket-2 code. I left it alone because it is outside my scope.
- The full test suite has 1 failure outside my change: packages/server/test/dev-pane.test.ts "kills the child process tree…". Ticket 4 already reported it as failing in the sandbox. The one other failure was the component-test expectation, which I then fixed.
- The first commit sync push was rejected with "stale info". I fetched the remote ref and pushed again, and that worked.

## Left undone
- The review-bands.test.ts type errors described above.
- I did not check the drive scripts. This change adds no infrastructure the dev environment needs.

#### 6. Verify the fixes that landed

Gates verification pass — pass #4, lap 1 of project-level-test-drive

The project has no verify commands, so there were no gates to run; this pass read the fix diff against its finding.

**#5: the Test drive card's blocked reason started lowercase. The fix held.**
Commit 8d87387b changes `projectDriveCard`'s blocked branch in `apps/web/src/lib/project-drive.ts`. It now builds the reason as `${holderSentence(drive.holderLabel)} is running`, importing `holderSentence` from `./feature-ui/drive`. That helper upper-cases the first character of the server's `holderLabel`, and it is the same one `slotHeldReason` and `ProjectDriveBlocking` use.
- **Repro step:** the input `{ holderLabel: 'a test drive of feature/x' }` now gives "A test drive of feature/x is running", the expected text.
- **Where the reason shows:** `TestDriveCard.tsx` renders `card.reason` both as the disabled button's `title` and as the caption under it, so both now start with a capital letter.
- **Tests:** the expectations in `project-drive.test.ts`, for a feature holder and for another project's drive, were updated to the capitalised text. So was the card's tier-2 test in `project-drive-workspace.test.tsx`.
- **Import cycle:** there is none. `feature-ui/drive.ts` imports only `@runcastle/core` types.

I did not run the app or the test suite, because Gates mode here has no configured gates. The fix was checked by reading the diff.

**Nothing else was plainly broken in the surfaces this fix touched.** Ticket 5 reported one thing outside its scope, left for the human: typecheck errors in `apps/web/test/review-bands.test.ts` about `holderLabel` on the drive fixture. I did not investigate it, because it is outside this fix.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON: no gates configured; the single landed fix (#5) was confirmed by reading its diff against the finding and repro
