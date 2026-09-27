# Outcome — Burns survive an OOM-killed full test run

Tell the next burn iteration when the previous agent died mid-command. Evidence from 2026-09-26, feature find-what-installs-dependencies-into-talk-worktrees: tickets 3 and 5 (logs ~/.runcastle/logs/burn-feat_LlHJ1WfPWUrR-3.log and -5.log) and ticket 4 (-4.log) have every iteration end the same way. The agent's fix and targeted test pass. It then runs `bun run typecheck; env -u GIT_ASKPASS bun run test`, which is the full suite. The log shows 'Agent idle for 3–5 minutes', then 'Agent stopped', and nothing was committed. The docker-desktop VM's dmesg shows `Out of memory: Killed process … (node)` inside the burn containers. Three burns were running at once and each suite sized its worker pool from all 28 host CPUs. The next iteration (packages/server/src/workflows/ticket-burner.ts) starts cold. It is not told the previous agent was stopped mid-command, or which command was running when it died. So it reruns the same full suite and dies the same way until max iterations (3). The ticket then fails with 'agent made no commits'. The burn guard's advice ('If it is killed for memory, run only the test files your change touches', packages/server/src/workflows/burn-guard.ts) never reaches it, because the agent itself is what got killed. Fix: when an iteration ends without a completion signal and its last recorded action was a still-running command, tell the next iteration's prompt which command it was. It should also say the process was probably killed for memory (or timed out), and to run only the touched test files instead of repeating it. Keep it runtime-agnostic (claude-code and codex). Test the prompt addition as a pure function of the previous iteration's last-command record.

- Shipped: 2026-09-27
- Laps run: 1

## What shipped

7 commits · 6 files

### Lap 1
- 4 tickets landed: #1 Tell the next burn iteration when the previous agent died mid-command.…; #2 Burner prompt: commit before running the long final checks. In the same…; #4 A burn attempt that times out or crashes mid-command never passes the command name to the next attempt; #5 Burner prompt step 5 still has the agent re-run typecheck + tests over uncommitted self-review fixes
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: a5594960067f0212b39ae1e1758020dba26a1c07
- Landed since: 2
- Outcome: done

### Lap 1 · verification

- Reviewed commit: ac09c134ce68713375d907ee56eb12e0b39f56f5
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 6. Verify the fixes that landed

Gates verification pass: both landed fixes (#4, #5) held

This pass checks two fixes from the lap-1 review (#3) against their findings. Both hold. I read each fix's diff against its finding and re-ran each repro step. I ran both gates once, in a detached scratch worktree at the branch tip `ac09c134`. The branch was never checked out, and the worktree has since been removed.

**#4: a retried attempt now names the command the dead attempt was running. Held.**
- The attempt-retry block in `ticket-burner.ts` now calls `buildRetryNotes({ error, commitCount, lastCommand: lastCommand.last() })` (L5078–5081).
- It reads the tracker inside the implementer loop's `catch`. That is after `run()` rejects and before the next attempt's `beginSetupSpan` resets the tracker.
- Nothing between L5002 (`run`) and L5078 resets the tracker. The conflict-resolver's own `beginSetupSpan` sits in a separate path (L4738).
- `buildRetryNotes` appends the "## Recovery context — the previous iteration died mid-command" section only when a record exists, so attempts that were not mid-command get the generic notes as before.
- The repro grep now shows `lastCommand` being read in the retry block.
- The new tests in `interrupted-command.test.ts` passed in the suite run. They cover an `AgentIdleTimeoutError`, an exit-137 crash, and an attempt that was not mid-command.

**#5: burner prompt step 5 now commits before the full checks. Held.**
- In `implement-ticket.md`, step 5 now tells the agent to commit its self-review fixes once their targeted tests pass, *before* it re-runs the full typecheck and test suite. This matches step 4's "Commit before the long final checks".
- The repro grep finds no "re-run typecheck + tests"; only the step-4 heading matches.
- The trailing "Commit the fixes." was removed because the new lead sentence already says it.
- The `ticket(<seq>)` convention is untouched.
- The extended assertion in `ticket-burner-units.test.ts` passed.

**Gates**
- `bun run typecheck`: exit 0. Core, server, web and scripts are all clean.
- `env -u GIT_ASKPASS bun run test`: 297 files, 4237 passed, 56 skipped, **3 failed**. The stated baseline says 0 failed, and its 118-file / 1768-test figures are stale.
- None of the 3 failures touches a file in this diff. Each one traces to the Windows host or to this review session's environment, not to the lap:
  - `project-drive.test.ts`: expected `'… topic'`, got `'… topic %DB_NAME%'`. `cmd` did not expand the variable on the Windows host.
  - `review-directory-preparation.test.ts`: it expected `/reviews/...` and got `\reviews\...`, a Windows path-separator mismatch.
  - `review-ticket.test.ts`: `AGENT_BROWSER_SESSION` was `review-tkt_BHFyrMckl0L9`. That value leaked in from this review session's own environment.
- Pass #3 also saw 3 failures in review and drive machinery. The owner should refresh the baseline or make these tests independent of the host and environment. I filed no finding against this lap.

**Tour:** Gates mode, so nothing was driven, and nothing was plainly broken.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON: both fixes hold; the 3 suite failures come from the Windows host and this session's env, in files this diff doesn't touch
