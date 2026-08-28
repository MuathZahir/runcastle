# Post-commit sync once

## Problem

In the isolated and slot burn workspaces (ADR-0005, ADR-0011's cache volume), every agent commit fires a post-commit hook that pushes the commit to the bind-mounted host worktree **and** hard-resets that mounted working tree to the new tip. The reset stats every tracked file across Docker Desktop's filesystem translation layer, so each commit costs 15–90 s of pure mount tax. Features make 28–37 commits; that is ~19–25 minutes per feature spent syncing a working tree nobody reads. Agents notice the stall: one wrapped every commit in a `timeout`, another re-committed the same work after a visible hook failure. ADR-0008 asks agents to commit every green slice, which multiplies the cost.

## Approach

From the operator's perspective: burns get faster and nothing else changes — commits still appear on the temp branch the instant they are made, dead agents still leave their commits behind, landing and retry work exactly as before, and the transcript no longer shows agents fighting the hook.

The shape (decisions 1–2):

- **The hook becomes push-only.** The post-commit hook installed by the shared repo-setup steps (used by both the isolated clone and the slot checkout) pushes `HEAD` to the temp branch on the mounted workspace and stops there. The `reset --hard` of the mounted working tree is deleted, not deferred: nothing reads that working tree. Sandcastle's commit collection for the `branch` strategy reads the host ref; later iterations clone or fetch through refs; landing merges the ref; BLOCKED.md and DIGEST.md are untracked files copied in by the agent. The push stays synchronous because the hook runs inside the container, which sandcastle removes seconds after the agent exits — a backgrounded push would put the ticket's final commit at risk with nothing on the host to reconcile against.
- **The hook retries once and reports once.** On a failed push the hook pauses briefly and pushes again. If that also fails it writes one stderr line — `runcastle: commit sync failed (will retry on your next commit); do not re-commit` — and exits. Git ignores a post-commit hook's exit status, so the commit itself is never affected; a later push of `HEAD` carries every unpushed commit. No `timeout` wrapper, no other output.
- **The host removes the worktree after the run.** With no reset, the mounted worktree is always dirty at sandcastle's end-of-run check, so sandcastle preserves it (printing its "preserved" line) and never attempts its own `worktree remove`. The burner then removes it host-side using the existing retrying burn-worktree cleanup helper — on **every** exit path of a ticket attempt (landed, failed, stopped by the user, retried as a new attempt, resolver runs included), strictly **after** the BLOCKED.md / DIGEST.md harvest and attachment clearing that read from the preserved path, and before landing. Removing the worktree never removes the temp branch, so the attempt chain that retry and conflict-resume depend on is untouched. No host-side `reset --hard` is performed.
- **ADRs amended in place** (decision 3): ADR-0005 gains a dated *Amended (2026-08-28)* status line and its hook-steps bullet describes the push-only hook plus host-side removal; ADR-0008's consequence paragraph about needing a sandcastle teardown hook is replaced with the actual mechanism. No new ADR.

Expected side effects, both positive and both to be preserved: the Windows `Directory not empty` teardown flake originates in sandcastle's own `worktree remove`, which no longer runs on the happy path; and preserved DIGEST-dirty worktrees, which today accumulate under `.sandcastle/worktrees/` after landing, are now cleaned up.

The `mounted` and `noSandbox` workspace modes install no sync hook and are untouched. The research and cache-probe workflows never commit through the hook and are untouched.

## Seams

- **Repo-setup command builders** (existing, pure): the isolated and slot setup-command builders return the shell string that installs the hook. Tests observe the hook body: push-only, one retry, the exact single failure line, and the absence of any `reset` of the mounted workspace. The existing unit tests that pin the old hook string are updated here.
- **Ticket attempt exit paths** (existing, the burner's per-ticket run loop): observe that the burn-worktree cleanup is invoked for the attempt's temp branch on landed, failed, stopped, retried and resolver paths, after the agent-file harvest and before landing — and that the temp branch survives it. The existing burner unit tests (run-result interpretation, attempt chaining) are the harness.
- **Burn-worktree cleanup helper** (existing, git service): unchanged contract — best-effort, never throws, returns whether the directory is gone. Reused, not modified.
- **Timing telemetry** (existing): the per-ticket `git` category share is the in-product measure of the saving; no new event is added.

## Out of scope

- Backgrounding the push or any run-end reconciliation of clone HEAD against the temp branch (rejected in decision 1).
- Persistent caches and the cache volume (B0) — different mount, different problem.
- Commit-frequency rules or the cadence prompt nudge; the nudge already shipped in `burn-guard-and-prompt-rules` and ADR-0008's "commit every green slice" stands.
- Any sandcastle change or patch regeneration (ADR-0011).
- The `mounted` / `noSandbox` modes, and the research / cache-probe workflows.

## Open questions

- None blocking. The split of cost between push and reset was inferred from the operations' shapes (per-file stats vs. one pack write), not measured in isolation; the timing telemetry on the first real burn after this lands is the confirmation.
