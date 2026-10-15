# Outcome — One drive slot per project

A drive in one project never blocks a drive in another — the machine-wide drive slot becomes one slot per project.

- Shipped: 2026-10-15
- Laps run: 1

## What shipped

10 commits · 29 files

### Lap 1
- 3 tickets landed: #1 The drive slot becomes one per project, end to end; #2 ADR-0014 and per-app names in the prepare recipes; #4 The spec's MCP review_drive seam has no cross-project test; only the service function is exercised
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: f70655ecfd844bb5e46e015e160b68dc623a2ce4
- Landed since: 1
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 5bf28ef5c9e82e854d3f494243f942ee298fc84e
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. The drive slot becomes one per project, end to end

# Ticket 1 — The drive slot becomes one per project

## What was done
- In `packages/server/src/services/git.ts`, the single `testDriveState` became `const drives = new Map<string, DriveState>()`, read through a `driveOf(projectId)` helper. `reviewDriveRelease` became `reviewDriveReleases`, a Map keyed by project id. These now take a project id: `activeDriveInfo(projectId)`, `activeTestDriveFeatureId(projectId)`, `releaseReviewDrive(projectId)` and `recordDriveUrl(ctx, projectId, featureId, url)` (the project id is a new param). The private `watchAppReadiness` also takes one, and its late-answer guard compares against that project's entry. Every start and stop path, `holdSetupJob` and the `mergeFeature` guard read only their own project's entry. Refusal strings and deny codes are unchanged.
- `feature.driveInfo` now requires `{ projectId }`. The other callers pass `project.id`: the merge mutation, MCP `toolRetryDrive`, `launchDriveFixSession`, `prepView`, `deleteFeature`, and the review-ticket burner's `releaseDriveQuietly`.
- The web callers (ProjectShell, Workspace, ReviewBody, use-project-drive) pass their project id. Workspace's redundant `projectId === feature.projectId` check is gone. `isThisProjectDrive` / `projectDriveCard` are unchanged apart from comments.
- New test file `packages/server/test/drive-per-project.test.ts`, using two real repos. It covers every kind of drive starting in B while each kind holds A, with A untouched afterwards. It also covers per-project info, tRPC rejecting a call without a project id, A's readiness poll still landing after B starts and stops a drive, the per-project review releasers, and `prepView().dryRun` being null for B.
- Existing tests now pass project ids. The web test that said "another project's project drive blocks the card" was rewritten: a same-project dry run still blocks, and the card is `ready` when this project's drive info is null.

## Surprises
- None of note. Test files are not typechecked, so a stale call with no arguments in a test would only show up at runtime. The full suite is green: 4528 tests passed, 48 skipped.

## Left undone
- Per the ticket, ADR-0014 and the prepare skill's recipe changes are ticket 2's.
- `isThisProjectDrive` still checks `projectId`. That is redundant now but harmless, and left in on purpose.
- This ticket needed no change to the drive machinery (`.runcastle/`).

#### 5. Verify the fixes that landed

Gates verification pass — the one landed fix (#4) holds; both gates are green on 5bf28ef.

**What landed.** One fix, test-only: #4, "The spec's MCP review_drive seam has no cross-project test". Commit 5bf28ef5 adds one test to `packages/server/test/drive-per-project.test.ts` (+32 lines, no source changes).

**#4 — held.**
- The repro grep now matches: `git grep -n -E "review_drive|toolReviewDrive" feature/one-drive-slot-per-project -- packages/server/test/drive-per-project.test.ts` finds lines 13, 215, 232 and 236, where it used to find nothing.
- The test works at the MCP tool layer, as the finding asked. It seeds a running run for B's feature and holds a human test drive in A. Then it calls `toolReviewDrive(ctx, { runId }, { action: 'start' })` and `{ action: 'status' }` under B's run identity.
- It asserts four things: the start succeeds with no denial; `status.drive` is B's review drive (B's feature id, purpose `review`); that drive equals `activeDriveInfo(B)`; and A's drive info is unchanged.
- On the branch, `toolReviewDrive` resolves its project from the run's feature (`requireRunIdentity` → `getFeatureRow` → `projectForFeature` → `git.reviewDrive`). So the test covers the tool's own path, not just the service under it.
- The test has teeth. Under the old machine-wide slot, a review agent can never preempt a human drive, so `start.ok` would come back false and the test would fail.
- One deviation, and it is sound: the ticket said "review session in B", but the tool identifies its caller by a running **run**, so the test seeds a run row.

**Gates on 5bf28ef (server run).**
- `bun run typecheck` passed: core, server and web each exited 0, and so did the scripts check.
- `env -u GIT_ASKPASS bun run test` passed: 319 test files passed, 2 skipped (321 total), none failed. `drive-per-project.test.ts` ran all 10 of its tests green, including the new one.
- The stderr lines in the log are expected output from passing tests (kill-registry, docs checkpoint), not failures.
- Nothing falls outside the stated baseline (fully green).

**Plainly broken.** Nothing. Gates mode has no tour. The drift ticket 3 noted (the build-era SPEC and the review agent's prompt/tool text still say "machine-wide") is still open and is the human's call. It is not a defect in this fix.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON: Inherited Gates mode; fix #4 holds against its repro and both server gates are green on 5bf28ef
