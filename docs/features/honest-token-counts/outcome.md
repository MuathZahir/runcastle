# Outcome — Honest token counts

runcastle counts every session's tokens once and correctly — orchestrator, side and review sessions included — and the context meter warns where cost starts to hurt.

- Shipped: 2026-11-06

## What shipped

5 commits · 28 files

- 0 tickets landed
- 0 waived
- 0 failed

## Review record

### Ticket 1 · review

- Reviewed commit: c0ddc911e14b36c32a43c67cbbd48469a69496d1
- Landed since: 0
- Outcome: done

- **Test gate failed: pty-bun "kills the whole tree" test fails on the branch (likely a flake — the lap does not touch the terminal)** — dismissed
- **A plain open of a chat mid-conflict files the rest of the conflict work under "none" instead of resolve-conflict** — fixed
- **Publish build's patch markers don't pin the new file-tool hunk, so a regenerated patch can drop it silently** — fixed
- **ADR-0011's regeneration steps don't list the new file-tool hunk or its contract test** — fixed
- **One-time recount's collapse rewrites session tokens without emitting any event** — fixed
- **Recount's collapse can give the newest row a total that doesn't match its stored split, and can overwrite rows this branch already counted** — fixed
- **Scenario-setup sessions count under "none": their launch record carries no purpose** — fixed
- **A review run that throws after writing its digest still counts no tokens; the spec's open question was left unchecked** — open
- **Not verified in this pass: the SQL query against a recounted database, and the meter's amber/red look in a real chat** — open

## Notes record

- No human notes
