# Open findings survive laps: carry, link, or close

## Problem

When a review reports defects and the human Rethinks into a new lap, the new lap's work often fixes those defects — but the finding rows never hear about it. A finding closes only when its own linked fix ticket lands or when the human dismisses it; lap-N+1 tickets carry no link, so genuinely-fixed lap-N defects render as permanently open in every later review. The counts inflate, the human clicks Iterate believing there are live defects, and the diagnosing session has no tool to correct the record. Meanwhile the lap boundary already triages test notes (carry / promote / dismiss) — open defects never got the equivalent.

## Approach

The Rethink/lap session becomes the owner of earlier-lap defect triage, with the human's existing verbs (dismiss, quick-fix promotion) kept as escape hatches. Every open defect from an earlier lap must be dispositioned one of three ways before the lap's tickets phase can complete:

- **Link** — the session emits a lap ticket carrying the finding's id (`originFindingId`, already in `TicketInput`). Storing such a ticket stamps the finding's `fixTicketId` and flips it to `fixing`; the existing burner lifecycle (`markFixProgress`) then drives it to `fixed`/`failed` when the ticket lands. No new machinery — this is the shipped auto-close path, reached from `emit_tickets`. The emit path validates that an `originFindingId` names an open or carried defect of this feature.
- **Close-as-addressed** — the finding goes to the existing `fixed` status plus a provenance marker distinguishing a session attestation from a burner-verified fix (`resolvedBy: 'fix-ticket' | 'session'` or equivalent), with a required short attestation note ("addressed by lap 2's ticket 7"). No new status: addressed IS fixed; provenance keeps the evidence classes distinct for the UI without the counts caring.
- **Carry** — a new `carried` finding status plus a `carriedLap` column, mirroring test-note carrying exactly: out of the open count, rendered in its own section, reopenable by the human only.

**The tool.** One new MCP tool `resolve_finding({ findingId, disposition: 'carry' | 'addressed', note })` — `note` required for `addressed`, optional for `carry` — registered for the same session kinds that get `emit_tickets` (`FEATURE_WRITE_KINDS`). Guards mirror the quick-fix promotion path: the finding must be an open (or carried) defect of this feature. Carry stamps `carriedLap` = the feature's current lap. The session gets no reopen verb.

**The gate.** `complete_phase(tickets)` hard-fails while any defect from a lap earlier than the current one is still `open` (or `failed` with no live fix ticket), listing the offenders by title. Current-lap findings are the burner/review loop's business and are untouched; lap 1 passes trivially. There is no stuck state: the session holds every verb the gate demands, and the human can pre-empt by dismissing in the UI.

**The read model.** The findings view's summary and `openDefects` scope to the feature's current lap, making "N still open" describe this lap's review. Carried findings render in their own section ("captured lap N, carried into lap M") with human reopen/dismiss per card. Lap sessions receive carried findings in their kickoff context alongside `openDefects` as agenda, not obligation — `resolve_finding` accepts carried findings (link or close), but no lap is forced to re-carry. The lap kickoff briefing upgrades from "address them" to stating the disposition obligation; the revisit skill carries the procedure. The boundary triage preview's defect count inherits the new scoping.

## Seams

- **`resolve_finding` MCP tool** (new) — the session-facing verb; observe carry and close-as-addressed transitions, note requirements, and guard rejections (wrong feature, not a defect, already closed).
- **`emit_tickets` with `originFindingId`** (existing tool, new behavior) — observe the stamp+flip at store time, the validation of the id, and downstream that the shipped burner path closes the finding when the ticket lands.
- **`complete_phase(tickets)` gate** (existing seam, new check) — observe the hard-fail listing un-dispositioned earlier-lap defects, and the pass once each is linked/carried/closed/dismissed.
- **Findings view service (`viewByFeature`)** (existing) — observe current-lap scoping of summary/openDefects and the new carried section; `triagePreview` inherits it.
- **Lap-session kickoff context** (existing — `get_feature_context` + briefing artifacts) — observe carried findings and open defects presented as the lap's agenda with the obligation stated.
- **Human tRPC verbs** (existing: dismiss; new: reopen-carried) — observe reopen returning a carried finding to open.

## Out of scope

- The burner-side fix loop (`review-findings-are-fixed-in-run`) — in-run defect → fix ticket → auto-close stays untouched.
- The human dismiss path — it exists and stays.
- Escaping an empty/accidental lap — its own drafted feature ("Backing out of a lap"); this feature only makes the findings state truthful.
- Forcing re-affirmation of carried findings each lap — carry is sticky by design.

## Open questions

None — all four intake questions were resolved in decisions 1–5.
