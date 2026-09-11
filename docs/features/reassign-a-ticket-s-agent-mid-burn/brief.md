## Why this exists

Real incident: the human's Codex usage limit ran out mid-burn. They wanted to switch the remaining tickets to Claude and could not — the run had to die on its own, burning retry attempts against an exhausted quota, before anything could be changed.

## What the code says today (verified 2026-09-10)

The gap is three-layered, and only one layer is a missing button:

1. **Backend already permits it, narrowly.** `ticket.edit` (packages/server/src/trpc/routers/ticket.ts:131) accepts a `model` reassignment on `pending`/`failed` tickets — per-ticket assignments shipped with `model-chooser-for-review-agent` (its decisions.md #4). `assertMutable` (packages/server/src/services/tickets.ts:183) refuses only `burning` rows. The edit is not refused while a run is live.

2. **The UI never offers it once a burn starts.** The `ModelMenu` lives on `TicketRow` in the tickets-phase ledger (apps/web/src/components/bodies/tickets/TicketRow.tsx:42, gated on pending/failed). Once implementation starts, the human is on `RunBody` lanes (apps/web/src/components/bodies/RunBody.tsx), which offer retry/stop/waive but no model control.

3. **A live run wouldn't see the edit anyway.** The scheduler works off an in-memory snapshot of the ticket rows taken at run start (`burnTickets`, packages/server/src/workflows/ticket-burner.ts:2630 — "ctx.tickets stays the snapshot the run started from"), and `resolveTicketModel` (ticket-burner.ts:4434) reads `ticket.model` off that snapshot at launch. So a mid-run reassignment of a still-queued ticket is silently ignored for this run. Additionally, ADR-0006 refuses `ticket.retry` while a run is live, so the only recovery path is: wait for the run to end, edit each ticket, re-burn.

Note `ticketCredentials` (ticket-burner.ts:4520) already re-resolves model AND auth token per ticket — cross-runtime reassignment (codex → claude-code) is already handled downstream of resolution; the per-ticket auth precheck (`ticketAuthMissing`) also runs per ticket. The plumbing below the snapshot is ready for this.

## Scope

- Run lanes surface the model menu on pending/failed tickets (same roster, same `ticket.edit` door).
- The scheduler resolves a ticket's model at LAUNCH time — re-read the row (or at least its `model` column) when the lane starts, instead of trusting the run-start snapshot — so reassigning a queued ticket mid-run takes effect in the same run.
- A failed lane's retry honours the new assignment; ideally "retry on <other model>" is one gesture, not stop-run → edit → re-burn.
- Adjacent classification tweak (agreed in intake): "usage limit exhausted" wording should classify FATAL (fail fast), not retryable — a weekly quota never recovers inside a 5/10/20s backoff, and today each stranded ticket eats `burnAttempts` retries against a wall before the human can act. This is a narrow addition to the existing fatal tables (ticket-burner.ts ~2163-2255), not a rework of classification. ADR-0006's structure (fatal wins, unknown defaults fatal) stands.

## Design questions for the grill (not settled here)

- Should a *burning* ticket be stop-and-reassign in one click, or is reassignment only for pending/failed (with stop as the human's separate first move)?
- Does a mid-run edit reach only not-yet-launched tickets, or should there be any signal to a lane already running? (Recommendation: launched lanes are committed; only launch-time resolution changes.)
- Does the run-level auth precheck need revisiting when tickets can change runtime mid-run? (The per-ticket precheck already exists — probably just confirm it runs at launch, post-edit.)
- Where exactly the launch-time re-read lives so the precheck (`ticketAuthMissing`) and executor cannot disagree (they currently share `ticketCredentials` — keep that property).

## Must NOT swallow

- **Automatic runtime fallback** (quota exhausted → silently burn on the other runtime). That is a policy feature of its own with real consent questions; this feature is strictly the manual path.
- **Broad error-classification rework.** Only the usage-limit-exhausted wording moves to fatal; ADR-0006's tables and retry mechanics are otherwise untouched.
- **Scheduling changes.** `failure-aware-scheduling-for-review-and-verification-passes` is in flight (lap 2) and owns review/verification scheduling; stay off it. Both features touch ticket-burner.ts — whichever lands second wears the conflict, so keep this one's edits narrow (launch-time model resolution + fatal table entry).

## Binding decisions

- ADR-0006 (attempt chaining, per-ticket controls) — extend, don't contradict: retry-while-run-live is refused for scheduler-snapshot reasons; if the grill wants in-run retry-with-new-model, it must address why ADR-0006 refused it (the scheduler would strand a reset ticket) rather than just lifting the guard.
- Per-ticket model assignment semantics come from model-chooser-for-review-agent decisions.md #4: the assignment IS the run override for that ticket's burn; empty clears back to the resolveModel chain.
