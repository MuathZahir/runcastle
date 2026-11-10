# Outcome — The status tells the truth about who and what

A feature's status follows who the agent asked and what is really still running, and a live subagent never hides inside a "Worked for" fold.

- Shipped: 2026-11-10

## What shipped

16 commits · 45 files

## Review record

### Review · drive review

- Outcome: handed-back

- **With a real Claude Code lead running a background subagent, the feature leaves Working at once: the sidebar files it under "In progress"** (defect, high) — fixed: 99a0047e: threadActivity reads a turn still open with a subagent listed (process running, words not ending on a question) as 'background', so the server's leadInBackground is true and the sidebar's agentMidTurn files the feature under Agent working despite the Stop hook's awaitingInput. Core tests cover it.
- **A background subagent that wakes again in a later turn gives two chat items the same id; the chat piles up empty "Worked for 1s" folds (111 live, 5 after reload)** (defect, medium) — fixed: 99a0047e: foldThread keeps the ids of every settled part of a turn, and a later part's item that would reuse one gets a suffix, so a subagent woken again under its old id gives a fold with its own id. Test fails without the fix. Showing the resumed work under the first card is left as is.
- **No scenario reaches a handed-back feature, an hour-old handback, or a chat with a running background subagent** (observation, medium) — open
- **No test covers the idle stop waiting while a subagent is listed** (defect, low) — fixed: ef1ea231: agent-host idle stop test lists a subagent and advances 3x the idle time; the process keeps running. Fails without the re-arm branch.

### Review: verify · drive review, verify

- Outcome: handed-back
- Verified fix commits: 99a0047e fix(threads): a Claude turn held open by a running subagent reads as background work, and fold ids stay unique across turns, ef1ea231 test(threads): the idle stop waits while a subagent is listed

- **One drive-worker test failed in the full run but passes alone (timing-sensitive)** (observation, low) — open

## Notes record

- No human notes

## Workers

- Who a wait is for (on-its-own) — landed · 10034997 tokens
- What is still running (on-its-own) — landed · 9280569 tokens
- Review (review) — handed-back · 11886851 tokens
- Review: verify (review) — handed-back · 2775015 tokens
