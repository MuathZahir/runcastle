# Outcome — A new feature waits for Start

Opening a started feature that has never run shows a Start button instead of launching its lead by itself.

- Shipped: 2026-11-09

## What shipped

12 commits · 23 files

## Review record

### Review · drive review

- Outcome: handed-back

- **A model picked before Start is overwritten on the session row by the Settings default** (defect, medium) — fixed: f4b5812c: the host's follow-Settings step leaves a pick waiting for the session alone; the server test now checks the row after start. Verify review confirmed it holds.
- **No scenario reaches a feature with history but no main chat** (observation, low) — open

### Review: verify · drive review, verify

- Outcome: handed-back
- Verified fix commits: f4b5812c feat(threads): a pick waiting for a new chat's session stays on its row

- No findings

## Notes record

- No human notes

## Workers

- Wire Start (on-its-own) — landed · 9071759 tokens
- Review (review) — handed-back · 5803451 tokens
- Review: verify (review) — handed-back · 882988 tokens
