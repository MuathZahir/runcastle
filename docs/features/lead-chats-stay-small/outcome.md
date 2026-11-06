# Outcome — Lead chats stay small

A feature lead's chat compacts at natural breaks and before cold resumes, and the lead hands reading, screenshot loops and code surveys to subagents instead of piling them into its own window.

- Shipped: 2026-11-06

## What shipped

20 commits · 30 files

- 0 tickets landed
- 0 waived
- 0 failed

## Review record

### Ticket 1 · review

- Reviewed commit: 9cb90edc922ed70e0aba08c38885dc7ed0ec8b76
- Landed since: 0
- Outcome: done

- **Full test suite failed at 9cb90ed: the terminal kill-tree test left the grandchild process alive** — fixed
- **The thread host now decides feature rules itself (shipped status, self-planning purpose, docs path) instead of asking its lifecycle hooks** — open
- **Three small helpers copy code that already exists: the /compact pattern, the docs path, and the k-token formatter** — open
- **No test covers the lead state skipping compactions, or the cancelled idle-compaction path** — open
- **The failing kill-tree test is a known intermittent failure: it also failed in 10 other features' review gates since Nov 1** — open
- **The before-resuming quiet gap counts from the last finished turn, so a crashed turn makes a warm lead look hours stale** — fixed
- **The before-resuming divider shows below the human's message, though the compaction ran before that message was answered** — open
- **Nobody has yet checked that a live Codex lead honours its 200k auto-compact limit** — open

## Notes record

- No human notes
