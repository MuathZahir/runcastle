# Outcome — Orphaned review recorders lock the review dir

A review agent's agent-browser recording outlives the agent's death and holds walkthrough.webm open, so every re-burn of that review ticket fails with EBUSY before it starts.

- Shipped: 2026-09-19
- Laps run: 1

## What shipped

7 commits · 9 files

### Lap 1
- 2 tickets landed: #1 Reap the ticket's agent-browser session on every lane exit, inside the stopped gate; #2 A locked review dir never fails the re-burn: reap, then rename aside, then collect
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 5acab6c37fffe27ad83bb6e36e9a39bfd8188c71
- Landed since: 0
- Outcome: done

- **Gates review completed with no configured verify commands** — open

## Notes record

- No human notes
