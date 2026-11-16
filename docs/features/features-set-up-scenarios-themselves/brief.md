## Purpose

Reviews are meant to be fast because of scenarios (a script that seeds the drive's database at a ready-made state, e.g. "a new business with its plan card ready to Build", and opens the browser there signed in). Both the review and the verify review are already told to reach each criterion through a scenario. But on the human's other project, run on autopilot for days, no scenarios ever existed, so every review redid signup and an onboarding interview by hand (20–30 minutes and $0.20–0.50 per live run there), and reviews took far longer than runcastle's own measured 4–4.5 minutes. The human felt runcastle was "costing more time than saving".

The cause: scenarios are set up only by the human's first "＋ New scenario" chat beside a test drive (drive-scenarios decision 5); `prepare` deliberately stays out (decision 15); features ship scenarios only once the project is set up (decision 13); the only prompt is the Blank app nudge in the drive (decision 14). On autopilot the human never sees it.

## Decided with the human (2026-11-16)

- Keep both reviews (the full review and the verify review): the human pointed out that the walkthrough video "would be kinda useless if they show the state before the fixes", so the second review stays and is made fast instead of dropped.
- What: when a feature needs a slow-to-reach state and the project has no scenarios, the feature's own agents set scenarios up themselves (runner, login route, the scenario), so its reviews start at that state. This reverses "only the human's ＋ New scenario chat sets scenarios up" (drive-scenarios decision 5), which assumed the human is at the drive. The human's answer to making this a feature planned with them: "Yes".
- Where: every runcastle project's features: how a feature plans, builds and reviews.
- Who: the human, who gets fast reviews and walkthroughs of the fixed state; the Review worker, which uses the scenarios.

## Understood (orchestrator's read, 2026-11-16 — verify)

- Review assignment: `packages/server/src/services/drive-host.ts` (~217-237) lists scenarios and tells the worker to use `review_drive({action:"scenario"})`; with no runner or no scenarios it says "set up each criterion's state by hand". `workers/review.ts` fills it; `packages/skills/review/verify.md` embeds the same block.
- The Review worker never writes scenarios (each-feature-s-own-scenarios decision 5).
- Scenarios reach the drive's database only through `drive.env` (drive-scenarios decision 15); missing drive instructions also made leads improvise their own backend, database and browser setup on that project.
- Decisions to read: `docs/features/drive-scenarios/decisions.md`, `docs/features/each-feature-s-own-scenarios/`, `docs/features/faster-cheaper-reviews/`.

## Must not swallow

- Dropping or merging the two reviews.
- The project's own setup (drive instructions) beyond what scenarios need; `prepare` stays the place for that unless the grill says otherwise.
- Per-language tooling: scenario setup is agent work, runcastle's code stays language-agnostic.

## Open (for the grill)

- Who sets scenarios up: the lead while planning, a worker as a ticket, or the Review worker when it finds none.
- How setup is proven without the human at the drive (decision 5's reason for keeping it in front of the human).
- Whether a project with no drive instructions should be stopped or flagged before a feature's first review.
- What counts as "slow to reach".

## Ordering

Independent. Related, separately in flight: `agents-never-stop-for-approval`, `epic-messages-reach-a-busy-agent-at-once`.

Planning mode: with you
