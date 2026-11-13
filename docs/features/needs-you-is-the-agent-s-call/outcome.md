# Outcome — Needs you is the agent's call

A feature or worker shows one thing: whether it needs you. Only the agent sets that, by calling a tool; runcastle stops guessing it.

- Shipped: 2026-11-13

## What shipped

19 commits · 163 files

## Review record

### Review · drive review

- Outcome: handed-back

- **A failed worker or dead sandbox pings the human directly, though the spec gives that call to the lead** (defect, medium) — fixed: 1b2b2e67: failWorker no longer sets runcastle's need; the lead is woken and decides. The test now asserts the feature has no need. A lead's own dead run and a usage limit still set runcastle's line, as decision 9 says.
- **Feature status line reads "Working" (with Stop) while the sidebar row and every worker card read "Idle"** (defect, high) — fixed: 10759248: the header counts workers through the same rule as their cards (a turn running), via a new workersAtWork helper with a regression test.
- **No scenario reaches "Ready to test", an open permission/question box, or a dead-run need** (observation, low) — open

### Review: verify · drive review, verify

- Outcome: dropped
- Verified fix commits: 10759248 fix(web): the status line counts only workers whose turn runs, 1b2b2e67 fix(workers): a failed worker goes to the lead and sets no need

- No findings

## Notes record

- No human notes

## Workers

- Need model (on-its-own) — dropped · 69767420 tokens
- Status display (on-its-own) — landed · 43252775 tokens
- Review (review) — handed-back · 7382392 tokens
- Review: verify (review) — dropped · 1258300 tokens
