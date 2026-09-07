## Why this feature exists

The human lands on the review page and cannot tell what state things are in or what to do. This is a second lap on ground two shipped features already own — and most of what hurts is *confirmed design failing in practice*, not regressions. The grill session must treat those prior decisions as the thing under revision, with the human's fresh complaints (2026-09-07, with screenshots) as the evidence.

The complaints, each tied to its prior decision:

1. **"Iterate" as the primary button is illegible.** The human expected "Merge & Ship" to lead and took real time to work out that Iterate leads *because open notes/defects exist*. This is decision 21 of `flow-redesign-build-review-and-ship` ("one door forward: the bar offers Merge & ship or Iterate; triage lives inside the Iterate door", confirmed 2026-09-04) working exactly as designed — and the human's confusion is evidence the design does not communicate itself. The dependency between "notes exist" and "which button is primary" must become either visible or gone. Related: decision 7 of `review-findings-are-fixed-in-run` (arrival = "read one line, click Fix or Merge").

2. **Clicking Iterate dead-ends on a disabled button.** Lap 2 cannot start until the human manually ends the still-live session ("why doesn't it close it automatically???"). The stale talk session should be auto-ended when the human commits to the next lap — the grill should work out when auto-ending is safe (sessions land docs on close) rather than leaving a disabled button with no path forward.

3. **Observations add nothing.** They are agent-work-specific, not issues, not improvements. Decisions 1–3 of `review-findings-are-fixed-in-run` deliberately kept them rendered compactly under the digest ("a false observation costs the human one line"); the human now says even one line is noise. The grill must decide: hide them in the UI (keep recording) vs stop the review agent emitting them at all (machinery + prompt change). Note observations still feed the digest prose either way.

4. **The session panel occupies the top of the review page** — screenshot showed a live *ideation* session panel above the fold on the review phase. Decision 17 of `flow-redesign-build-review-and-ship` says review opens on the shared evidence stage (walkthrough player by default). A live session from an earlier phase dominating the page is at minimum an unhandled state, possibly a straight bug — verify against the shipped ReviewBody band structure (decision 34, `components/review/`).

5. **The walkthrough panel renders a placeholder when there is no walkthrough** ("No walkthrough yet — …"). The human's position: if there's no walkthrough, show no panel. Decide what the evidence stage shows instead in that state.

6. **Too much text, flow all over the place** — despite decision 5 item 4 of the same feature already demoting prose to progressive disclosure, the shipped page still reads as walls (test-drive explainer paragraph, unverified-checks line, digest, findings, carried section, full accounts). The page must lead with state and one obvious action.

## What is already settled

- The `report_finding` pipeline (typed findings, defects minting fix tickets in-run, the cap of 8, computed counts) is settled machinery — only its *rendering and the observation question* are on the table.
- The walkthrough player and annotation loop internals shipped and work; they are out of scope. Only the *empty state* of the stage is in scope.
- ADR-0010 (laps) binds the lap model; this feature changes how lap transitions feel, not what they are.

## What this must NOT swallow

- The walkthrough player / annotation internals.
- The review agent's finding classification and fix-burn machinery (beyond the observation-emission question).
- The run view and burn lanes.
- Any other phase's page.

## Portfolio note

`enforce-the-one-review-ticket-rule-in-machinery` is in flight (ideation) and touches review machinery — likely disjoint from this UI work, but whichever lands second should merge with care.
