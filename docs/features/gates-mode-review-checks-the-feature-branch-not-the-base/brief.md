## Why this exists

A Gates-mode review pass runs the project's verify commands (typecheck, test) as its first act, and the review page reports the result as part of the lap's verdict. But those commands run against the **base branch's code**, not the feature branch under review. So "gates passed" in a Gates-mode review currently proves only that main is green.

How it happens (verified in code, 2026-09-30):

1. `packages/server/src/workflows/review-ticket.ts` runs the review agent via sandcastle with `cwd: project.repoPath` and `branchStrategy: { type: 'head' }` — the human's real checkout, no worktree, no branch switch. The comment beside `BASE_BRANCH` in `reviewTicketOutcome` states it outright: "HEAD is still the base branch at step 1 — the merge that landed the lap fast-forwards the feature REF without any checkout".
2. The prompt (`packages/skills/burner/review-ticket.md`, step 2b "Pin the fixed point" and the hard rules) tells the reviewer it is on `{{BASE_BRANCH}}` and **forbids** checking out `{{FEATURE_BRANCH}}` or leaving a worktree holding it; the branch is read only via `git diff` / `git show`. Only Drive mode switches the checkout (through `review_drive start`).
3. `buildGateNotes` then says "run exactly these" verify commands, with nothing directing them at the feature branch — so they execute against the base branch's working tree.

The reviewers themselves keep noticing. From live ticket digests/reasons:
- feat_AEl7oQ8_-U5E #3: "gates ran on main's checkout (branch not checked out per rules); branch correctness verified by diff reading and implementer-reported green runs"
- feat_vJMk3uLZvPcn #4: "prescribed test gate ran against main (checkout on main); the branch suite ran in a detached scratch copy instead" — one reviewer improvised a workaround, which is exactly the self-built-environment behaviour the prompt otherwise forbids.
- feat_R1rluStGyw81 #3: "those gates checked main's code, not this branch; the branch's own suite was verified only by its implementers."

So today the only protection on the branch's own code is the diff reading plus the implementers' self-reported runs inside their sandboxes.

## The design question for ideation (not settled here)

Two honest answers, and the grill should pick:

- **Make the gates real.** Run the verify commands against the feature branch's tip. The obvious shape is a detached worktree at the branch sha — but that needs a dependency install, which the prompt currently forbids for good reasons (a past review spent more than any other act building its own environment; talk worktrees are docs-only by charter decision 6; `find-what-installs-dependencies-into-talk-worktrees` shipped to stop stray installs). Other shapes worth weighing: running gates in the burn sandbox (which already has the branch and installed deps) as a server step after the last landing rather than inside the review agent; or having the server run them and hand the reviewer the results.
- **Stop pretending.** Accept that implementer runs + diff reading are the verification, drop the gates from Gates mode (or run them only as a base-health baseline), and make the review page/digest wording say plainly what was and was not checked.

## What this must NOT swallow

- The review declaration parse bug (`review-declaration-parses-without-a-reason-line`, a separate quick change already created) — that is why clean passes show "NO DECLARATION"; unrelated to which code the gates ran on.
- Drive mode — it already switches the checkout to the feature branch; leave it alone unless the chosen design naturally unifies them.
- The talk-worktree / no-install rules for interactive sessions — don't loosen them as a side effect.
- The duplicated "Agentic review" button on the review page — a UI nit noticed in passing, not this feature.

## Settled context

- Charter decision 6 (worktrees for talk, sandboxes for work, main checkout for the human) and ADR-0005 (burner isolated workspace) bind where installs may happen.
- `review-reads-project-verify-commands-and-explains-a-failed-browser-check` (shipped) is what made the reviewer run the project's verify commands at all — read its decisions before changing how they run.
- `failure-aware-scheduling-for-review-and-verification-passes` decisions.md #? discusses unverifiable typecheck gates when the checkout fails for unrelated reasons — adjacent.
