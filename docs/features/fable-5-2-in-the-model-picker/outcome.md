# Outcome — Fable 5.2 in the model picker

The chat's model picker offers every model Settings lists, so Fable 5.2 shows up.

- Shipped: 2026-11-16

## What shipped

6 commits · 12 files

## Review record

### Review · drive review

- Outcome: handed-back

- **A model added in Settings → Models shows in an open chat's picker only after a page reload** (defect, low) — fixed: The Models page now refetches every open picker's list when it saves a setting or re-runs discovery (d0d22342), with tests (3f1e4caf).
- **No scenario reaches a saved adapter model list that lacks a model Settings lists** (observation, low) — open

### Review: verify · drive review, verify

- Outcome: handed-back
- Verified fix commits: d0d22342 fix(web): a model saved in Settings shows in an open picker at once, 3f1e4caf test(web): Models page refetches the chats' model pickers when it saves

- No findings

## Notes record

- No human notes

## Workers

- Review (review) — handed-back · 6862631 tokens
- Review: verify (review) — handed-back · 2667729 tokens
