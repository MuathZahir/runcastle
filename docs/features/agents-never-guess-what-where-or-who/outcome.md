# Outcome — Agents never guess what, where or who

Every agent asks before it creates, plans or designs anything whose "what you get, where it lives, who sees it" the human has not settled; and "plan it yourself" gets a name users understand.

- Shipped: 2026-11-12

## What shipped

10 commits · 46 files

## Review record

### Review · drive review

- Outcome: handed-back

- **A lone run that stops on an open what/where/who is logged as "Planned automatically — the plan is finished"** (defect, medium) — fixed: f798a26b: the end-of-run event now tells a run that stopped on a question (wait kind "answer") from a finished plan. It records `asked: true`, keeps the question as the feature's wait, and the feed reads "Automatic planning stopped to ask you something first" at info level. Tests cover both the server event and the feed line.
- **Full test suite: 1 failure in the usage-limit wake test (passes 3/3 alone, looks load-flaky, code not touched by this feature)** (defect, medium) — dismissed: Not this feature's code. This branch changed one expected sentence in agent-host.test.ts (the stop line's rename) and nothing in the usage-limit wake path. The file passes 3 of 3 runs alone here too. The flake under full-suite load predates this feature.
- **Orchestrator intake, worker briefings and the answer-then-finish path were reviewed in text only, not driven** (observation, low) — open

### Review: verify · drive review, verify

- Outcome: handed-back
- Verified fix commits: f798a26b feat(self-plan): log a run that stopped to ask as stopped, not finished

- No findings

## Notes record

- No human notes

## Workers

- Rename (on-its-own) — landed · 1451690 tokens
- Review (review) — handed-back · 4347763 tokens
- Review: verify (review) — handed-back · 1325158 tokens
