# Outcome — Drives never touch real conversations

A test drive of runcastle works on a copy of the database without resuming, prompting or switching the real agents' conversations — and a merge conflict is resolved once, not twice.

- Shipped: 2026-11-06

## What shipped

4 commits · 18 files

- 0 tickets landed
- 0 waived
- 0 failed

## Review record

### Ticket 1 · review

- Reviewed commit: 5f0576f561377c298d91322a31466e2db7f90adf
- Landed since: 0
- Outcome: done

- **Test gate failed: the terminal kill-tree test left the grandchild process alive (likely flaky, not this lap's code)** — dismissed
- **In a drive, a copied chat can't start a fresh conversation: it runs in the live install's (missing) working folder** — fixed
- **In a drive, dropped orchestrator news leaves no record of why (only lead wakes get "message not sent")** — fixed
- **The drive's server exited mid-review with no trace, and the drive kept reporting itself ready** — open
- **Not verified in the drive: restart keeps drive-born ids, round-end wake drop, merge-conflict wording, check-first wording** — open

## Notes record

- No human notes
