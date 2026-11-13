# Outcome — The epic hears when its features merge

A merge tells the epic the feature came from, waking it only while that epic has other unfinished features, so it can check the pieces fit.

- Shipped: 2026-11-13

## What shipped

15 commits · 20 files

## Review record

### Review · gates review

- Outcome: handed-back

- **CONTEXT.md decisions 17 and 18 still say machine news goes only to the owner; merges to the epic now break that** (observation, medium) — open
- **The "the human / this chat / the chat X" wording is built twice** (observation, low) — open
- **merge_feature run by a chat that isn't the epic gets the epic's sibling list, with owners worded from the epic's side** (defect, medium) — fixed: 9e343460: merge_feature returns the sibling list only when the caller is the feature's epic; a test covers a chat merging a feature it took from another epic, and one with no epic.
- **The skill's merge-line guidance leaves out "never ask in a feature it does not own"** (defect, low) — fixed: 9e343460: the skill's merge bullet now ends "create nothing and ask nothing in features you don't own"; the skill-text test asserts it.
- **The test-drive guard drops held merge lines too, and its log message names "the thread that holds this feature"** (observation, low) — open
- **Full test suite failed once: the terminal "kills the whole tree" test (pty-bun), which the feature doesn't touch** (defect, medium) — dismissed: Not this feature: the terminal process-tree test passed in the lead's full run (5,614 passed) and again on its own twice after the fixes. The reviewer's container is the likely cause.

### Review: verify · gates review, verify

- Outcome: handed-back
- Verified fix commits: 9e343460 fix(server): list a merge's siblings only to the epic, and keep the epic out of features it doesn't own, 16aefe47 fix(server): one wording for who merged and who owns, and the drive guard names the epic

- **A server restart during the background wait leaves a worker "working" forever** (defect, medium) — fixed: da? see commit: at boot, settleWorkersLeftWaiting sets needs-you on every non-drive worker left working with no turn running and not cut off mid-turn (those are woken to carry on); tests in workers-life.
- **A worker with a subagent still running turns "needs you" after 10 minutes, though the host counts subagents with no time limit** (defect, low) — fixed: 74546cbb: the host now tells the turn end when subagents run (subagents: true); the worker starts no 10-minute window for them, matching the host's no-limit count. Tests in agent-host and workers-life.

### Review: verify · gates review, verify

- Outcome: handed-back
- Verified fix commits: 74546cbb fix(server): settle workers a restart left waiting on background work, and give subagents no window, ec5d0b25 fix(server): keep a worker working when a new turn starts while the last one's end is read

- No findings

## Notes record

- No human notes

## Workers

- Merge news (on-its-own) — landed · 4433203 tokens
- Review (review) — handed-back · 1304581 tokens
- Review: verify (review) — handed-back · 1873753 tokens
- Review: verify (review) — handed-back · 1172407 tokens
