# Burn waits for the tickets session to close out

## Problem

The Burn button arms the instant a stored ticket batch satisfies G3 — while the ideation session is still emitting placeholder contexts, enriching them via `update_ticket`, and closing out. A human who clicks in that window burns agents on placeholder tickets, makes the session's remaining `update_ticket` calls fail against burning tickets, and (as observed live on drive-instructions, 2026-09-08) races the close-out badly enough that stopping the run orphans a ticket. Nothing server-side knows whether the session has finished its tickets work, so the click is legitimate by every rule while being obviously premature. A second sharp edge from the same incident: a session that calls `complete_phase({phase:"tickets"})` after the burn already crossed G3 gets the G4 check's answer ("N tickets not yet terminal"), which reads as a failure during a perfectly healthy close-out.

## Approach

From the user's perspective: the Burn button stays in a "session is finishing the tickets" waiting state until the ideation session declares its tickets work done, then arms. A mid-emit click becomes impossible; nothing else about burning changes.

The shape (all per locked decisions.md):

- **Readiness state.** The feature row gains a lap-scoped nullable field, `ticketsReadyLap`. The MCP `complete_phase({phase:"tickets"})` handler sets it to the current lap at the same point it emits `tickets.awaiting_burn` today. Lap-scoping makes it self-resetting for lap 2+ with no explicit clear, matching how the `tickets-approved` gate check already scopes. The field rides the existing feature wire type out to the UI.
- **Server guard.** The `burn` service's fresh-from-`tickets` path (and only that path) additionally requires readiness: `ticketsReadyLap === feature.lap`, OR no active talk session exists for the feature (the escape hatch — a session that died after emitting but before completing must not dead-end the feature; with nothing alive there is nothing to race). Refusal is a gate-style error naming what it's waiting on. The restart path (re-burn from `implementation`) and Iterate path (burn from `review`) do not consult readiness — they already skip G3 deliberately and keep working unchanged.
- **UI reflection.** The tickets-phase next-step resolver shows the Burn button only under the same condition (readiness field on the feature, or no live session — both already reachable from the resolver's input). Until then, tickets present but not ready renders a waiting step: the session is finishing the tickets. The UI reflects the truth; the server enforces it.
- **Idempotent late completion.** When `complete_phase({phase:"tickets"})` arrives and the feature is already past `tickets`, return `ok: true` with the current phase and a note that the tickets phase was already crossed and the burn has started — nothing left to complete. The `CompletePhaseResult` ok-branch gains an optional `note` field. This replaces today's fall-through to the G4 check.

Every mutation above that changes feature state emits its event per the project rule; `tickets.awaiting_burn` remains the milestone event and now coincides with the readiness flip.

## Seams

- **MCP `complete_phase` tool handler** (existing): observe that completing the tickets phase persists readiness on the feature row, and that a late call against a feature already past `tickets` returns idempotent success with the note instead of the G4 refusal.
- **`burn` service via the `feature.burn` tRPC mutation** (existing): observe that a fresh burn from `tickets` is refused before readiness, allowed after `complete_phase(tickets)`, allowed when no active session exists, and that restart/Iterate burns are untouched.
- **Tickets-phase next-step resolver** (existing, pure function): observe the waiting step while tickets exist but readiness hasn't flipped and a session is live, and the armed Burn step once ready or session-less.
- **Feature wire type / schema** (existing contract, extended): `ticketsReadyLap` present and correctly lap-scoped across laps.

No new seams.

## Out of scope

- The `emit_tickets` ~10KB payload timeout (root cause of the placeholder-then-enrich pattern) — parked as draft feature `emit-tickets-accepts-large-batches-without-timing-out`.
- The restart and Iterate burn paths — deliberately unchanged.
- Orphan-sweeping/retry machinery — behaved correctly in the incident.
- Any redesign of the phase machine or gate service.

## Open questions

None — all branches resolved or explicitly parked during ideation.
