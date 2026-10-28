# Outcome — Tickets stop repeating checks, and tests earn their place

Ticket agents run only the checks for what they touched and write tests only where they protect real behaviour; the full gates run once per round on the host, and review reuses that result when the branch has not moved.

- Shipped: 2026-10-28

## What shipped

14 commits · 24 files

- 2 tickets landed: #1 Prompts: ticket agents check locally and write only tests that earn their place; #2 Gates: run the verify commands at most once per commit
- 0 waived
- 0 failed

## Review record

### Ticket 3 · review

- Reviewed commit: ee4729f8baecf77ffb6cf3c842b98de9f9db00d6
- Landed since: 0
- Outcome: done

- **Test gate is red: the review prompt's new test-worth paragraph says "a defect mints its own fix ticket", which a standing test forbids** — fixed
- **Gate reuse copies forward a "ran" result whose commands timed out or could not start, so a machine hiccup is never retried** — fixed
- **A failed git diff in the reuse lookup reads as "docs-only", reusing a stale result, while the comment claims the opposite** — fixed
- **Conflict-resolver prompt still says "Verify with these commands … capture a full run", contradicting the new verify notes beneath it** — fixed
- **The no-baseline verify note points at `git show HEAD~` as "the pre-change code", which isn't true after more than one commit** — open
- **ADR-0008 still states the rules this lap supersedes, and the project session still has to amend it** — open

## Notes record

- No human notes
