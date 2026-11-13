# Outcome — Each feature's own scenarios

A feature's agent writes scenarios that land drives where its work is, and they leave with the feature unless the human keeps one.

- Shipped: 2026-11-13

## What shipped

12 commits · 23 files

## Review record

### Review · gates review

- Outcome: dropped

- **A feature drive's identity is built by hand in three places; missing featureId at one would silently drop the data folder** (observation, low) — open
- **Same best-effort folder removal is copied into both merge and delete** (observation, low) — open
- **A failed data-folder creation throws a raw error instead of a typed drive refusal** (observation, low) — open
- **The scenario chat is told to save a data copy in the feature's data folder, but its edit guard denies Write/Edit there** (defect, medium) — fixed: 8f3d9103: the edit guard now lets a scenario session on a feature's drive write that feature's scenario-data folder (the hook passes scenarioDataDir(feature.id)); a project drive's session gets no folder, and the denial names the folder when it is open. Test in scenario-session.test.ts.
- **Unasked-for change: drives now drop an inherited RUNCASTLE_SCENARIO too, and the dev pane also gets the data folder** (observation, low) — open
- **Test suite is not green: the terminal backend's kill-the-whole-tree test fails (1 of 5615), in code this feature does not touch** (defect, medium) — dismissed: Sandbox-only: pty-bun.test.ts passes on the host on this branch (with the guard and scenario tests, 5 files / 108 tests green), and the feature touches no terminal code. The sandbox's process groups let the grandchild survive.

### Review: verify · gates review, verify

- Outcome: dropped
- Verified fix commits: 8f3d9103 fix(scenarios): let a feature drive's scenario chat write the feature's data folder

- No findings

## Notes record

- No human notes

## Workers

- Scenario data folder (on-its-own) — landed · 3181480 tokens
- Review (review) — dropped · 1264186 tokens
- Review: verify (review) — dropped · 397860 tokens
