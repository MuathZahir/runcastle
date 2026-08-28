## Why this exists

Source: 2026-08-27 runcastle audit, item B1, ranked #2 saving (~10–25 min per feature).

ADR-0005's post-commit hook in the isolated clone does `git push HEAD:<tempBranch>` to the bind-mounted Windows workspace AND `git -C /home/agent/workspace reset --hard <tempBranch>` on every commit. The bind mount crossing measured 52.7 s cold / 6.8 s warm (vs 0.1 s native), so each commit costs 15–90 s; features made 28–37 commits ≈ 19–25 min of pure tax. Agents noticed: one wrapped every commit in `timeout 300 git commit`; one submitted the same commit twice after a hook failure. ~20 % of commits were comment-only self-review commits that paid full price.

## What is already settled

- ADR-0005 chose the per-commit push so commits survive a dead agent with zero agent discipline. That property must be kept — ADR-0006's attempt chaining depends on it.
- ADR-0005 explains why the reset exists: sandcastle's end-of-run dirty check on the mounted worktree must stay clean, and `receive.denyCurrentBranch=ignore` moves only the ref.
- ADR-0008 consequences already flagged this cost and said deferring the reset "needs a sandcastle teardown hook, which does not exist." The audit's observation is that nobody reads that tree mid-burn, so a single post-run step is enough.

## Shape to work out in ideation

- Background the push (fire-and-forget from the hook; the orchestrator reconciles at run end — verify the temp branch ref matches the clone's HEAD before landing, and re-push if not).
- Move the reset: the host owns that worktree, so the orchestrator can `reset --hard` it host-side (native speed) right before sandcastle's dirty check or at landing — no sandcastle change required. Confirm exactly when sandcastle's dirty check runs relative to runcastle's control.
- Whether a failed background push should surface at all mid-burn (a hook failure that the agent sees causes double commits).
- Optional prompt nudge, not a rule: "at most 3–4 slice commits; never commit a comment-only change on its own." (Lives in the quick change `burn-guard-and-prompt-rules` if it lands first; do not duplicate.)

This amends ADR-0005 (and the ADR-0008 consequence paragraph) — record a new ADR or amend in place.

## What this must NOT swallow

- Persistent caches (B0) — different mount, different problem.
- Anything about commit frequency as an enforced rule; ADR-0008's "commit every green slice" stays.
