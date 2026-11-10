# Outcome — A better way to move between projects

Replace the basic project dropdown and rework the "All projects" page so hopping between many projects is fast and shows what each one needs, on desktop and phone.

- Shipped: 2026-11-10

## What shipped

23 commits · 58 files

## Review record

### Review · drive review

- Outcome: handed-back

- **Many projects scenario writes feature branches and worktrees into the owner's real repos** (defect, high) — fixed: 40a80a62: projects that get seeded features always use their own repo under the drive's data dir; checked against a fake owner DB holding a 'clawflow' elsewhere (owner repo untouched over two runs). The three stray branches (scaffold commit only) were deleted and their stale worktrees pruned in terminal-wait-game, JanaLearn_Updated and clawflow.
- **Full test run has one failure: workers-recovery stalled-turn test, a timing flake outside this feature** (defect, medium) — dismissed: Timing flake in the workers recovery test under load; this feature does not touch workers code. It passed alone for the review, and the lead's own earlier full run had a different unrelated server test flake that also passed alone.
- **Desktop All projects keeps a near-empty 248px sidebar the approved design does not have** (defect, low) — fixed: ce3c961f: the human chose to drop the sidebar. Frame takes a `rail` option and shows the rail without a sidebar; PortfolioHome passes `rail` and no sidebar. Recorded as decision 7.
- **Not driven: phone long-press drag, and Alt+digit with focus in a live terminal chat** (observation, low) — open

### Review: verify · drive review, verify

- Outcome: handed-back
- Verified fix commits: 40a80a62 fix(scenarios): many projects seeds features only in repos under the drive, ce3c961f feat(web): All projects drops its sidebar on desktop; the rail sits beside the cards

- **Many projects scenario now shows clawflow, JanaLearn_Updated and terminal-wait-game twice** (defect, low) — fixed: The scenario now closes, in the drive's own database only, any open project named like a seeded one (clawflow, JanaLearn_Updated, terminal-wait-game) that is not the drive's copy. Checked against a fake owner database with a real 'clawflow': 8 projects open after two runs, no duplicates, the owner repo still has only main.

### Review: verify · drive review, verify

- Outcome: handed-back
- Verified fix commits: 238b0cac fix(scenarios): many projects closes a seeded project's real namesake in the drive's database

- No findings

## Notes record

- No human notes

## Workers

- Project rail (on-its-own) — landed · 16423831 tokens
- All projects page (on-its-own) — landed · 9238116 tokens
- Review (review) — handed-back · 3944777 tokens
- Review: verify (review) — handed-back · 818634 tokens
- Review: verify (review) — handed-back · 445502 tokens
