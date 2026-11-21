# Outcome — One file per feature, and reviews that scale

A feature keeps one growing file in place of five docs, and its review is sized to the change.

- Shipped: 2026-11-21

## What shipped

17 commits · 49 files

## Review record

### Review · gates review

- Outcome: dropped

- **Merge commits the human's uncommitted brief.md edits along with the review summary** (defect, medium) — fixed: Fixed in 3ab1db87: the outcome commit holds brief.md as HEAD has it plus the summary; the human's uncommitted edits stay uncommitted on top of the summary; an existing summary is replaced, not doubled. Tested in merge-outcome.test.ts and outcome.test.ts.
- **Review summary does not record the fix commit for a fixed finding, and "accepted" shows as "dismissed"** (defect, medium) — fixed: Fixed in 3ab1db87: the summary prints a dismissed finding as "accepted, not fixed", and resolve_finding's note now asks the lead to name the fix commit, which the summary prints after "fixed:". The fuller outcome.md keeps its wording.
- **No skill test pins the new lead rules (large fix set, quote the human, bring base in, scenario before ready)** (defect, low) — fixed: Fixed in 0304db3b: feature-skill.test.ts pins the one growing file, quoting the human, bringing the base in twice, the skim, drive-or-gates, the large-fix-set rule and the scenario rule before ready.
- **Rule wording is a little weaker than the decisions in three places** (observation, low) — open
- **This review ran on the installed runcastle, so the branch's reviewer changes were not seen live** (observation, low) — open

## Notes record

- No human notes

## Workers

- Server and web: one feature file (on-its-own) — landed · 11071080 tokens
- Review (review) — dropped · 782628 tokens
