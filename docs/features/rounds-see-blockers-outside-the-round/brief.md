# Brief

This feature merges two drafts parked on 2026-10-21 by two different feature leads, who hit the same bug independently: "Rounds accept blockers that landed in earlier rounds" (from the `design-mode` lead) and "A round sees the blockers it did not name" (from the `several-sessions-per-feature` lead). The human deleted both, and this draft replaces them.

## Purpose
The lead's normal way of working is to land a contract in round 1 and build on it in round 2. That cannot work today, because any `blockedBy` edge that crosses rounds kills the dependent ticket. This feature makes a round respect blockers it did not name.

## What happened (two repros)
- **Blocker finished in an earlier round** (`design-mode`): round 1 landed #1, #2, #3 and #6. Round 2 dispatched #4 (blocked by #3), #5 (blocked by #2, #3) and the review #7 (blocked by #1–#6). All three failed at once with "blocked by missing ticket N", before any container started.
- **Blocker cancelled** (`several-sessions-per-feature`): round 2 named tickets 1, 2, 3 and the review ticket 5. Ticket 5 was blocked by 1–4, and 4 had been cancelled in a revisit. The round failed 5 with "blocked by missing ticket 4", although a cancelled ticket is documented to count as satisfied for its dependents.

The workaround in the first case was to cancel the dependents and re-emit them with only same-round edges. It works, but it churns tickets and loses the edge history.

## Traced (still present on main as of 2026-10-22)
- `dispatchRound` (packages/server/src/services/features.ts, ~970–983) starts the run with `ticketIds` set to only the named tickets.
- `startRun` (packages/server/src/workflows/runner.ts:116-117) filters the scheduler's ticket set to that scope.
- The scheduler's `readyState` (packages/server/src/workflows/ticket-burner.ts:3281-3296) treats a blocker absent from the set as a malformed graph and fails the dependent ("blocked by missing ticket N", :3502).
- The comment at ticket-burner.ts ~:3613 ("cancelled tickets ... DO stay in the scheduler's ticket set so dependents can see their blocker is satisfied") holds for a whole-feature burn, but not for a scoped round.

Reproduce first: dispatch a round that names only a ticket whose blocker is already done.

## Understood
- A blocker outside the round whose stored status is `done` or `cancelled` counts as satisfied. It sits in the scheduler's set as a satisfied blocker and is never burned as work.
- A blocker that is still pending or failed outside the round is not satisfied. The preferred outcome is that `dispatch_round` refuses the round up front, saying which blocker is not in this round, instead of a round that starts and fails. The wording must say "not in this round", not "missing".
- A review ticket's blockers follow this same rule. That alone fixes the review failures in both repros.

## Must not swallow
- Redesigning the review gate (`reviewGate` / `gatedImplementations`, which only looks at tickets in the run). Whether a later-round review should require earlier rounds' implementation tickets in some stronger sense is separate work that no one has asked for yet.
- The agentic-review mint's own scoping (runner.ts:79-86). It hides queued fix tickets on purpose.
- Round planning itself, or anything else about how the lead runs rounds.

## Open
- Whether to refuse a round with a pending outside blocker at dispatch time or let it wait. Refusing at dispatch is preferred; the feature's own session decides.

## Ordering
No dependencies. Standalone bug fix; any lead that runs multi-round features benefits as soon as it ships.
