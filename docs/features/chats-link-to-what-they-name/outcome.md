# Outcome — Chats link to what they name

When an agent points you at a feature or a worker, you click it right there in the chat and land on it.

- Shipped: 2026-11-13

## What shipped

10 commits · 22 files

## Review record

### Review · drive review

- Outcome: handed-back

- **A worker: link to another project's worker becomes a link and opens that project's feature inside the current project** (defect, medium) — fixed: c6a4c204: worker.locate now takes the chat's projectId and returns null for a worker whose feature is in another project, so the link reads as plain text. Router test added.
- **A Plan link to a feature with no plan yet changes the address to /plan but shows no panel** (observation, low) — open
- **No scenario reaches a chat that contains feature: and worker: links** (observation, low) — open

### Review: verify · drive review, verify

- Outcome: handed-back
- Verified fix commits: c6a4c204 fix(server): a worker: link resolves only to a worker of the chat's own project

- No findings

## Notes record

- No human notes

## Workers

- Chat links (on-its-own) — landed · 2416923 tokens
- Review (review) — handed-back · 6299190 tokens
- Review: verify (review) — handed-back · 1568371 tokens
