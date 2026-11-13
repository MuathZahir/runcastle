# Outcome — Faster, cheaper reviews

Reviews run on Sonnet by default and stop rerunning a test suite that already passed on the same commit.

- Shipped: 2026-11-13

## What shipped

16 commits · 26 files

## Review record

### Review · drive review

- Outcome: dropped

- **Settings shows the Review row's default as the global model (Opus 1M), while reviews actually run on claude-sonnet-5** (defect, high) — fixed: d817a18d: each step row now carries its own default (stepRows → defaultModel), and the select's Default option names it, so an unset Review row reads "Default (claude-sonnet-5)". Web test asserts it.
- **checksPassed.commit accepts a branch name or "HEAD", which makes the review's own commit check always pass** (defect, medium) — fixed: 10f48569: checksPassed.commit must match a 7–64 hex SHA; HEAD, branch names and refs are refused before the tool runs (MCP test covers HEAD, a branch, main~1, "abc"). The lead's workers reference says to pass git rev-parse HEAD.
- **Not seen live: a review launched with no model actually running on the Review setting** (observation, low) — open

### Review: verify · drive review, verify

- Outcome: handed-back
- Verified fix commits: d817a18d fix(settings): each step's Default option names its own default, so Review reads Sonnet, 10f48569 fix(mcp): start_review's checksPassed commit must be a SHA, never a branch name or HEAD

- No findings

## Notes record

- No human notes

## Workers

- Review model + checks (on-its-own) — landed · 8398502 tokens
- Review (review) — dropped · 3165996 tokens
- Review: verify (review) — handed-back · 905947 tokens
