# Brief

## Why this feature exists

On a bigger project (not runcastle itself), the human measured slow tickets and traced most of the runcastle-side cost to our own prompts:

- The ticket prompt's verify block says "Verify with exactly these commands" (rendered from the verify-notes builder in `packages/server/src/workflows/ticket-burner.ts`, ~line 1871). Agents run the project's full gates 2–3× per ticket — about **6.6 min per ticket**, the biggest runcastle-side cost.
- The burner prompt (`packages/skills/burner/implement-ticket.md`, "How to work" steps 2–3) requires a failing test first for every acceptance criterion.
- The review re-runs the gates on the same commit (~5 min per review), and the review ticket runs alone at the end of each round.

What the code actually does today (checked in the project session): the host does **not** gate each ticket as it lands. It runs the project's verify commands once per round, on the feature branch tip, when the round ends (`endRound` → `branchRoundGates` in `packages/server/src/workflows/runner.ts`). The review pass then runs the same commands again on the branch tip (`runBranchGates` in `packages/server/src/workflows/review-ticket.ts`), which is usually the very commit the round just gated.

## Settled with the human

1. **Ticket agents check only what they touched.** Typecheck plus the tests relevant to their change. The full verify commands are the host's job, once, at round end. A ticket that breaks something elsewhere is caught by the round gates, and the feature lead runs a fix round. The prompt must stop telling agents to run the full gates; keep the existing good advice (capture output to a file, never serialise the suite, commit before long checks — some of that may simplify once the full run is gone).
2. **Review reuses the round's gate result when the branch tip is the same commit.** No re-run on an unchanged sha. Re-run only when the tip has moved since the round's gates.
3. **No test-first ceremony anywhere.** Drop red→green, failing-test-first, one-cycle-per-criterion — in the burner prompt AND in the feature skill's ticket-writing guide (`packages/skills/packs/runcastle/skills/feature/references/tickets.md`, which says "the worker goes red→green one criterion at a time").
4. **Tests must earn their place.** The human, verbatim: "I don't want useless tests. Agents tend to create tests for useless things that will never change or won't really make a big difference (like class names, etc..). The tests should serve a real use case, tests shouldn't just be written for the sake of it. … I don't want ceremonies."
   The rule to write into the prompts: a test is worth writing when it protects behaviour someone relies on that could plausibly break — logic with branches, a contract between modules, a bug just fixed (a repro). Not worth writing: class names, copy text, static config, markup snapshots, tests that restate the implementation. A change with nothing worth testing gets no new test, and the agent says so in its digest. Apply the same rule to the **review** prompt (`packages/skills/burner/review-ticket.md`) so the reviewer does not raise missing low-value tests as findings, and may flag useless ones. Sweep the other prompts that mention testing (`packages/skills/burner/*`, the feature skill's references) for the same ceremony; change only what contradicts this rule.
5. **Not customizable prompts.** Fix the defaults instead. Projects already pick their own verify commands.

## Must NOT swallow

- Making prompts or skills user-customizable.
- Running the review ticket in parallel with other tickets / restructuring round scheduling.
- Re-measuring on the other project — that happens after publish + reinstall (live sessions run the global install). ADR-0008's per-burn `ticket.timing` telemetry is the measuring stick; don't build new telemetry.
- The burn guard (ADR-0008 decision 2) — no new guard rules.

## Binding

- ADR-0008 (burn performance): its prompt rules for "run the whole suite once" are being superseded in part by decision 1 here; record that in this feature's decisions. If the change is big enough to amend the ADR, say so in the outcome and the project session will write it.
- The charter: "what lasts is records and executable things that break loudly (tests, scenarios)" — tests stay, ceremony goes.
- The burner prompt's header comment: everything above "## Your ticket" must stay byte-identical across tickets (cache prefix). Keep it that way.

## Neighbour

`review-hands-you-a-running-drive-with-what-it-saw` is in flight and edits `review-ticket.ts` too (the drive handover, not gates). Expect at most a small merge conflict.

## Working agreement

**Autonomous**, chosen by the human on 2026-10-28: the orchestrator carries this through to merged, merging when it judges right, no stops for test drives. The feature's own review before declaring ready is the check.
