## Why this feature exists

Part of the 2026-08-28 decision to redesign the runcastle web app **one flow at a time** on top of `web-ui-foundation-tailwind-tokens-primitives-and-carving-feature-ui`. This is flow 7 of 7 and the largest; the human chose to keep it **whole** rather than split at the annotation seam, because the annotate → note → fix-ticket → next lap loop is the one flow that cannot be judged in halves. Expect the ideation to go mapped (ADR-0001). **Order:** land last of the three `Workspace.tsx`-touching flows (after project-shell and ideation→tickets).

## The flow, as it exists

- `apps/web/src/components/bodies/RunBody.tsx` — ticket lanes | tabbed Agent (live transcript, `AgentTranscript.tsx`) / Events; cancel run, per-ticket controls (ADR-0006).
- `components/bodies/ReviewBody.tsx` (894 lines) — run summary card, test-drive panel, `DrivePane` ("Open app"), `WalkthroughCard`, `NotesPanel`/`NoteEditor`, `ConflictCard`, `DriveFailureCard`, `LapAccountBlock`, `PlannedNextLapCard`, `StopReviewDrive`.
- `components/WalkthroughPlayer.tsx` + `lib/walkthrough.ts` + `lib/reviews.ts` — the review agent's video: scrub, pause-and-annotate (draw on frame → note → save), notes jump the playhead.
- `components/AddressNotesDialog.tsx` — triage: quick fixes (batch promote to tickets) or Iterate (new lap).
- `components/MergeFeatureDialog.tsx`, `lib/use-resolve-conflict.ts`, `components/bodies/ShippedBody.tsx` (+ "Ask a question" Q&A terminal).
- Derivations: review checks, merge summary, lap account, review outcome — carved out of `feature-ui.ts` by the foundation.

## Known issues going in

- Human: "the annotation flow doesn't work well and isn't very user friendly." `docs/features/video-annotation-for-reviews/` holds the design it was built to; walk it and find where it breaks down.
- `docs/features/ux-issues/outcome.md` "left undone": `reviewOutcome()`/`reviewWalkthroughUrl()`/`reviewChecks` still pick across laps while `lapAccount()` is lap-scoped, so from lap 2 the summary row can vouch for an earlier lap's review; the conflict card offers a live action in the read-only shipped view; notes batch-promote does not append a review ticket (decision 9 half-enforced).
- Prior audit (`docs/features/identify-random-issues-throughout-the-system/findings.md`): F3 Rethink during test drive, F8 Merge & ship over an active conflict, F21 merge one-click, F22 test drive fakes success with no dev command, F23 summary wrong data in green, F25.1 "Burn 0 tickets", F12 burn copy. Check which its tickets closed.
- Already decided and to be *reflected*: `review-findings-are-fixed-in-run` (review agent's defects burned in-run; human arrives to a digest + open list), `laps` / ADR-0010 (Fix / Iterate / Merge verbs, lap banner, notes per lap), `make-test-drive-clear`, `test-drive-improvements`, `fix-merge-conflict-system`, `the-work-record-gets-thick` (digests, run summaries, outcome doc).

## How the ideation session must work (human's instruction, applies to every flow feature)

1. Walk the whole flow with agent-browser, on a feature carried from Burn through a run (success, failure, cancel), review with and without a walkthrough, test drive with and without a dev command, annotate a frame, triage notes both ways, a lap 2, a merge conflict and its resolution, merge, and the shipped view. Every branch, button, dead end.
2. Present the complete flow map to the human and get it confirmed before designing. The human will add issues the walk missed.
3. Redesign on the foundation's tokens and primitives; the review page is the most crowded surface in the app — decide what a returning human needs to see first.
4. Code quality is in scope for this flow's files (`ReviewBody.tsx` is the obvious split).
5. Migration rule: move this surface's rules out of `styles.css` into Tailwind and delete the old rules; this is likely the last flow to land, so it deletes what remains of `styles.css`.

## What it must NOT swallow

- The burner/review workflows themselves (`packages/server/src/workflows/*`, ADR-0002/6/7/8) and the skills — reflect their outputs; don't change what they do. Server bugs found in this path (e.g. the lap-scoped review pick) are fair game.
- Ideation/spec/tickets surfaces (flow 6) and the shell (flow 2).
- Preparation (flow 4) — the drive consumes its findings.
