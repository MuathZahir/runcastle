## Why this exists

The human finds review drives slow. They first suspected the model, and suggested Haiku. The orchestrator timed four recent runcastle reviews from their transcripts (2026-11-12). Each took 4 to 4.5 minutes:
- The review starts the project's full test suite in the background first, then drives the app while it runs.
- The drive and the model's work are done after about 2 minutes. The review then sits idle another 1.5 to 2 minutes waiting for the suite to finish.
- The browser's own clicking and loading took 10 seconds to 1 minute in total.

So the test suite sets a review's length, not the model. The model still sets its cost: every review has run on Opus with the 1M context.

Two facts found in the code:
- **The review-model setting is ignored.** Runcastle's config has a `review` model step (MODEL_STEPS in packages/core/src/config.ts), and it shows in Settings. But the function that picks a worker's model (`workerModel()` in packages/server/src/workers/service.ts) falls back to the `chat` step, so a review runs on the chat's model unless the lead passes one.
- **The suite runs twice per feature.** The review assignment (packages/skills/review/review.md, "The project's checks") runs every check in full. The feature lead's skill (packs/runcastle/skills/feature/SKILL.md) also runs the checks before `declare_ready`, which comes after the review. Tests give the same result on the same commit, so one of those runs is waste.

## Decided with the human

1. **Reviews default to Sonnet, and the review setting works.** Fix the bug so the `review` model step is what a Review worker runs on when the lead names no model; its default is Sonnet. The human can switch it (to Haiku, say) in Settings and compare. Not Haiku by default: a review's job is judgement, and a defect Haiku misses costs a whole fix-and-review round. The human agreed.
2. **Reviews stay one agent.** The human proposed a Haiku agent that drives and reports observations and screenshots to a stronger model that judges. Since the clicking is a small slice of a review's time, that split would save little there; it was moved to the feature lead's own repeated drives instead (the feature "Agents test like owners"). The human agreed.
3. **The full checks run once per commit.** Whoever reaches a commit first runs them; anyone later on the same commit cites that pass. Concretely: the lead runs the project's full checks before it starts the review (not only before `declare_ready`) and tells the review the commit they passed on. If the branch is still on that commit, the review skips the full suite and runs only the typecheck; if it moved, the review runs the full suite as today. The review checks the commit itself (`git rev-parse`), so it does not simply trust the lead's word. `declare_ready` skips its own run when nothing was committed since the pass. Human's words: "Yes" to "Should reviews skip the suite when it already passed on that exact commit?"

## What it must not swallow

- Per-feature scenarios and the feature lead's drive-and-fix loop belong to "Each feature's own scenarios" and "Agents test like owners", built in parallel. All three edit the feature lead's skill; expect small text conflicts at merge.
- No new verification machinery or gates (charter: "Flexible guidance over brittle machinery"; retired gates). The once-per-commit rule is guidance plus one line the lead passes to the review, not a server-side record of check runs, unless planning finds the guidance cannot work without one — then ask the human.
- A review that finds the branch moved still runs everything; never weaken a check that did not run.

## Context for the planner

Review assignment files: packages/skills/review/review.md, review-drive.md, verify.md, rendered by packages/server/src/workers/review.ts. `start_review({ model })` takes a model from the annotated list. The settings page lists the model steps (packages/server/src/services/settings.ts).

Planning mode: plans itself
