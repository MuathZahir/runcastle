# Tickets stop repeating checks, and tests earn their place

## Problem

On a bigger project the human measured slow tickets and traced most of runcastle's own share of the cost to our prompts and our gate runs:

- Every ticket agent is told to "verify with exactly these commands", so it runs the project's full verify commands two or three times per ticket: about 6.6 minutes a ticket. The host already runs those same commands once at the end of every round.
- The burner prompt makes the agent write a failing test first for every acceptance criterion. Agents then write tests for things that will never break or that do not matter (class names, copy, config), which costs time now and maintenance later.
- The server runs the verify commands twice on the same commit in any round that holds a review: once when the review starts, and again when the round ends. A review dispatched later on an unmoved branch runs them yet again. Each run is about 5 minutes on that project.

## Approach

**For a ticket agent**, checking becomes local. It runs the project's static check (typecheck or its equivalent) once across the project after committing, and only the tests that cover what it changed, narrowed by file or pattern. It never runs the full test suite: the host does that once per round, and a break elsewhere comes back to the lead as a red round gate and a fix round. A ticket that exists to fix a gate failure re-runs exactly the check that failed, narrowed to what failed. Tests are written when they protect behaviour someone relies on that could plausibly break (branching logic, a contract between modules, a bug just fixed, as its repro), and not for class names, copy text, static config, markup snapshots, or tests that restate the implementation. With nothing worth testing, the agent writes no test and says so in its digest. There is no test-first ritual. The agent may delete or rewrite a useless test only where its own change already touches it. Decisions 1, 2, 6, 7, 11, 12.

**For the review agent**, the same test rule applies: a missing test is a finding only where the diff adds behaviour worth protecting that nothing covers, and a test not worth its place is a low-severity observation, never a defect. Decision 8.

**For the lead**, the ticket-writing guide drops red→green, keeps acceptance criteria as observable behaviours, and asks for a test as a criterion only for a bug repro or a contract worth protecting. When the lead writes a ticket to fix red round gates, its context names the failing command and test files and one criterion re-runs them narrowed. Decision 7, 11.

**On the server**, the verify commands run at most once per commit. Both places that run them (a round's end, and a review or verification pass at its start) first look for a reusable result on the feature; only without one do they run the gates. A result is reusable when all of these hold (decisions 3, 4, 10):

- it is a `ran` result (never `couldnt_run`, never `none_configured`);
- its command list equals the project's current verify commands, in order;
- its commit is the feature branch's tip now, or every commit since it touches only files under the feature's own docs dir, `docs/features/<slug>/` (checked with git on the host: the changed paths between that commit and the tip);
- failed results are reused exactly like passed ones.

Candidates are the gate records already stored for the feature: each round's `runs.gates` and each review ticket's `reviewGateRun`. The newest qualifying one wins.

A reused result is recorded on its new owner (the round's run row, or the review ticket) as a copy of the original, keeping the commit it actually ran on, plus a mark that it was reused and from where. The original's captured log files are copied into the new owner's gate-log directory, so every existing reader (the review's gate-log route, the review page, the agent's log paths) keeps working unchanged. The end-of-round message to the lead says the gates were not re-run because the branch had not moved since commit X; the review agent's gate notes say the result came from an earlier pass on commit X rather than "before you started, the server ran…". The review page and round trail show a reused result as they show any other. Decision 5.

A sketch of the record change, for orientation (the builder settles the exact shape):

```ts
// packages/core review-gates: the `ran` variant gains an optional mark
reusedFrom?: { kind: 'round' | 'review'; id: string /* run id or ticket id */ }
```

**What stays.** The burner prompt's prefix above "## Your ticket" stays byte-identical across tickets (the verify notes are per-project, so they may change; nothing per-ticket moves up). The good advice around checks stays: capture output to a file and read it back, never serialise a test run with `--maxWorkers`-style flags, commit before a long check, never `git stash`. The gate-unrunnable report stays, for a static check or test runner from the project's commands that cannot start at all. No burn-guard rule changes. No new setting.

**Sweep.** Every prompt and skill that mentions testing is read for anything contradicting the rule above, and only that changes: the burner's implement, review, verify-fixes and resolve-conflict prompts; the feature skill's references (the ticket-writing and rounds guides); the prepare skill's description of `verifyCommands`, which now says they are the host's full gates run once per round, and that agents read them to learn the tools and narrow them.

ADR-0008 (burn performance) is superseded in part: its point 4 ("verify with exactly these commands") and point 5's "run the whole suite once". The outcome says so, and the project session amends the ADR.

## Seams

- **The verify-notes builder** (existing, pure: config in, prompt block out). Shows what the agent is told about the commands and the baseline, in each of its four branches.
- **The rendered burner prompt** (existing). Shows the "How to work" and "How to verify" text, and that the prefix above "## Your ticket" stays identical across tickets.
- **The fix notes for a ticket minted from a review defect** (existing, in the burner). Shows the narrowed re-run of the failing check.
- **A round's end through the runner** (existing; the round-gate runner is injectable). Shows whether gates ran or were reused, what is stored on the run row, and the lead's end-of-round message.
- **A review or verification pass through `executeReviewTicket`** (existing; the gate runner is injectable through its deps). Shows whether gates ran or were reused, what is stored on the ticket, and the gate notes the agent is handed.
- **The reuse lookup** (new, one function the two callers above share). Given the feature, the tip and the current commands, returns the reusable record or nothing. The decision rule itself should be pure so it can be tested without git; the docs-only check is the one git call.

## Out of scope

- Customisable prompts or skills, or any new setting.
- Running the review ticket in parallel with other tickets, or any other change to round scheduling.
- Re-measuring on the other project; that happens after publish and reinstall, using ADR-0008's existing per-ticket timing.
- New burn-guard rules, or new telemetry.
- Writing the ADR-0008 amendment (the project session does it).
- Any UI change.

## Open questions

- Decisions marked **Assumed.** in `decisions.md` wait on the human's check; the five to check first are listed in the plan preview.
