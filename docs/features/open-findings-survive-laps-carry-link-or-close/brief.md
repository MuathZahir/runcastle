## Why this feature exists

Observed on a real feature: lap 1's review reported defects; the human Rethought into lap 2, whose work actually fixed the defects — but the findings stayed `open` in lap 2's review phase. The human clicked Iterate believing there were more defects, the lap-3 session correctly diagnosed them as stale, and then had no tool to do anything about it. The feature was stuck mid-lap until a dummy ticket was burned just to re-reach review and merge. (The stuck-mid-lap half is a SEPARATE feature — see boundaries.)

## The mechanism, verified in code

A finding closes in exactly two ways:
1. Its linked fix ticket (`originFindingId`) reaches `done` — the burner path shipped by `review-findings-are-fixed-in-run` (`packages/server/src/services/review-findings.ts`: `progressFromTicketStatus` → `markFixed`, plus the defensive `defectState` that reads the fix ticket's status directly).
2. The human dismisses it (`packages/server/src/trpc/routers/review-findings.ts:22` → `services/review-findings.ts:171`).

That is the whole lifecycle. Three gaps combine into the observed failure:

- **Lap-N+1 tickets don't link.** A Rethink session emits fresh tickets with no `originFindingId`, so work that genuinely fixes a lap-1 defect never touches the finding row.
- **The findings view is not lap-scoped** (`viewByFeature` in `services/review-findings.ts`), so stale open defects from any earlier lap render in every later review phase, inflating the "N still open" summary.
- **Talk sessions have no findings tool.** `report_finding` is registered for `run` callers only (`packages/server/src/mcp/server.ts:1628`); revisit/lap sessions can neither mark a finding fixed nor stale — the lap-3 agent's "these are stale, nothing I can do" was literally true.

The contrast that shows the shape of the fix: the lap boundary ALREADY triages test notes — `triageNotes` (`packages/server/src/services/test-notes.ts:447`) carries, promotes (including `quickFixFindingIds`), or dismisses them. Open defects never got the equivalent treatment.

## Design questions for the grill (not settled at intake)

- Should the Rethink/lap session receive the open-defect list in its kickoff context and be REQUIRED to disposition each one (link a new ticket, carry, or close-as-addressed)?
- Does linking mean lap-N+1 tickets can carry `originFindingId`, or a separate "addressed by lap N" resolution status?
- Does a talk-session MCP tool for closing/dispositioning findings get added, and to which session kinds?
- Should the review-phase findings display scope to the current lap, with earlier laps' leftovers shown separately (or only after triage)?

## What this feature must NOT swallow

- **The burner-side fix loop** — `review-findings-are-fixed-in-run` shipped it and it works; in-run defect → fix ticket → auto-close stays untouched.
- **The human dismiss path** — it exists and stays.
- **Escaping an empty/accidental lap** — that is its own drafted feature ("Backing out of a lap"); this one only ensures the findings state is truthful so the human doesn't click Iterate on false pretenses in the first place.
