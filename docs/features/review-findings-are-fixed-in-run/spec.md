# Review findings are fixed in-run

## Problem

When a burn finishes, the human lands on the review phase facing a wall of prose test notes written by the review agent. Each note is a self-contained ~200-word paragraph, and many are not defects at all — summaries, "worth your attention" remarks, could-not-verify warnings — so every one must be read in full just to learn whether it needs action. Turning a genuine defect into a fix then takes a manual round trip: open the Address-notes dialog, promote, burn, wait, return. The review that should be saving the human time is costing it, and the human's own test-drive notes ledger is polluted with agent output.

## Approach

**From the human's side.** The burn runs its implementation tickets, then the review ticket. As the review reports each finding it is stored as a typed, structured row — a `defect` or an `observation`. Every defect (up to a cap of 8 per review, in order reported — the review reports highest severity first) immediately mints a fix ticket in the current lap, blocked by the review ticket; when the review completes, the same run continues into those fix tickets with no click. There is no second review pass: each fix burner must re-run the finding's own repro step before declaring done, and runs the normal verify gates on top. The human then arrives at the review phase to:

- the digest prose the review wrote, with observations listed compactly beneath it;
- one computed line — *"9 defects found · 8 fixed automatically · 1 still open · 3 observations"*;
- only the still-open defects as a list (title + severity + one line naming why it is open: "over the auto-fix cap" or "fix failed: <reason>"; detail expandable; per-row Dismiss);
- a next-step bar whose primary is **"Fix N open defects"** whenever N > 0 — one click, no dialog: it mints fix tickets for every open defect and burns them via the existing Fix loop-back (same lap) — and **Merge & ship** otherwise. Merge stays one click; open items are information, never a block.

The human's own test-drive notes channel is untouched by review agents, and its notes render compactly too (title + one line, detail expandable). Address notes remains for human notes only.

**Shape.**

*Findings store.* A new `review_findings` table in core's drizzle schema with a matching zod schema, roughly (shape from the ideation discussion — decisions 2, 5, 6):

```
id, featureId, lap, reviewTicketId,
kind: 'defect' | 'observation',
severity: 'high' | 'medium' | 'low',
title, location, citation, detail, reproStep,
status: 'open' | 'fixing' | 'fixed' | 'failed' | 'dismissed',   // defects; observations are always 'open'
openReason: 'over-cap' | 'fix-failed' | null, failureReason,
fixTicketId | null, createdAt
```

A `review-findings` service owns writes and emits an event on each mutation, as every mutating service does.

*Tickets.* `tickets` gains a nullable `originFindingId`. Fix tickets are `kind: implementation` with the project's default implementation model, built mechanically from the finding: title = finding title, goal = "Fix: <title>", context = location + citation + detail + repro step verbatim, exactly one acceptance criterion — the repro step no longer reproduces / the cited criterion holds. `storeTickets` stamps seq and lap as today.

*MCP.* A new tool `report_finding` (zod-validated) exposed to review sessions only; `add_test_note` is withdrawn from review sessions. For a defect it writes the finding and — if fewer than 8 defects of this review already hold a ticket — mints the fix ticket (`blockedBy: [reviewTicket.seq]`, status `pending`) and links it; otherwise it stores the defect `open` with `openReason: over-cap`. Each call is independent, so a review that dies mid-way keeps every defect already reported. Dismiss and "fix open defects" are tRPC procedures for the UI, not MCP tools.

*Scheduler.* The burner currently snapshots the pending set once at run start. After a review ticket goes terminal the burner re-reads the feature's tickets and admits newly pending tickets whose blockers are satisfied into the same run, so the fix wave burns inside the one `runs` row. A failed fix ticket flips its finding to `failed` with `openReason: fix-failed` and does not cascade to sibling fix tickets (the same exemption the review ticket already has). The run finalizes only when everything — including fix tickets — is terminal, so the existing G4 auto-advance lands the human in review exactly once. The fix-burner prompt receives the repro step and requires the burner to re-run it and report that in its digest.

*Review prompt.* The review-ticket prompt asset switches from `add_test_note` to `report_finding`, drops the step-4 summary note (the digest is the summary), sends everything non-actionable to observations, defines defect/observation and the severity scale exactly as decided, and instructs the agent to report defects highest-severity first. The review skill's judgement — axes, citations, smell list, drive/gates modes — is unchanged.

*Review page.* The lead card renders digest prose + observations + the computed counts line; an open-defects list with per-row Dismiss; the next-step bar rule above. "Fix N open defects" promotes every open/failed defect to fix tickets (same mechanical builder), flips them to `fixing`, and starts the burn. Counts are derived server-side from findings joined to fix-ticket status so they cannot disagree with the tickets. Human notes render compact.

## Seams

- **`report_finding` MCP tool → `review_findings` + `tickets` rows** *(new)*. Observe: a defect call yields a finding row plus a linked pending fix ticket blocked by the review ticket; the 9th defect yields a finding with `over-cap` and no ticket; an observation yields a row only; the tool is absent from non-review sessions and `add_test_note` is absent from review sessions.
- **Burner scheduler admission after review-terminal** *(new — the highest seam in the burner)*. Observe: with the review ticket done and fix tickets pending, the same run burns them and finalizes once; a failed fix ticket marks its finding `failed` and siblings still burn; the run row reflects the fix wave.
- **Review-page read model (tRPC feature query)** *(existing, extended)*. Observe: counts line values, open-defects list with `openReason`, observations, for a given set of finding + ticket rows.
- **Next-step bar (`nextStep`)** *(existing)*. Observe: primary is "Fix N open defects" iff open defects > 0, else Merge & ship; Address notes reflects only human notes.
- **"Fix open defects" and "dismiss finding" tRPC procedures** *(new)*. Observe: every open/failed defect gets a fix ticket and flips to `fixing`, the Fix loop-back starts a burn, lap unchanged; dismiss flips one finding to `dismissed` and the count drops.
- **Review prompt asset** *(existing)*. Observe: the rendered prompt names `report_finding`, contains no summary-note step, and carries the defect/observation + severity definitions.

## Out of scope

- The review skill's judgement (axes, citations, smell list) and its drive / video walkthrough machinery.
- The human's own test-drive notes capture flow and the semantics of the Fix / Iterate / Merge verbs.
- Any second review pass or full re-review loop.
- Review reliability — provider outages, orphaned agents (`burn-reliability`).
- Any merge gate with teeth; open items never block Merge.
- A config knob for the cap; it is fixed at 8.
- The open notes `review-fixes` left behind (Gates-mode config resolution, brief commit placement) — they belong to that feature, though fix tickets here inherit whatever prompt it landed.

## Open questions

- None blocking. Whether `review_findings` rows are also rendered into a versioned doc under the feature's docs dir (as test notes are) is left to implementation; the DB rows are the source of truth.

## Later laps

- Compact rendering of the human's own notes (title + one line, detail expandable) may be deferred to lap 2 if the batch runs long; everything else is lap 1.
