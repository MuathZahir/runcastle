# Outcome — Triage batch — stale merge conflict and drive prerequisites

The merge-conflict card stays up after the conflict has been resolved. Observed: after the resolve agent finished and committed the merge, the Review page still shows the red "Merge conflict" card and "End session & resolve" as primary, and the Merge & ship dialog still warns "A merge conflict is standing … this merge will fail unless it's been resolved". Cause: `unresolvedMergeConflict` (packages/core/src/schemas.ts ~line 848) clears only on `merge.resolved` / `burn.started` / `feature.shipped`, and `merge.resolved` comes from `noteResolvedMerge` (packages/server/src/services/resolved-merge.ts), which only runs at session teardown (launcher.ts and routes/hooks.ts). Since one-chat-per-feature, the resolve session is the feature's one chat and stays live after resolving, so teardown never happens. Fix: re-check a standing conflict against git without waiting for session end. Run the same `isAncestor(mergeFrom/base, feature branch)` probe when a chat turn ends (Stop hook) and when the review state is read, and emit `merge.resolved` once it holds (only once). Expected once resolved: the red card becomes a short "Conflict resolved — ready to merge" line, the primary action goes back to plain "Merge & ship" (not "Retry Merge & ship"), and the Merge & ship dialog drops the standing-conflict warning. Tests: a feature with a merge.conflict event whose base is already an ancestor of the feature branch reports no unresolved conflict after the probe, with a live session; a still-conflicting branch keeps the card. A screenshot of the problem is at .runcastle-attachments/pnote_NelUGHD5pdmv.png in your workspace — Read it before starting. A screenshot of the problem is at .runcastle-attachments/pnote_cSU0BlEevwEa.png in your workspace — Read it before starting.

- Shipped: 2026-09-29
- Laps run: 1

## What shipped

9 commits · 23 files

### Lap 1
- 4 tickets landed: #1 The merge-conflict card stays up after the conflict has been resolved.…; #2 The review trail hides why Drive was unavailable when the reviewer…; #3 The operator only learns that a drive prerequisite is missing after a…; #5 Conflict card never clears for a legacy merge.conflict event with no `base`, even after the base is merged in
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 3b0b60b75b98954febf5e420603d96e538b752c8
- Landed since: 1
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 148000c90ab48ccfe8aa4527e1722bb212158265
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. The merge-conflict card stays up after the conflict has been resolved.…

# Ticket 1 — stale merge-conflict card

**What was done.** I added `reconcileStandingConflict(ctx, feature)` to `packages/server/src/services/resolved-merge.ts`. It reads the standing conflict from the event feed (`unresolvedMergeConflict`), then runs `isAncestor(project.repoPath, conflict.base, feature.branch)`. If that holds, it emits `merge.resolved`. It runs from two places:
- the `stop` hook in `routes/hooks.ts`, for feature sessions, when a chat turn ends;
- `feature.get` in `trpc/routers/feature.ts`, only when the feature is at review.

It emits only once for two reasons. After the emit, `unresolvedMergeConflict` returns null, so later calls skip git entirely. A per-feature in-flight set also stops overlapping reads from each emitting.

The probe is feature-scoped rather than session-scoped. It keys off the conflict event's `base`, not a `resolve-conflict` session's `purposeData`. So a resolution typed into an ordinary live chat also clears the card, and so does one done by hand.

On the web side, a new `mergeConflictResolved(events)` in `apps/web/src/lib/feature-ui/gates.ts` returns true when `merge.resolved` follows the last conflict and no burn or ship has happened since. When it is true, `ReviewBody` shows a quiet `ConflictResolvedLine` ("Conflict resolved — ready to merge") in place of the red card. The bar's plain "Merge & ship" and the dialog without the conflict warning needed no changes: both were already driven by `unresolvedMergeConflict`, which now clears.

**Tests.**
- `packages/server/test/resolve-conflict.test.ts`: a live chat with the merge landed clears the conflict on Stop; a `feature.get` read clears it too, emitting exactly once even when it runs alongside a Stop; a branch that still conflicts keeps the card.
- `apps/web/test/conflict-card.test.ts`: covers the resolved line and the derivation.

**Surprises.** The full suite had one failure: `packages/server/test/dev-pane.test.ts` › "kills the child process tree so the port-holder is not orphaned" (line 183, process group still alive). It also fails when run on its own. It tests PTY process-group teardown, which this change doesn't touch, so it looks environmental. I did not confirm it against a pre-change checkout. Typecheck is clean.

**Left undone.** `noteResolvedMerge` at session teardown is still there and now partly overlaps with the new probe. I kept it because it probes the session's own worktree pair. The drive machinery needed no change (no new service, env var, seed or process), and I did not run it.

#### 2. The review trail hides why Drive was unavailable when the reviewer…

## What was done
- `missingDrivePieces` (packages/server/src/workflows/review-ticket.ts) now adds an install hint when a binary is missing. For ffmpeg: "(install ffmpeg to get walkthrough videos)". For agent-browser: "(install agent-browser to get driven reviews)". A health-check failure or a missing dev command gets no hint. The hints show up everywhere this prose is used: `driveWithheldReason`, the pass's recorded reason, and the prompt's DRIVE_AVAILABILITY block.
- `resolveReviewDeclaration`: when a pass declares Drive but Drive was withheld, the reason is now `<driveWithheldReason> The reviewer drove anyway, so nothing was recorded.` The pass stays unverified. The generic sentence remains only when there is no withheld reason, e.g. an inherited Gates pass.
- `review_drive` refusal: review-ticket.ts keeps a per-run map of withheld reasons, set with `withholdDrive(runId, reason)` (returns a reopen function) and read with `withheldDriveFor(runId)`. `reviewTicketOutcome` sets it before the agent runs and clears it in `finally`. `toolReviewDrive` (mcp/server.ts) refuses every action while it is set, returning `{ ok: false, deniedReason: <reason>, retriable: false, drive: null }`. The tool description says so.
- Tests: resolveReviewDeclaration with offeredMode 'gates', a withheld reason and a drive declaration; the install hints; a review_drive refusal test in review-wires.test.ts (the checkout is not switched, and driving works again once reopened); a wiring test showing executeReviewTicket registers the reason on an empty PATH and clears it afterwards.

## Surprises
- The full suite had 1 failure outside my diff: `dev-pane.test.ts > kills the child process tree so the port-holder is not orphaned` (`pidAlive(-pgid)` is still true). It also fails run alone. It looks like a sandbox process-reaping fault; my change doesn't touch the dev pane. Everything else passed (4334 tests); typecheck is clean.
- The refusal has no `deniedCode`. `DriveDenialCode` is a core wire type, and I did not widen it for this.

## Left undone
- Ticket 3's standing Review-page notice can reuse `missingDrivePieces` / `driveWithheldReason`, which now include the install hints.
- No drive machinery changed, so no `.runcastle/` scripts needed updating.

#### 3. The operator only learns that a drive prerequisite is missing after a…

# Ticket 3 — standing drive-prerequisite notice on the review page

**What was done.**
- In `packages/server/src/workflows/review-ticket.ts`, `missingDrivePieces` is now exported and returns structured `{ piece, reason }` rows. `piece` is one of `agent-browser`, `agent-browser-unhealthy`, `ffmpeg` or `dev-command`, and `reason` is the same prompt prose as before. `driveWithheldReason` and `buildDriveAvailability` join the reasons exactly as they did, so their output is unchanged.
- The host probe (agent-browser and ffmpeg on PATH, plus the agent-browser health check) moved out of `reviewTicketOutcome` into an exported `probeDriveHost()`. The review and the new query now share one probe.
- New `services/drive-prerequisites.ts`: `drivePrerequisites(project)` returns `{ missing: [{ piece, reason, notice }] }`.
  - `notice` is the operator's short line, e.g. "ffmpeg not installed — install it and restart runcastle".
  - The host probe is cached for 5 minutes, so it does not spawn on every render. The project's dev command is read fresh on every call.
  - It is exposed as the tRPC query `project.drivePrerequisites({ projectId })`.
- Web: `components/review/DrivePrerequisitesNotice.tsx` is a warning-tone `Notice` with `role="status"`. It sits in ReviewBody's status tier under the StatusStrip and reads "Walkthrough videos off on this machine: <notices joined by ;>". The full reasons are its tooltip. It is not shown on readonly/history views, and nothing renders when nothing is missing.
- Tests:
  - `packages/server/test/drive-prerequisites.test.ts` covers each piece, all pieces together, the cache TTL, and the dev command being read fresh.
  - `apps/web/test/drive-prerequisites-notice.test.ts` covers the component.
  - A review-bands case checks the page wiring. The three other ReviewBody test mocks got the new query.

**Surprises.** `packages/server/test/dev-pane.test.ts` ("kills the child process tree…", line 183) fails every time in this sandbox, although the baseline says the suite is fully green. My diff does not touch or import dev-pane. It is a process-group kill check, so it is most likely a quirk of this sandbox. Apart from that one test, typecheck and the full suite are green.

**Left undone.**
- Ticket 2 also edits `review-ticket.ts` (install hints on `driveWithheldReason`). My change reshapes `missingDrivePieces` to return structured rows, so a merge there may need a small hand-resolve. The `piece` key should make ticket 2's hints easy to add.
- The dev-command notice points to "the project's test drive setup" as plain text, not a settings link.
- Drive machinery: this ticket adds no service, env var, seed or process, so `.runcastle/` was left alone. I did not run the drive scripts.

#### 6. Verify the fixes that landed

Drive verification pass — verifying pass #4 (inherited Drive mode)

**The one landed fix (#5, a legacy `merge.conflict` with no `base` never cleared) holds.** I checked it live on runcastle-demo, on the actual 76-day-old Entry tags conflict that pass #4 flagged.

**State before the tour.** I read it from the drive's per-branch database before loading the page:
- Entry tags (`feat_Oq7SVoUpPTvf`, review phase) had one `merge.conflict` event whose data was `{"conflict":true}`, with no `base`.
- No `merge.resolved` followed it.
- `git merge-base --is-ancestor main feature/entry-tags` held in the runcastle-demo repo.

That is exactly the repro step from the finding.

**Tour** (recorded in `walkthrough.webm`):
- I opened runcastle-demo, then Entry tags. Loading the Review page runs `feature.get`, and that read retired the conflict.
- The red "Merge conflict" card is gone. In its place is the quiet "✓ Conflict resolved — ready to merge" line.
- The next-step bar reads "Test drive, then ship", with a plain **Merge & ship**. It is not "Retry Merge & ship" and not "End session & resolve".
- The database now has exactly one `merge.resolved` event, `{"mergeFrom":"main","mergeInto":"feature/entry-tags"}`. `mergeFrom` fell back to the feature's `baseBranch` as intended.
- I reloaded the page and there was still exactly one `merge.resolved`, so it emits only once.
- The Merge & ship dialog shows only "Merges feature/entry-tags into main, writes the outcome doc, and moves the feature to Shipped." It has no standing-conflict warning, so the "A merge conflict is standing ()" empty-base text the #5 implementer mentioned doesn't show once the conflict clears. I cancelled the dialog without merging. Screenshots: `merge-dialog.png`, `review-page.png`.
- The drive-prerequisite notice from the lap is still in place: "Walkthrough videos off on this machine: this project has no dev command — set one in the project's test drive setup".

**Nothing plainly broken on the tour.**

One note on the drive itself, not the app: my first agent-browser session hung on `open`. A fresh session name attached right away, and the whole tour ran in that session. The dev URL answered throughout. I stopped the drive and put the checkout back.

This is Drive mode, so I did not run the gates. The `dev-pane.test.ts` failure the implementers reported is still unconfirmed here.

REVIEW-MODE: drive
REVIEW-VERDICT: verified
REVIEW-REASON: Legacy base-less conflict on Entry tags cleared on review read with a single merge.resolved (mergeFrom main); card, bar and dialog all back to the resolved state.
