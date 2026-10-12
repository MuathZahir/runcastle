# Outcome — Burn worktrees stay out of the project's git status

A burn leaves `.sandcastle/worktrees/<branch>` inside the registered project's checkout (sandcastle's `branch` strategy; path derived by `burnWorktreePath` in `packages/server/src/services/git.ts`), and runcastle never hides it from git. In a project whose `.gitignore` does not mention it, the folder shows up as untracked in the human's `git status`, and `git add -A` warns about an embedded git repository because each worktree carries its own `.git` file. A user hit exactly this and had to ask whether to gitignore it. Fix: before a burn creates its first worktree for a project, add the pattern `.sandcastle/worktrees/` to that repo's `.git/info/exclude` using the existing `excludePath(repoPath, pattern)` helper in `services/git.ts` (it is idempotent, safe under parallel tickets, and resolves against the common git dir so it covers every worktree). Call it from the burn path in `packages/server/src/workflows/ticket-burner.ts`, next to where the attachments exclude is written, but unconditionally (not only when there are attachments). Unlike the attachments pattern, this line is PERMANENT: do not `unexcludePath` it at the end of the burn — the directory is runcastle machinery for the life of the project, and preserved worktrees from failed burns must stay hidden too. Exclude only `.sandcastle/worktrees/`, never the whole `.sandcastle/` directory: runcastle's own repo (and any project that dogfoods sandcastle directly) tracks real files there (`.sandcastle/Dockerfile`, the prompt files) and new files beside them must stay visible. Never write to the project's `.gitignore` — that is the human's file and editing it dirties their tree. Add a test alongside the existing exclude/attachments coverage (see `packages/server/test/burn-attachments.test.ts` and `packages/server/test/git.test.ts`) proving: the pattern is present in `info/exclude` after the burn-side setup runs, it is written once across repeated and concurrent calls, it survives the end-of-burn attachment cleanup (`clearAttachments` still removes only its own pattern), and a human's pre-existing lines in `info/exclude` are left byte-for-byte intact.

- Shipped: 2026-10-12
- Laps run: 1

## What shipped

7 commits · 8 files

### Lap 1
- 4 tickets landed: #1 A burn leaves `.sandcastle/worktrees/<branch>` inside the registered…; #3 Test gate is red on the branch: README no longer matches readme.test.ts (broken on main since b29b7ed2, not by this lap); #4 The review's gate run still creates a worktree under .sandcastle/worktrees/ without writing the exclude first; #5 Test gate is red: a buildBurnAgent test reads the real process env and fails wherever CLAUDE_CODE_OAUTH_TOKEN is set (not caused by this lap)
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 19b59c992e3842568e25d1519cede26ca8e008e5
- Landed since: 3
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 9890a2f7dfbf3879f4fb4808967697eb03f64b4b
- Landed since: 0
- Outcome: done

- **Test gate is still red at 9890a2f on one test only: dev-pane process-tree kill (same failure pass #2 noted; not in this lap's diff)** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. A burn leaves `.sandcastle/worktrees/<branch>` inside the registered…

# Ticket 1 — burn worktrees stay out of the project's git status

**What was done.** Added `excludeBurnWorktrees(repoPath)` to `packages/server/src/workflows/ticket-burner.ts`, beside `clearAttachments`. It calls the existing `excludePath` helper with the new module constant `BURN_WORKTREES_PREFIX = '.sandcastle/worktrees/'`. `burnTicket` calls it every time, right after the attachments exclude/clear closures are defined. That is before the attempt loop, so it runs before sandcastle creates any worktree. Nothing ever un-excludes it: it is permanent by design, and `clearAttachments` still removes only `.runcastle-attachments/`. `.gitignore` is never touched. Three tests were added to `packages/server/test/burn-attachments.test.ts` ("preparing the workspace" block):
- After the call, the line is in `info/exclude` and the human's `git status` is clean. A new `.sandcastle/Dockerfile` next to it still shows up, and no `.gitignore` is created.
- The line is written exactly once across repeated and concurrent calls.
- It survives attachment cleanup, and the human's CRLF and comment lines stay byte-for-byte intact.

**Surprises.** Full suite: 2 failures, both outside this diff, and both also fail when run on their own:
- `readme.test.ts`: the README prerequisites wording no longer matches the test's regex.
- `dev-pane.test.ts`: "kills the child process tree" fails because the process group is still alive inside this sandbox.

The prompt's baseline said 0 failures, so these are either environment problems (dev-pane) or drift already on the branch (README). Typecheck is clean.

**Left undone.** The exclude goes on every burn, including resolver-only and conflict-resume attempts, because it runs before the attempt loop. That is intended. Projects already hit by this get the line on their next burn; there is no migration for checkouts that are idle. Drive machinery needed no change: no new service, env var, seed or process.

#### 3. Test gate is red on the branch: README no longer matches readme.test.ts (broken on main since b29b7ed2, not by this lap)

# Ticket 3 — README prerequisites test matches the redesigned README again

**What was done.** I widened the third assertion in "documents prerequisites including the Windows node requirement" (`packages/server/test/readme.test.ts:31`) so it also accepts `paid Claude plan`. That is the wording README.md:76 has used since the b29b7ed2 redesign. The README itself is unchanged, because the test's own doc comment says it checks content contracts, not prose, "so the README can be reworded freely". The contract it checks (a paid Claude plan is required) still holds. This was one commit, e49c3c10.

**Repro re-run.** I ran `bunx vitest run packages/server/test/readme.test.ts` after the change: 9 of 9 passed, where "documents prerequisites…" failed before. The reviewer's static `grep -c` still prints 0, because it uses the old regex and the README did not change. The same grep with the widened regex prints 1.

**Gates.** `bun run typecheck` passed with exit 0. `env -u GIT_ASKPASS bun run test` exited 1: 5 of 4,493 tests failed in 4 files, and none of them is the README test.
- When I re-ran just those 4 files, 3 passed: project-drive, project-session and quick-change. Those failures only happen under full-suite load.
- One failure is left: `dev-pane.test.ts > kills the child process tree…`. It fails every time in this Linux container. The review of ticket 2 already flagged it as a property of the sandbox, not something this lap broke.
- The burner test that reads the real environment did not fail in this sandbox.

**Surprises.** The baseline note in the prompt ("118 files, 1768 passed, 0 failed") is out of date: the suite now has 314 files and 4,493 tests. The review said the same.

**Left undone.** I did not touch the dev-pane test, the load flakes, or the baseline note. All three are outside this ticket.

#### 5. Test gate is red: a buildBurnAgent test reads the real process env and fails wherever CLAUDE_CODE_OAUTH_TOKEN is set (not caused by this lap)

## What was done
Fixed the environment-dependent test "buildBurnAgent — child environment > keeps the host environment when there is no token to pass" in `packages/server/test/ticket-burner-units.test.ts`. The test now runs `vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', undefined)` before it calls `buildBurnAgent` and runs `vi.unstubAllEnvs()` in a `finally` afterwards. That way the assertion checks `buildBurnAgent` and no longer depends on the machine running the suite. Only the test changed; production code is untouched. Committed as b2b0b26b.

I re-ran the exact repro step: `CLAUDE_CODE_OAUTH_TOKEN=sk-dummy bunx vitest run packages/server/test/ticket-burner-units.test.ts -t "keeps the host environment when there is no token to pass"`. It now passes (1 passed, 188 skipped). The whole file passes too (189/189).

## Surprises
The full suite counts are 4493 tests: 4445 passed, 46 skipped and 2 failed. The prompt's baseline of 1768 tests is out of date. The 2 failures are the ones the lap review already attributed to causes outside this lap:
- `readme.test.ts` prerequisites: the README drifted on main.
- `dev-pane.test.ts` "kills the child process tree": the Linux sandbox is the likely cause.
Neither involves this file. Typecheck passed.

## Left undone
Other tests in this file that read the host env were not audited beyond this one case.

Drive machinery was not affected, since this change touches tests only.

#### 6. Verify the fixes that landed

Gates verification pass — all 3 fixes from pass #2 held · test gate still red on 1 test outside this lap · no new defects

All three fixes that landed after pass #2 do what their findings asked. The server ran the verify commands on the fixed branch at 9890a2f: typecheck passed, and the test command failed with one failing test out of 4,494, down from three at 19b59c9. Nothing was driven in a browser; this pass read each fix diff against its finding and read the server's gate logs. No verify command was run from here.

**#3 README prerequisites test — held.** The test's third assertion now also accepts "paid Claude plan", which is what README.md:76 says. The README itself is unchanged, which is the right side to move: the test's own comment says it checks content, not wording. `readme.test.ts` passes 9 of 9 in the gate run. The reviewer's static grep still prints 0, as expected, because it uses the old pattern; the widened pattern matches line 76.

**#4 Review gate run excludes the worktrees folder — held.** `excludeBurnWorktrees` now lives in `services/git.ts` beside `burnWorktreePath` and has two callers: the ticket burn (ticket-burner.ts:4392) and the review's gate run (review-gates.ts:151). In the gate run it sits after the branch is pinned and before any sandbox opens (the `createSandbox` call is at :310), inside the try block, so a failure to write the line becomes a "couldn't run" record instead of an exception. The new test in `review-gates.test.ts` creates the worktree folder with its `.git` file inside a faked sandbox, finds `git status` empty while the gates run, and finds the exclude file equal to the human's bytes plus the one line. It passes (10 of 10). I also checked the paths the fix did not touch:
- The review agent's own run uses sandcastle's `head` strategy, so it creates no worktree.
- With no verify commands configured, the gate run returns before the exclude, but it opens no sandbox either.
- The cache probe creates its sandbox in a scratch repo, not a project.

The live half of the repro, a review-only run in a real project, was not exercised: this is Gates mode, and the fake-sandbox test is the evidence for it. Moving the helper also closes pass #2's note that the path was spelled in two files.

**#5 Environment-dependent burner test — held.** The test now clears `CLAUDE_CODE_OAUTH_TOKEN` with `vi.stubEnv` before calling `buildBurnAgent` and restores it in a `finally`. `buildBurnAgent` reads the process environment at call time, so the stub takes effect. `ticket-burner-units.test.ts` passes 189 of 189 in the gate run, where this case failed before. The gate log does not show whether the token was set in the sandbox this time, so the proof is the code plus the passing run, and ticket 5's own re-run of the repro with a dummy value. Only the test changed.

**Still red: one test, not this lap's.** `dev-pane.test.ts` "kills the child process tree so the port-holder is not orphaned" fails at line 183. Pass #2 already recorded it as an observation. The branch changes no dev-pane code and not this test. It has now failed in both gate runs and in four ticket sandboxes, so it is deterministic in the Linux sandbox; the suite is skipped on Windows, so the owner's machine never runs it. The likely cause is a killed child that nothing reaps inside the container, which I read from the code and did not confirm. Until the test or the sandbox changes, every gate run on this project will report the test command as failed. Recorded as an observation.

**Carried from pass #2, unchanged.**
- The Claude OAuth token printed into the earlier gate log (`reviews\tkt_Zvj6MO2BAag4\gates\1.log`) is still there. This pass's logs contain no token. Rotating it remains the owner's call.
- The project's baseline note still promises 118 files and 1,768 passing tests with zero failures. The suite is 314 files and 4,494 tests with this one standing failure, so the note should be refreshed.
- The ticket burn's exclude call still sits outside `burnTicket`'s try block, and no test proves `burnTicket` calls it. Both were notes, not defects.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON: Gates mode run in full at 9890a2f; all three fixes held, typecheck passed, and the test gate failed on one dev-pane test that this lap's diff does not touch.
