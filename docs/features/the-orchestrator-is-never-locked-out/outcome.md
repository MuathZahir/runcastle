# Outcome — The orchestrator is never locked out

A stale "session ended" signal can no longer stop an open orchestrator chat from acting.

- Shipped: 2026-11-21

## What shipped

10 commits · 18 files

## Review record

### Review · gates review

- Outcome: dropped

- No findings

### Review · gates review

- Outcome: dropped

- **A late stop skips marking the row ended, but still runs every "process stopped" side effect against the newer running process** (defect, medium) — open
- **The new conflict-card test sits under the comment written for the reconcile test** (observation, low) — open
- **The late-stop guard on the stalled-turn kill path, and the docs-watch restart on revival, have no tests** (observation, low) — open

### Review: verify · gates review, verify

- Outcome: dropped
- Verified fix commits: 02cf4f0c fix(server): a late stop leaves the process that replaced it alone

- No findings

## Notes record

- No human notes

## Workers

- Review (review) — dropped · tokens not counted
- Review (review) — dropped · 815649 tokens
- Review: verify (review) — dropped · 306691 tokens
