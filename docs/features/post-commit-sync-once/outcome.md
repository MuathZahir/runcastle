# Outcome — Post-commit sync once

Stop the isolated burn's post-commit hook from paying the bind-mount tax synchronously on every commit: background the push and do the host-side reset once at landing.

- Shipped: 2026-08-28
- Lap: 1

## 1. Push-only post-commit hook, host-side worktree removal, ADR amendments

# ticket(1) — push-only post-commit hook, host-side worktree removal, ADR amendments

**What was done.** The post-commit sync hook that `buildRepoSetupSteps` installs (feeding both
`buildIsolatedSetupCommand` and `buildSlotSetupCommand`) is now push-only: `git push --quiet origin
HEAD:<tempBranch>`, and on failure a `sleep 2` plus one more push, then a single stderr line
(`runcastle: commit sync failed (will retry on your next commit); do not re-commit`) and `exit 0`.
The `git -C /home/agent/workspace reset --hard` is gone. Same printf-with-args delivery, so the
branch name is still never shell-interpreted, and the `core.hooksPath` re-pin is still the last step.

Because the mounted worktree is now always dirty, sandcastle preserves it, so `burnTicket` removes it
host-side. I added a memoized local `discardWorktree(branch)` wrapping the existing
`cleanupBurnWorktree`, called at the top of the attempt loop's `catch` (covering stopped-by-user,
merge conflict, missing binary, retryable-`continue`, non-retryable failure, and run cancellation)
and, on the success path, immediately after the BLOCKED.md/DIGEST.md harvest and before `landChain`.
The existing `isWorktreeTeardownError` branch now goes through the same helper, so it still reports
whether the directory went away without paying the retry loop twice. `runResolver` got the same
treatment on both its failure and success paths, not just the teardown-only one.

ADR-0005 has a dated `Amended: 2026-08-28` status line, a rewritten hook bullet, and a consequence
noting the one-pack-push cost plus the two positive side effects; ADR-0008's "needs a sandcastle
teardown hook" paragraph is replaced with the mechanism actually shipped.

**Surprises.** `burn-slot-workspace.test.ts` has a *real-git* drive of the hook
("arms the post-commit hook…") that asserted the mounted working tree got the file — it had to
invert to `not` the file, keeping the ref assertion. Worth knowing: the workspace's `revparse HEAD`
still tracks the pushed commit without any reset, because the push moves the ref HEAD points at;
only the working tree and index go stale. I used that seam to add a second real-git test that breaks
`origin` and asserts the failure line reaches stderr while the commit still lands.

`burnTicket` is not reachable from any test — `run` is imported straight from `@ai-hero/sandcastle`
and only `executeTicketRun` is faked (in `ticket-burner.test.ts` / `review-ticket.test.ts`), so
acceptance criterion 5 is covered at the git seam instead: a new `git.test.ts` case commits inside a
burn worktree, dirties it, removes it, and asserts the branch and its commits survive
(`branchCommitsAhead` still reports them). Criteria 3 and 4 rest on typecheck plus reading, as the
ticket allowed.

**Verification.** `bun run typecheck` — clean. `env -u GIT_ASKPASS bun run test` — 144 files,
2458 passed, 4 skipped, **1 failed**: `packages/server/test/dev-pane.test.ts:183`
(`expect(pidAlive(-pgid)).toBe(false)`). It fails identically on a targeted run, is a process-group
reaping check in this container's PID namespace, and touches nothing in my diff (the diff is
`ticket-burner.ts` plus tests and two ADRs). Note the baseline quoted in my prompt (118 files, 1768
passed) does not describe this repo — the suite is 144 files / 2463 tests here — so treat the stated
baseline as stale rather than as evidence this failure is new. Drive machinery: no service, env var,
seed or process was added, so `.runcastle/drive-setup.ts` and `drive-stop.ts` needed no edit; I
confirmed both files still exist and are untouched, and did not run them (no services in the sandbox).

**Left undone.** Two things I deliberately did not touch. (1) There is no harness that drives
`burnTicket`'s attempt loop; building one (a `vi.mock` of `@ai-hero/sandcastle` plus a real fixture
repo) would give direct coverage of the per-exit-path cleanup and of attempt chaining, and would pay
for itself across future burner tickets — but it is a test-infrastructure ticket of its own.
(2) The hook lets git's own push errors through to stderr alongside our line; decision 2 explicitly
rejects silent swallowing, so that is intended, but an agent reading a failed burn will see 2–3 git
error lines before the calm one.

## 2. Review: push-only sync hook and host-side worktree cleanup

This lap takes the stall out of burns. Until now, every commit an agent made inside a containerised burn triggered a hook that pushed the commit back to your machine and then rebuilt the whole checked-out copy of the repo sitting on the host — a copy nothing ever reads. That rebuild had to touch every tracked file across Docker's filesystem bridge, which is why commits could hang for a minute at a time and why, over a feature's thirty-odd commits, twenty-odd minutes of a burn went into pure bookkeeping. Agents had noticed: the transcripts show one wrapping every commit in a timeout and another re-committing work it thought had been lost.

The hook now pushes and stops. If the push fails it waits two seconds, tries once more, and — if that also fails — prints a single calm line telling the agent the sync will heal on its next commit and not to re-commit. Nothing else. Because the host copy is no longer kept in step, it ends every run looking modified, so the sandbox leaves it alone and runcastle deletes it afterwards instead, on every way a ticket attempt can end and always after the agent's BLOCKED.md and DIGEST.md have been read out of it. Two nuisances go away with it: the Windows "Directory not empty" teardown flake stops arising on the normal path, and the abandoned worktrees that used to pile up under .sandcastle/ now get cleaned. Commits still land on the temp branch the instant they are made, a dead agent still leaves its work behind, and retry, conflict resume and landing are untouched — I confirmed the cleanup cannot take a branch with it.

What is worth your attention is the shape of the cleanup rather than the hook. The hook is exactly what was promised: I pulled the generated script out of both builders, ran it through a shell parser, and it is seven correct lines with no reset and no timeout anywhere. The cleanup, though, was written to run in all workspace modes, and in the one mode where the agent works directly in that host copy rather than in a container clone — the mode a Linux host picks by default — it now deletes the agent's own working directory, including any uncommitted work, where previously nothing did. The spec had explicitly put that mode out of scope. Two smaller things sit alongside it: cancelling a run now waits for the deletion's retry loop before it takes effect, and the new test that proves the hook no longer rebuilds the checkout is inside a block that skips on Windows, so on this machine the lap's central regression guard never actually runs.

One correction to the record: the implementing ticket reported a failing test it blamed on the container. On this machine the suite is green on both branches — I ran it twice on the feature branch and once on main. The branch did once exit non-zero with zero failing tests, from an unrelated flaky pipe error in the terminal sidecar, which is its own small trap for anything that reads exit codes.

The saving itself is still unmeasured. The split between the push and the deleted rebuild was reasoned from the shape of the two operations, not timed, and the spec is honest about that — the timing telemetry on your first real burn after this lands is what will confirm it.
