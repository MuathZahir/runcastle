# Decisions — Tickets stop repeating checks, and tests earn their place

Planned by a self-planning run on 2026-10-28, with no human present. Decisions taken from the brief's "Settled with the human" list carry no mark; the rest are marked **Assumed.**

## 1. Ticket agents check only what they touched
**Decision:** A ticket agent never runs the project's verify commands as a whole. It runs the project's typecheck and the test files that cover what it changed, narrowed by file or pattern. The verify commands stay in its prompt, now labelled as what the host runs once at the end of the round, so the agent learns the right tools and filter names from them. Breakage elsewhere is the round gates' to catch, and the lead runs a fix round. The good advice around checks stays: capture output to a file and read it back, never serialise a test run, commit before a long check.
**Why:** Settled with the human in the brief. Agents ran the full gates 2–3 times per ticket, about 6.6 minutes a ticket, while the host runs them once per round anyway. This replaces in part ADR-0008's prompt rule (its point 4, "verify with exactly these commands", and point 5's "run the whole suite once"); the outcome will say so, and the project session amends the ADR.

## 2. The static check may run whole; the tests never do
**Decision:** The agent may run the project's static check across the whole project, once, after committing its work: the typecheck, or whatever plays that part in the project's verify commands (a compile, `go vet`, a linter). A static check is how a change in one file shows up as breakage in its callers. The agent narrows it to one package only when the project's own commands make that plain, and a project with no static check gets only the narrowed tests. Tests are always narrowed to the files that cover the change.
**Why:** A type error in a caller is the commonest cross-file break, and a static check finds it in one cheap pass, where the test suite is the slow part (minutes on a big monorepo). Handing it to the round would turn many trivial type errors into whole fix rounds. The prompts go to every project, so the rule names the role, not one language's tool.
**Assumed.** Alternative: narrow the static check too, to the touched package only, and leave all cross-package breakage to the round gates.

## 3. One gate run per commit, whichever pass reaches it first
**Decision:** The server runs the verify commands at most once per commit of the feature branch. A round's end reuses a gate result already recorded for the branch's current tip, and so does a review pass (or a verification pass) at its start. In a round with a review ticket, the review runs first, so the round's end is the one that reuses; a review dispatched in a later round on an unmoved branch reuses the previous round's result. Any move of the tip means a fresh run.
**Why:** The brief describes the review re-running the round's gates, but in the code the review runs inside the round, before the round's end, so the duplicate it describes is really the round's end re-running the review's gates. Both orders happen, and the human's rule ("no re-run on an unchanged sha") covers both, so the reuse is made symmetric rather than one-way.
**Assumed.** Alternative: only the review reuses, exactly as the brief words it, which would leave the in-round duplicate (about 5 minutes a round) in place.

## 4. A result is reused only when it really ran, on the same commit and the same commands
**Decision:** A recorded result is reused when it ran (not "couldn't run"), on exactly the branch tip now, with the same list of verify commands the project has now. A failed result is reused like a passed one. A result that could not run (no sandbox, install failed) is never reused: the gates run again.
**Why:** "Couldn't run" is a fact about the machine at that moment, not about the commit, so it is worth retrying. A real failure on the same commit and commands would fail again; re-running it costs minutes to learn nothing. Changed verify commands make the old result answer a different question.
**Assumed.** Alternative: re-run when the earlier result failed, so a flaky test gets a second chance before a fix round is spent on it.
**Challenged:** Tickets no longer run full suites, so the round gate is the only full run; on a big project with flaky tests, a reused flaky failure costs a whole fix round, which is slower than re-running only the failed commands once before reusing a failure.

## 5. A reused result says it was reused
**Decision:** Wherever a gate result is shown, a reused one is marked as such with the commit it ran on: the lead's end-of-round message says the gates were not re-run because the branch had not moved, and the review agent is told the result came from an earlier pass on this same commit. Its captured output stays readable from the review that reused it. The review page and the round trail show it as they show any result; no new screen.
**Why:** A lead or reviewer who believes the gates were run fresh may reason wrongly about a flaky failure. Saying so costs one line.
**Assumed.** Alternative: reuse silently, with no mark.

## 6. Tests earn their place
**Decision:** The rule written into the prompts: a test is worth writing when it protects behaviour someone relies on that could plausibly break — logic with branches, a contract between modules, a bug just fixed (as a repro). Not worth writing: class names, copy text, static config, markup snapshots, tests that restate the implementation. A change with nothing worth testing gets no new test, and the agent says so in its digest.
**Why:** Settled with the human in the brief, in their words: "tests should serve a real use case, tests shouldn't just be written for the sake of it."

## 7. No test-first ceremony anywhere
**Decision:** Red→green, failing-test-first and one-cycle-per-criterion go from the burner prompt and from the feature skill's ticket-writing guide. Acceptance criteria stay observable behaviours; a lead writes "a test covers X" as a criterion only when X is a bug repro or a contract worth protecting. The other prompts and skills that mention testing are swept, and only what contradicts decision 6 changes.
**Why:** Settled with the human in the brief ("I don't want ceremonies"). The charter keeps tests as one of the things that last; the ritual around writing them is what goes.

## 8. The reviewer judges tests by the same rule
**Decision:** The review prompt carries decision 6. A missing test is a finding only where the diff adds behaviour worth protecting that nothing covers (a fixed bug with no repro is the clearest case). A test that is not worth its place is reported as a low-severity observation, so the lead can delete it by hand, not as a defect that mints a fix ticket.
**Why:** The brief asks that the reviewer stop raising missing low-value tests and may flag useless ones. A defect turns into a fix ticket and a whole sandbox to delete a few lines, which is the kind of ceremony this feature removes.
**Assumed.** Alternative: report a useless test as a low-severity defect, so it gets fixed in the next round without the lead having to act.
**Challenged:** Under the autonomous working agreement observations tend to be ignored, so useless tests would pile up; better to fold useless-test findings into a fix ticket whenever the round mints one anyway, and leave them as observations otherwise.

## 9. Defaults change; nothing becomes customisable
**Decision:** The prompts' defaults change for every project. No new setting, no per-project prompt override, no new burn-guard rule, no new telemetry: ADR-0008's per-ticket timing is how the gain is measured, after publish and reinstall.
**Why:** Settled with the human in the brief. Projects already choose their own verify commands, which is the only knob this needs.

## 10. A commit that only touches this feature's docs does not count as the branch moving
**Decision:** When deciding whether a gate result can be reused (decision 3), commits whose changes all sit inside the feature's own docs directory (`docs/features/<slug>/`) are ignored: a result recorded on an earlier commit still counts if everything since it is feature docs only. The result keeps the commit it actually ran on, and its reuse mark (decision 5) names that commit.
**Why:** The lead's spec and decision edits and runcastle's own docs commits (scaffold, outcome, checkpoints) land on the feature branch between and during rounds. Without this, almost any of them would force a fresh run and the reuse would rarely happen. Those files are the feature's notes, not the product, so no gate tests them.
**Assumed.** Alternative: any new commit means a fresh run, which is simpler and never wrong, at the cost of most reuses.

## 11. A fix ticket re-runs the failing check, narrowed to what failed
**Decision:** A ticket whose job is a gate failure (a fix round after red round gates, or a fix ticket minted from a failed gate in a review) re-runs exactly the check that failed, narrowed to the failing test files or the failing command, and says in its digest that it did. It still never runs the full suite.
**Why:** Decision 1 alone would let such a ticket check only the tests next to its own change, which may not include the one that failed, so it could land without proving the fix.
**Assumed.** Alternative: let fix tickets run the full verify commands, as today.

## 12. A ticket agent deletes only the useless tests its own change touches
**Decision:** A ticket agent may remove or rewrite a test that fails decision 6 only when it is already changing that test or the code it covers for its ticket. Useless tests elsewhere are left alone, for the reviewer to flag (decision 8).
**Why:** It keeps each diff on its ticket, so agents do not tidy the codebase on the side and collide with sibling tickets on landing.
**Assumed.** Alternative: let agents delete any useless test they come across.

## Challenge
One independent challenger agent read the brief and these decisions. Its four unasked questions became decisions 10, 11, 12 and the "no typecheck" half of decision 2. It disagreed with decisions 4 and 8; their **Challenged:** lines carry its reasons, and the planner's answers stand.
