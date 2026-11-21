# Outcome — Building starts without a plan approval

A lead asks only when a decision of yours is open; otherwise it says what it will build and builds. The Plan tab goes.

- Shipped: 2026-11-21

## What shipped

12 commits · 83 files

## Review record

### Review · drive review

- Outcome: handed-back

- **A planning run that builds the feature itself, with no worker, is still reported as "planning stopped before the plan was complete"** (defect, medium) — fixed: 5a8177c4: a planning run counts as finished when it waited on the human, or, after it began, started a worker or committed work outside docs/features/<slug>/. Workers from before the run no longer count. Tests cover a self-built run, and a docs-only commit plus an old worker reading as not finished.
- **Old plan cards no longer say which feature they belong to, so an orchestrator chat with several reads as identical "Plan page" rows** (defect, low) — fixed: bd98df37: in a chat that is not the feature's own (the orchestrator's), an old plan card shows the feature's title under "Plan page", and its button reads "Open the plan page of <title>". Tested.
- **No scenario reaches an old chat holding a plan card** (observation, low) — open
- **A live lead built without first playing back what it would build: the human's first word from it was "installing dependencies" after the commit** (defect, medium) — fixed: 7dc6b3d3: the feature skill's rule now says to write the playback first, before any edit, install or worker, because it is the human's one chance to stop a wrong build. planning-alone.md says the same. It is skill wording, so a model can still skip it; the human's drive on the branch's server is the real check.

### Review: verify · gates review, verify

- Outcome: handed-back
- Verified fix commits: 7dc6b3d3 fix(skills): a lead writes its playback before any edit, install or worker, 5a8177c4 fix(server): a planning run that builds the feature itself reads as finished, bd98df37 fix(web): an old plan card in another chat names its feature

- No findings

## Notes record

- No human notes

## Workers

- Remove the Plan tab (on-its-own) — dropped · tokens not counted
- Review (review) — handed-back · 6175498 tokens
- Review: verify (review) — handed-back · 536948 tokens
