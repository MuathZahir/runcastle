# Decisions — Burns become workers

## 1. No rounds, no tickets and no burn engine are left behind
**Decision:** This feature retires the review round, the remaining ticket and round machinery
(tickets, rounds, runs, `emit_tickets`, `dispatch_round` and the rest), the conflict-fixing agent,
and the sandcastle burn engine (`ticket-burner.ts` and its helpers). Build work already runs as
workers since `interactive-workers`; what the burn engine still protects against is carried onto
the worker runner, not kept beside it.
**Why:** Settled with the human in `interactive-workers` (its decision 13: "leaving no rounds and
no old code behind") and ADR-0019 (two levels, one kind of delegated work). Not re-asked here.
