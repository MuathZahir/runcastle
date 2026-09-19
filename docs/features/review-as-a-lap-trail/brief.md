# Brief

## Why this feature exists

The 2026-09-14 post-mortem's top finding: a run reported "succeeded 36/36" and the digest headline said "0 defects found" over a review pass whose agent could not attach a browser and wrote "all acceptance criteria remain honestly unverified". The next lap planned on an empty defects list. Root cause in code: the review ticket's outcome is read off what the agent left, not what it did. `packages/server/src/workflows/review-ticket.ts:541-558` returns `done` whenever a digest exists; the mode run, the evidence produced and the finding count are all irrelevant to status. The lap-2 reviewer's diagnosis ("verified against two hand-planted rows because the live birth verb never succeeds") and lap 3's "browser drive could not begin" were both filed as observations, which are dropped by design (`review-arrival-is-legible` decisions 1 and 2). Verification passes inherit Drive mode only if the previous pass left `walkthrough.webm` (`review-ticket.ts:192`), so a missing ffmpeg silently downgraded six browser-found defects to diff reading. And the review page shows the latest pass only, with older recordings behind a disclosure (`flow-redesign-build-review-and-ship` decisions 19 and 41c), so "lap 2 found six defects, lap 3 verified nothing" is not readable at a glance.

## Settled in the project session (2026-09-15)

1. **A third review outcome, `unverified`**, beside `done` and `couldNotReview` (`review-ticket.ts:566`). A pass is unverified when it produced neither drive evidence nor a completed gates run. It blocks nothing: auto-advance to Review still happens (the operator chose fewer blocks, see "Four states and two hard rules"). But it is loud: the review page arrives with "nothing verified this lap" as the top line, the run card says succeeded-unverified, the digest headline is a template runcastle fills ("Lap 3 · drive mode · DRIVE FAILED · nothing verified") rather than the agent's prose, and the chat's injected context carries it into the next lap.
2. **Finding kinds stay.** Defect and observation as decided in `review-arrival-is-legible` decisions 1 and 2. Once "drive failed" is an outcome, observations really are inert; do not add a third kind or carry observations across laps.
3. **Verification passes read the recorded mode of the pass they verify**, not the presence of a webm. Agent-browser's working state (not just its presence on PATH, `review-ticket.ts:125,158`) is part of drive availability; ffmpeg absence is reported, not silently downgraded.
4. **An "Agentic review" button beside Test drive on the review page, always available.** It mints a fresh `kind: review` ticket for the current lap and burns it. This generalises the narrow retry that exists today only for dirty-drive denials (`retryTicket`, `features.ts:941-962`, `latestRunDeniedDirty`). The `denied-review-drives-classify-wait-surface-retry` banner and its Retry become one case of this button.
5. **A lap is one burn run plus the review that follows it** (settled in "Four states and two hard rules"). The review page shows a trail with one entry per lap: what burned, the review's outcome including unverified, the drive recording if any, notes and findings. All laps visible, not latest-only with a disclosure.
6. **The review-ticket prompt gets the failure branch** the audit asked for: "dev URL answers but no browser attaches = drive failure: record it as the pass's outcome, then run Gates mode in full", explicitly exempt from the "never run both modes" rule in `packages/skills/burner/review-ticket.md:7-12`. Verification reviewers are told what happens to their defects.

## What this feature must decide in its own session

- How `unverified` is detected: agent-declared in the digest, inferred from artefacts (recording, gate-run log), or both. The audit shows agents report honestly; the orchestration is what lied.
- The trail's design against `flow-redesign-build-review-and-ship` decision 19's rationale ("lap-scoping the evidence blanks the stage the moment a lap flips"). A per-lap trail is a different design from a lap filter; the feature must not re-open the blank-stage problem.
- What the trail shows for a lap whose review is unverified, and how notes and findings sit per lap next to the current open-work rail (`apps/web/src/components/review/NotesRail.tsx`, `OpenWork.tsx`, `CarriedFindings.tsx`).
- Whether Agentic review is enabled while a burn is running (it is a burn itself; one burn at a time is a hard rule).

## What this feature must NOT swallow

- **The state model, the gates, when auto-advance fires.** "Four states and two hard rules" owns them.
- **Where the feature chat sits on the review page.** "One chat per feature" owns that; this feature leaves room and does not design it.
- **Finding kinds, the auto-fix cap, carry/link/close** (`open-findings-survive-laps-carry-link-or-close`). Consume as they are.
- **The test drive mechanics** (checkout switch, drive setup, `project-level-test-drive` in flight).

## Already settled elsewhere, still binding

- `review-arrival-is-legible` decision 3: Merge is not always primary. An unverified lap is a strong case for Merge not being primary.
- `review-arrival-is-legible` decision 8: observations render only in the Full account.
- `expandable-review-stage-with-persistent-side-notes` decision 2/6: the notes rail is a permanent side rail; the stage can expand.
- `flow-redesign-build-review-and-ship` decision 40e: no opt-out toggle for the verification pass.
- `failure-aware-scheduling-for-review-and-verification-passes`: review does not run until implementation tickets are terminal; verification not until fix tickets are. Unchanged.
