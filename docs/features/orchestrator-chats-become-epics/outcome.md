# Outcome — Orchestrator chats become epics

Each orchestrator chat is an epic with a short name and its features shown under it, so you can tell at a glance what belongs to what and what needs you.

- Shipped: 2026-11-10

## What shipped

62 commits · 131 files

## Review record

### Review · drive review

- Outcome: handed-back

- **A feature run by its epic's chat reads "Needs your answer" (or "Plan to approve") under the epic with no yellow dot, so the row tells the human to act when it is the chat's job** (defect, high) — fixed: 2d650b9f: under its epic, only the chat's question reads "Question above"; every other need the epic's chat holds keeps "With <epic> · …" (e.g. "With Sidebar Test · Plan to approve"). Decision 10 amended; tests pin both.
- **"Orchestrator" still shows on screen: a new epic's first line reads "Started this orchestrator chat", and the owner control's tooltip says "hand it to an orchestrator chat"** (defect, low) — fixed: d705fcd3: a new epic opens with "Started this epic"; the owner control's hover reads "To hand it to an epic, tell its chat: run … for me." Chats started before this keep their stored first line.

### Review: verify · drive review, verify

- Outcome: handed-back
- Verified fix commits: 2d650b9f fix(epics): a need the epic's chat holds keeps its name under the epic, d705fcd3 fix(epics): the last on-screen "orchestrator" words say epic

- **"Orchestrator" still shows on screen in two places the original finding named: a Settings tooltip and a worker's hand-back line** (defect, low) — fixed: dd78df5b: the "Commits land on" tooltip says "an epic's commits", a project worker's hand-back line says "Handed back to its epic", and the fallback owner name is "Unnamed epic".

### Review: verify · drive review, verify

- Outcome: handed-back
- Verified fix commits: dd78df5b fix(epics): the settings tooltip, a project worker's hand-back and an unnamed owner say epic, 266800a7 feat(epics): each epic is a card, and the list loses its title (the human-approved card look of the sidebar: check it in the running app, both themes, an epic in front, a working epic's hub and sheen, and that New epic in the create menu still opens an empty new epic)

- **No scenario reaches a project drive's Scenarios worker that has handed back** (observation, low) — open

## Notes record

- No human notes

## Workers

- Epic names (on-its-own) — landed · 6843907 tokens
- Epic list (on-its-own) — landed · 26143938 tokens
- Review (review) — handed-back · 5244633 tokens
- Review: verify (review) — handed-back · 2569535 tokens
- Review: verify (review) — handed-back · 2380677 tokens
