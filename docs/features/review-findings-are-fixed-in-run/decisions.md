# Decisions — Review findings are fixed in-run

Intake decisions (brief.md §"The shape agreed at intake") are locked here as 1–4; the grill refines them, it does not reopen them.

## 1. Findings are typed; defects burn automatically in the same run; no re-review
**Decision:** The review emits structured findings, each typed `defect` | `observation`. Observations go into the DIGEST (the review page's lead card), never into the notes list; the prompt's step-4 summary note goes away. Defects become implementation (fix) tickets in the current lap, blockedBy the review, and the run continues into them with no human click. There is **no second review pass**: each fix burner's own verify gates + digest are the check, and the human's test drive is the second pass. A cheap targeted check inside the fix burner (re-running the finding's repro step / cited test) is in scope; a whole-review loop is not.
**Why:** One run, one digest, one arrival. A re-review would roughly double review cost for exactly the ceremony being removed. Typed findings are what let the page say "N fixed, M open, K observations" instead of a wall of paragraphs. Supersedes improve-workflow decision 6; amends decision 2.

## 2. Defect vs observation
**Decision:** A `defect` is something a fix ticket can act on — a cited hunk or a reproducible drive step. An `observation` is everything else: the summary, "worth your attention", deferred scope, could-not-verify, partially-built-feature warnings. Each finding carries at least kind, one-line title, severity, location (file+hunk or screen+steps), the citation the skill already demands, and detail. Unsure → observation.
**Why:** A false observation costs the human one line; a false defect costs a burn and possibly a wrong change.

## 3. What the human sees on arrival at review
**Decision:** The digest; a summary line "N defects found and fixed automatically, M still open, K observations"; and only still-open items as notes — defects whose fix ticket failed, or hard blockers the review could not act on. Fix / Rethink / Merge stay for what the human finds themselves. Open items are information, not a merge block.
**Why:** Charter decision 9 — "only hard blockers surface."

## 4. Notes render compact
**Decision:** A note renders as title + severity + one line, detail expandable — for the human's own notes too. The human's note-capture flow (quick capture, per-lap `test-notes.md`, injection into the next lap) is unchanged.
**Why:** The panel stops being a wall in every case, without touching the human's channel.

## 5. Wire shape: `report_finding` → `review_findings` table; defects mint their fix ticket at report time
**Decision:** A new MCP tool `report_finding`, exposed to review sessions only (`add_test_note` withdrawn from them), writes a `review_findings` row (`featureId, lap, reviewTicketId, kind, severity, title, location, citation, detail, status, fixTicketId`). A defect's fix ticket is minted immediately on report: `kind: implementation`, `originFindingId`, `blockedBy: [reviewTicketId]`, status `pending`, current lap. Observations are rows only, rendered under the digest prose. Review agents never touch `test_notes`.
**Why:** Sent-as-found means a review that dies keeps its defects; blockedBy on the review ticket means the existing scheduler runs the fixes in the same run with no new "wave" concept. Counting found/fixed/open comes from one source — findings joined to fix-ticket status.

## 6. Cap of 8 auto-fix tickets per review; failed fixes are isolated
**Decision:** At most 8 defects per review mint fix tickets, in order of report (the review reports highest severity first). Defects above the cap are stored as findings with status `open` and no ticket, and the summary line says so plainly ("12 defects found — 8 fixed automatically, 4 over the auto-fix cap"). Fixed in code, no config knob. A fix ticket that fails puts its defect back to `open` with the failure reason attached and does not cascade — other fix tickets keep burning. Whatever stops (cap or failure), the human must never have to ask "what do I do now": the open list carries one obvious continuation (decision 7).
**Why:** 30 defects on a lap is a Rethink signal, not 30 burns; 8 keeps the fix wave no larger than the lap it fixes. A knob nobody asked for is ceremony.

## 7. Arrival at review: read one line, click Fix or Merge
**Decision:** The lead card shows the digest prose, then a summary line ("9 defects found · 8 fixed automatically · 1 still open · 3 observations") with observations listed compactly beneath. When any defect is open, the next-step bar's primary is a single **"Fix N open defects"** button — one click, no dialog: mints fix tickets for every open defect and burns them (existing Fix loop-back, same lap); Merge & ship becomes secondary, without a nag. When nothing is open, Merge & ship is primary as today. Each open defect renders as title + severity + one line naming why it is open ("over the auto-fix cap" / "fix failed: <reason>"), detail expandable, with a per-row **Dismiss** so the count can reach zero without a burn. **Address notes** remains for the human's own notes only; review findings never enter that dialog.
**Why:** The human's decision on arrival must be one line and one click — never "what do I do now".

## 8. Fix tickets are generated mechanically from the finding; the repro step is the check
**Decision:** `report_finding` builds the fix ticket without another agent: `title` = finding title, `goal` = "Fix: <title>", `context` = location + citation + detail + the reviewer's repro step verbatim (drive steps, or the failing test/command), `acceptanceCriteria` = one criterion — the repro step no longer reproduces / the cited criterion holds. The fix burner must re-run that repro step before declaring done and say so in its digest; the normal verify gates run on top. No re-review. Severity is `high | medium | low` (`high` = an acceptance criterion is unmet or data/flow broken), used for ordering and display only, never gating.
**Why:** The finding already contains everything a ticket needs; a generating agent would add latency and drift. Re-running the repro is the cheapest honest check the brief allows.

## 9. Defaults kept: review ticket emission, digest authorship, fix-ticket model
**Decision:** The tickets session still emits the review ticket as the batch's last ticket (improve-workflow decision 1). The review agent still writes `DIGEST.md` prose; observations render as structured rows beneath it; the counts line is computed from `review_findings` + fix-ticket status, never agent-written. Fix tickets use the project's default implementation model.
**Why:** No reason surfaced to move any of these; a computed count cannot lie.

## 10. One lap
**Decision:** Spec the whole feature for lap 1. Compact rendering of the human's own notes (decision 4, second half) is the only piece that may be parked under `## Later laps` if the batch runs long.
**Why:** Intake was thorough, the four areas touched (schema + MCP tool, burner/scheduler, review prompt, review page + next-step bar) are all settled code, and nothing needs prototyping.
