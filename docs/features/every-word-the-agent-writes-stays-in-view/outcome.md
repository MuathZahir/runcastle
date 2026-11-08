# Outcome — Every word the agent writes stays in view

The chat stops folding the agent's own words into "Worked for": all of its text shows in order, and only tool calls and thinking fold between the paragraphs.

- Shipped: 2026-11-08

## What shipped

12 commits · 20 files

- 0 tickets landed
- 0 waived
- 0 failed

## Review record

### Ticket 1 · review

- Reviewed commit: 8a08268f65861ff9e467131c97680f9f5beeb3ef
- Landed since: 0
- Outcome: done

- **Test gate failed on 8a08268: one terminal-backend kill-tree test, in code this branch does not touch** — dismissed
- **Old text-only turns show a bare "0s" as the turn's total, with no model name beside it** — fixed
- **Unverified: how an older chat with tool calls folds; no chat in the drive has stored tool calls from before today** — open
- **Export as Markdown labels a thinking-only gap "Worked for 5s" where the chat shows "Thought for 5s"** — open
- **No scenario reaches a plan or design card posted between words in a turn** — open

## Notes record

- No human notes
