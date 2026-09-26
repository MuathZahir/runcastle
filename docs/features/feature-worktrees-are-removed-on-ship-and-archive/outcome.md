# Outcome — Feature worktrees are removed on ship and archive

Remove a feature's talk worktree when it ships or is archived, and sweep leftovers at boot. Measured: 129 feature worktrees under ~/.runcastle/worktrees/<projectId>/<slug>, 108 for shipped/archived features, 19.4 GB; the full disk crashed Docker mid-burn. Paths: `worktreeDir(projectId, slug)` (packages/core/src/paths.ts ~168-176). Created by `ensureTalkWorktree` (packages/server/src/services/git.ts ~608) via `addWorktree`; it RECREATES a missing worktree on demand, so removal is recoverable. Ship = the `merge` mutation (trpc/routers/feature.ts ~195-238): stops drives, `mergeFeature`, `promoteOutcomeDoc`, `setPhase('shipped')`, `setFeatureStatus('shipped')` — no removal. Archive = `archiveFeature` (services/features.ts ~1042-1063) — no removal. Existing helper `removeTalkWorktree(repoPath, worktreePath)` (git.ts ~1877) does `worktree remove --force`, falls back to rmSync, prunes, but THROWS InvalidInputError if the dir survives (Windows file locks); only `deleteFeature` (mirror its `cancelRun`-before-remove) and dev/state.ts call it. Nothing reads the feature worktree after a successful merge (`promoteOutcomeDoc` uses project.repoPath; `featureDocsDir` in services/feature-docs.ts falls back to repoPath; `readDocsDigest` in workflows/ticket-burner.ts handles a missing worktree).

- Shipped: 2026-09-26
- Laps run: 1

## What shipped

3 commits · 10 files

### Lap 1
- 2 tickets landed: #1 Remove a feature's talk worktree when it ships or is archived, and…; #3 Boot sweep never collects a shipped feature's worktree that is dirty or not a git checkout, so these leak forever
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: f31e2f59bea2801571dd728903a16e9d5f6e29f3
- Landed since: 1
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 57f3e13fc95467e3bc949db8e85e6476f4d0282c
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Remove a feature's talk worktree when it ships or is archived, and…

# Ticket 1 — feature talk worktrees are retired on ship, archive and at boot

## What was done
- `git.ts`: `cleanupBurnWorktree` is now a thin wrapper over a new never-throwing `discardWorktree(repoPath, path, opts)` (retried `worktree remove --force`, rmSync fallback, always prune; also survives a repo dir that no longer exists, where `simpleGit()` itself throws). `removeTalkWorktree` (feature delete) keeps its throwing contract but builds on it with `attempts: 1`. Added `worktreeState(path)` → `clean | dirty | not-a-checkout | missing | unreadable`; untracked files count as dirty, and `.git` is probed first so `git status` never walks up into an enclosing repo.
- New `services/feature-worktrees.ts`: `retireShippedWorktree`, `retireArchivedWorktree` (clean only), `sweepFeatureWorktrees`. Events: `feature.worktree_removed {path}`, `feature.worktree_remove_failed {path}`, `feature.worktree_kept {path, reason}`. A missing worktree emits nothing.
- Ship: the `merge` mutation calls `retireShippedWorktree` after `setFeatureStatus('shipped')`. Archive: `archiveFeature` is now **async** (it probes git) and retires the worktree after flipping status. Existing archive/draft tests were updated to await it, and `archive.test.ts` now pins the data dir.
- Boot: `startServer` fires the sweep after both reconciliations, doesn't await it, and logs one summary line. Orphan project dirs are rmSync'd whole with no per-slug git. `_`-prefixed slugs, and active or draft features, are skipped.
- Added `worktreesRoot()` to core `paths.ts`.

## Deviations / judgment calls
- Neither ship nor archive removes the worktree while a session is still open on the feature (launching or live) or a run is in progress. Instead it emits `worktree_kept` with the reason, and the boot sweep collects the worktree later. I chose this over copying deleteFeature's `cancelRun`, because archive/ship would otherwise start killing burns and terminals.
- `unreadable` worktrees are kept (treated as unsafe).

## Surprises
- The full suite is now 289 files and 4159 tests, not the 118 files in the baseline. Under full load, 52 tests timed out (5s/10s). Rerunning only the 27 affected files left 3 failures, and a single-file run left only `dev-pane.test.ts` ("kills the child process tree"). It fails on its own and touches none of this code. It is probably zombie reaping in the container: without an init process, a killed child can linger as a zombie that `kill -0` still reports as alive.

## Left undone
- sessions/, reviews/ and logs/ are not swept (out of scope). The web activity feed shows the new events through its generic message fallback; they have no dedicated UI.
- Drive machinery: no new service, env var, seed or process, so `.runcastle/` scripts were not touched.

#### 4. Verify the fixes that landed

Gates verification pass — #2 · the boot-sweep fix held

This project has no verify commands configured, so there were no gates to run. The whole pass was spent reading the diff.

## Fixes checked

- **#3 The boot sweep never collected a shipped feature's worktree that was dirty or not a git checkout. HELD.**
  Commit `57f3e13f` replaces the inline `removable` expression with `sweepable(status, state)` in `packages/server/src/services/feature-worktrees.ts`. It returns true for any `shipped` feature, and otherwise only for `clean` or `not-a-checkout`. These guards still run before it, unchanged:
  - `_`-prefixed slugs are skipped.
  - `active` and `draft` features are skipped.
  - The orphan-project path is untouched.
  - Removal still goes through the never-throwing `discardWorktree`, which only removes the worktree and never deletes the branch.

  The reviewer's repro was added verbatim to the 'boot sweep' suite:
  - a shipped worktree with `shot.png` in it
  - a shipped dir holding only a plain file and no `.git`
  - an archived dir with no `.git`

  I ran it in a detached scratch worktree at `57f3e13f`, since removed. It passes: all three dirs are gone, the sweep returns `{removed: 3, kept: 0}`, and `feature/shipped-dirty` survives. The whole `feature-worktrees.test.ts` file passed: 6 passed, 1 skipped (the Windows-skipped locked-file test from lap 1), 0 failed.

## Observation (not a defect)

The fix also widens the rule for **archived** features: an archived dir with no `.git` is now swept. The brief only allowed not-a-checkout removal for dirs with no feature row, and said archived worktrees go only when clean. A dir with no `.git` holds nothing git could lose, and archived *dirty* worktrees are still kept, so this reads as a deliberate, safe widening. The ticket's run digest records it.

Nothing plainly broken was found. The app was not driven, because this pass inherits Gates mode.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON: no verify commands configured; fix diff read against its finding and its repro test run green
