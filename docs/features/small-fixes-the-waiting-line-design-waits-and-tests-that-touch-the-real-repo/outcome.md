# Outcome — Small fixes: the waiting line, design waits, and tests that touch the real repo

Remove the end-of-chat waiting line, show "Design to approve" only when a design really waits, and make sure no test can ever write into the human's real repo.

- Shipped: 2026-11-05

## What shipped

10 commits · 24 files

- 0 tickets landed
- 0 waived
- 0 failed

## Review record

### Ticket 1 · review

- Reviewed commit: d7171b60fd98694abee19b6e52d5eecfdeb0b15f
- Landed since: 0
- Outcome: done

- **The full test suite failed on the branch: one terminal-backend test (pty-bun "kills the whole tree") is red** — dismissed
- **Test gate failed on d7171b6: one terminal kill-tree test left its grandchild alive** — dismissed
- **Phone "…" sheet's Plan and Design entries not driven: no demo feature has a plan or recorded design** — open
- **Design-wait wording, skill text, test guard and move fix have no UI and were not driven** — open

## Notes record

- No human notes
