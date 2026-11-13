# Outcome — Agents test like owners

Feature agents hand repeated drives to a Haiku helper, step back when fixes keep failing, change approach freely on how it's built, and ask before anything that changes what the human gets.

- Shipped: 2026-11-13

## What shipped

5 commits · 10 files

## Review record

### Review · gates review

- Outcome: dropped

- **Shortening the feature skill dropped two rules, which the spec forbids** (defect, medium) — fixed: 0897d444 restores "Show every design page with show_design as you go" and "never several in one command". The notify_human and declare_ready cuts stay: "only for something they asked to be told beyond a wait" still carries the rule, and declare_ready reports its own refusal. SKILL.md is now 15,677 characters against base main's 15,678. The review measured against an older origin/main.
- **The briefing test never checks that the review worker's briefing leaves out the new rule** (defect, low) — fixed: 0897d444: the briefing test now asserts that the review kind's briefing has no step-back or stop rule.
- **The new helper reference never points to the existing "Look at your own screens" pattern** (defect, low) — fixed: 0897d444: checking-your-work.md now points at planning-alone.md "Look at your own screens" and says how they differ. There, a UI subagent judges the pictures and the lead reads none. Here, the lead judges, so it opens the few named.
- **The lead counts "rounds" while workers count "tries"; the stop rule is written out in three places** (observation, low) — open
- **The full test run is not green: one terminal-backend test fails every time, in code this feature never touches** (defect, medium) — dismissed: Environmental. The full suite on the lead's machine after 0897d444: 429 files passed, 2 skipped, 5588 tests passed, including pty-bun.test.ts. The feature touches no terminal code, so the review sandbox's process handling caused the failure.

### Review: verify · gates review, verify

- Outcome: dropped
- Verified fix commits: 0897d444 fix(skills): restore two dropped feature-skill rules; pin the review briefing

- No findings

## Notes record

- No human notes

## Workers

- Review (review) — dropped · 1623427 tokens
- Review: verify (review) — dropped · 350619 tokens
