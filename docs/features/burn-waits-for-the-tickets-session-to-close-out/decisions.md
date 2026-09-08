# Decisions — burn-waits-for-the-tickets-session-to-close-out

## 1. Single lap, no map
**Decision:** Spec the whole feature in one lap — no waypoint map, no thin lap-1 slice.
**Why:** Small and sure: one readiness condition on the first G3 crossing, one error-message fix, one UI condition. The design tree is narrow and every branch is already visible in the code.

## 2. Readiness is a durable, lap-scoped field on the feature row
**Decision:** Add `ticketsReadyLap: number | null` to the feature row. `complete_phase({phase:"tickets"})` sets it to the current lap at the same point it emits `tickets.awaiting_burn`. The `burn()` fresh-from-`tickets` path refuses when readiness isn't met (server is the real guard); the UI tickets resolver shows a "session is finishing the tickets" waiting state instead of the Burn button until it flips (UI reflects, doesn't enforce).
**Why:** A durable column beats deriving from the event log (queries become load-bearing on the timeline) and beats a UI-only live-session check (leaves the server race open). Lap-scoping makes it self-resetting for lap 2+ with no explicit clear, matching how G3's `tickets-approved` check already scopes to the current lap. Restart (from `implementation`) and Iterate (from `review`) paths don't consult it — they already skip G3 deliberately.

## 3. Escape hatch: a dead session must not dead-end the feature
**Decision:** Burn also arms when no active talk session exists for the feature — readiness = `ticketsReadyLap === feature.lap` OR no active session. Applied in both the server guard and the UI condition.
**Why:** A session that crashes after emitting tickets but before `complete_phase(tickets)` would otherwise lock the feature forever. With no session alive there is nothing left to race, so degrading to today's behavior is safe and correct.

## 4. Late `complete_phase(tickets)` is idempotent success
**Decision:** When a session calls `complete_phase({phase:"tickets"})` and the feature is already past `tickets` (burn crossed G3), return `ok: true` with the current phase and a note ("tickets phase already crossed — the burn has started; nothing left to complete"). The `CompletePhaseResult` ok-branch gains an optional `note` field.
**Why:** The work being reported did complete — the crossing happened via the human's Burn click. Today the call falls through to the G4 check and returns "N tickets not yet terminal", which reads as a failure and sends a healthy close-out into a fix-something loop. `ok: false` with a clearer reason would still mislead the session into thinking action is needed.

## 5. The emit_tickets ~10KB timeout is parked, not fixed here
**Decision:** The root-cause option (fixing the emit_tickets payload timeout that forces the placeholder-then-enrich pattern) is out of scope — parked as draft feature `emit-tickets-accepts-large-batches-without-timing-out`.
**Why:** The gating fix is necessary regardless: even with instant, fully-enriched emits there is a close-out window between the last emit and the session finishing (the incident's updates landed seconds before the click). The timeout is transport/payload work with its own investigation, and folding it in would widen this feature past its "one readiness condition plus an error message" boundary.
