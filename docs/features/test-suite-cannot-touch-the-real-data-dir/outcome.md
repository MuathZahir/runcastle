# Outcome — Test suite cannot touch the real data dir

Isolate the whole test suite from the developer's real ~/.runcastle, and make a regression impossible to miss. Measured on the maintainer's machine: ~/.runcastle/worktrees/ held 5,385 leaked directories (almost all empty `proj_<id>/`), plus real worktrees named after test fixtures (`alpha-feature`, `beta-feature`, `kept-feature`, `busy-feature`) and a stray `~/.runcastle/ws-input-test.ts`. Cause: `dataDir()` (packages/core/src/paths.ts ~43-46) honours `RUNCASTLE_DATA_DIR` or falls back to `join(homedir(), '.runcastle')`; the root `vitest.setup.ts` only DELETES inherited `RUNCASTLE_*` vars, which forces that fallback for every test that does not opt in via `useDataDir(home)` (packages/server/test/helpers/data-dir.ts). Known unisolated: `packages/server/test/projects.test.ts` (real repos + createFeature), describe blocks in `git.test.ts` (e.g. mergeFeature ~l.1522, createFeatureBranch); probably ~50 more files (archive, draft-features, feature-list, kickoff, launch-artifacts, session-lifecycle, resolve-conflict, review-wires, research, ticket-burner, lap-kickoff, resume-reentry, waypoint-work, converge, burn-from-review; draft-features and resolve-executable set HOME/USERPROFILE but not RUNCASTLE_DATA_DIR). A prior feature already flagged this as left undone: docs/features/scaffold-commit-lands-on-the-feature-branch-not-the-checkout/outcome.md:60.

- Shipped: 2026-09-26
- Laps run: 1

## What shipped

5 commits · 13 files

### Lap 1
- 2 tickets landed: #1 Isolate the whole test suite from the developer's real ~/.runcastle,…; #3 create_feature tests still leak their tmpRepo() fixture repo into %TEMP% on every test run
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: c76c940cb484a6c5d44530ad6f95d27d81c8c08a
- Landed since: 1
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 3d24f1b9a66387651926ae5b5cb4f8313a99ecd5
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Isolate the whole test suite from the developer's real ~/.runcastle,…

# Ticket 1 — test suite cannot touch the real data dir

**What was done**
- `vitest.setup.ts`: kept the `RUNCASTLE_*` scrub, then pins `RUNCASTLE_DATA_DIR` to a fresh `mkdtemp` dir (`runcastle-data-*`) and removes it in `afterAll`. Setup files run once per test file, so the dir is per file (finer-grained than the "per worker" the ticket asked for). `useDataDir` still overrides it and puts it back.
- Guard in `packages/core/src/paths.ts` `dataDir()`: when `VITEST` is set and the resolved dir is the real `~/.runcastle`, it throws. "Real" means `os.userInfo().homedir` (the account's home from the user database), not `homedir()`, because `homedir()` follows a test's HOME override. If `userInfo()` throws, it falls back to `homedir()`. The guard also catches an explicit `RUNCASTLE_DATA_DIR` that points at the real tree. `paths.test.ts` now covers it: the guard throws when the pin is cleared, throws when pinned to the real tree, and the setup pin lands under tmpdir. The two "fallback" tests now run under a temp HOME, and the file restores env vars instead of deleting them.
- `addWorktree` (git.ts): if the add (including its repair retries) fails, it `rmdir`s the `worktrees/<projectId>/` parent. `rmdir` only removes an empty dir. New test in `ensureTalkWorktree`: with the branch checked out in the main repo, the call throws and `projectWorktreesDir` does not exist.
- New `withTempDataDir()` in `test/helpers/data-dir.ts` creates the temp home, pins it, and on restore also deletes it. I used it in feature-create, quick-change, project-mcp-tools (that one previously leaked), docs-digest-size, image-target-heal and test-notes.

**Verification**
- `bun run typecheck`: 0 errors.
- Full suite: 289 files, 4137–4138 passed, 35 skipped. That is far more than the 118/1768 baseline in the prompt, which looks stale.
- 3 failures, none caused by this change:
  - `dev-pane.test.ts` "kills the child process tree" fails with this change reverted too. It is an environment issue, pre-existing but not in the listed baseline.
  - The `settings-dialog`, `project-session` and `quick-change` timeouts happened under heavy machine load (import time over 1000s) and pass when run on their own.
- Real data dir: in this sandbox ~ is fresh. `~/.runcastle` did not exist before the first run and still did not exist after two full runs. There are no `/tmp/runcastle-data-*` leftovers.
- The guard never fired in the suite, so no test file needed patching.

**Surprises**
- The 11 files that `delete process.env.RUNCASTLE_DATA_DIR` all do save-and-restore, so they put back the setup pin correctly.

**Left undone**
- About 12 other files still hand-roll `mkdtemp` + `useDataDir(home)` without removing `home` (for example project-session, runner, chat-contract, prepare-session, kickoff-telemetry, docs-watch, chat-door, setup-doctor-env). That is a temp-dir leak, not a data-dir one. burn-attachments and read-tool-ceiling also use `home` for other things, so I left them.
- I did not delete anything already leaked in the real ~/.runcastle.
- No drive-machinery change was needed: no new service, env var, seed or process.

#### 4. Verify the fixes that landed

Gates verification pass — verifies pass #2

## Fixes checked

**#3 create_feature tests leaked their tmpRepo() fixture repo into %TEMP%: held.**

- **Diff vs. finding (commit 3d24f1b9).**
  - `project-mcp-tools.test.ts`: `afterEach` now calls `rmTemp(repoPath)`. `repoPath` comes from `gitRepo()` → `tmpRepo()`, and that is the only temp dir the file makes.
  - `feature-create.test.ts`: a local `repoDir()` records every `tmpRepo()` it hands out: `repoPath`, the two unborn repos and the bare `origin` remote. `afterEach` removes them all. No bare `tmpRepo()` calls are left.
  - Both files get their data home from `withTempDataDir()`, which removes the home on restore.
  - This covers what the finding asked for, plus the three extra fixture dirs a one-line fix would have missed.
- **Repro re-run.** I ran it at 3d24f1b9 in a detached scratch worktree, with inherited `RUNCASTLE_*` vars unset. First I counted `runcastle-test-*` dirs in the OS temp dir, then ran `bunx vitest run packages/server/test/feature-create.test.ts packages/server/test/project-mcp-tools.test.ts`, then counted again.
  - The count was 839 before and 839 after: no growth.
  - All 2 files and 43 tests passed.
  - No `runcastle-data-*` dirs were left over either.
  - The 839 are older leftovers from other suites and runs, which is outside this ticket.
- **Gates.** This project has no verify commands configured, so no gates ran. The only command run was the repro above.

## Anything plainly broken

Nothing in the surfaces this fix touched. I removed the scratch worktree afterwards.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON: fix #3 held — diff matches the finding and the repro no longer grows the runcastle-test-* count; no verify commands configured
