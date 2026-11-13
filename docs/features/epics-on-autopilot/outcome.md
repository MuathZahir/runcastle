# Outcome — Epics on autopilot

Tell an orchestrator chat to take over its features and you talk only to it, so you can go to sleep; per-feature ownership goes away.

- Shipped: 2026-11-13

## What shipped

22 commits · 109 files

## Review record

### Review · drive review

- Outcome: dropped

- **A design approved on autopilot is recorded as the lead's and never shown as "approved by autopilot"** (defect, high) — fixed: c612c374: a lead's set_design_state on a locked feature now records approvedBy 'autopilot' (new enum value); DesignEntry carries approvedBy and the Design tab's row reads "approved by autopilot"; the project skill says the lead records the epic's yes. Test added in autopilot.test.ts.
- **The test command as given reads the installed runcastle's migrations inside a runcastle session; run with the asset vars unset** (observation, low) — open

### Review: verify · drive review, verify

- Outcome: dropped
- Verified fix commits: c612c374 fix(designs): a design approved on autopilot is recorded and shown as autopilot's

- **No scenario reaches a design approved on autopilot** (observation, low) — open
- **The human's own relayed yes on a locked feature's design is labelled "approved by autopilot"** (observation, low) — open

## Notes record

- No human notes

## Workers

- Server: autopilot replaces ownership (on-its-own) — dropped · 69590736 tokens
- Server: whole-epic lock (on-its-own) — dropped · 11601086 tokens
- Web: autopilot screens (on-its-own) — landed · 26533334 tokens
- Review (review) — dropped · 7182670 tokens
- Review: verify (review) — dropped · 2633572 tokens
