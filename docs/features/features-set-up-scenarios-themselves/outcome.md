# Outcome — Features set up scenarios themselves

When a feature needs a slow-to-reach state and the project has no scenarios, its agents set scenarios up themselves, so reviews start right at that state instead of redoing signup.

- Shipped: 2026-11-17

## What shipped

14 commits · 25 files

## Review record

### Review · drive review

- Outcome: handed-back

- **While the lead holds the drive, the chat's notice says the test drive "waits until the review hands back"** (defect, medium) — fixed: fb48d9f5: the slot notice's subtitle now reads "…waits until it stops its drive" when the lead holds the drive; the review's wording is unchanged. Tier-2 test added in drive-slot.test.tsx.
- **The "write a scenario for each 'No scenario reaches' before the verify review" rule is not reachable at review time** (defect, medium) — fixed: 9d11cc8d: SKILL.md's ready step (step 8, read every session) now says to write and prove a scenario for each "No scenario reaches <state>" before the verify review, pointing at references/scenario-setup.md.
- **No scenario reaches a feature whose lead holds the drive** (observation, low) — open

### Review: verify · drive review, verify

- Outcome: handed-back
- Verified fix commits: fb48d9f5 fix(web): the slot notice says the test drive waits for the lead's drive, not a review, 9d11cc8d docs(skills): the feature skill's review step asks for scenarios before the verify review, 6aeae850 fix(web): the slot blocker's agent type carries the lead mark

- No findings

## Notes record

- No human notes

## Workers

- Lead drive tools (on-its-own) — dropped · tokens not counted
- Lead drive tools (on-its-own) — landed · 6548431 tokens
- Review (review) — handed-back · 6529569 tokens
- Review: verify (review) — handed-back · 953899 tokens
