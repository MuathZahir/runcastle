## Why this feature exists

Observed live on the drive-instructions feature (2026-09-08): the human saw the Burn button and clicked it while the ideation session was still closing out. The click was legitimate by every server rule — the feature entered phase `tickets` at spec completion, and the instant `emit_tickets` stored a batch satisfying G3 (`tickets-approved`, review ticket included), the button armed. Nothing in `burn()` (packages/server/src/services/features.ts, "G3 burn" block) knows whether the talk session has finished; `complete_phase({phase:"tickets"})` deliberately does not advance (it records work and returns `waitingOn: "human burn"`). So the burn started, the human noticed the session still running and stopped the run, and ticket 1 died as "orphaned — the run ended (cancelled) while it was burning".

The race window is real and was only survived by luck: because `emit_tickets` batches over ~10KB time out, sessions emit tickets with placeholder contexts ("Context follows via update_ticket.") and enrich each afterwards. A click inside that window burns agents on placeholder contexts, and the session's `update_ticket` calls then FAIL against burning tickets. This time the four updates landed seconds before the click.

## The shape to consider

- Make `complete_phase({phase:"tickets"})` flip an explicit "tickets ready / awaiting burn" state, and require it — in the UI's Burn-button condition and/or in the `burn` service's fresh-from-`tickets` path — before a first burn. Restart/iterate burns are untouched.
- Secondary sharp edge, same incident: `complete_phase({phase:"tickets"})` called after the burn already crossed G3 ran the G4 check and returned "4 tickets not yet terminal (3 pending, 1 burning)" — confusing; a "tickets phase already crossed" message would make the race legible from the session side.
- Root-cause option worth weighing against the gating fix: fix the `emit_tickets` ~10KB timeout itself, which is why the enrich-after-emit pattern (and most of the window) exists at all.

## What this must not swallow

- Not the restart path (re-burn from `implementation` with no active run) or the Iterate path (burn from `review`) — both already skip G3 deliberately and must keep working.
- Not the orphan-sweeping/retry machinery — it behaved correctly in the incident.
- Not a redesign of the phase machine or gate service; this is one extra readiness condition on the first G3 crossing plus an error-message fix.
