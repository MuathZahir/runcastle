# Rounds see blockers outside the round

## Problem
The feature lead works in rounds: it dispatches a round over the pending tickets it names, and every other ticket waits for a later round. Its normal way of working is to land a contract in round 1 and build on it in round 2. That fails today. Any ticket in a round whose `blockedBy` names a ticket outside the round fails at once with "blocked by missing ticket N", before any worker starts, even when that blocker is `done` (it landed in round 1) or `cancelled` (which is documented to satisfy its dependents). Review tickets fail the same way, since they are usually blocked by every implementation ticket. Leads have worked around it by cancelling the dependents and re-emitting them with only same-round edges, which churns tickets and loses the edge history.

The cause: a round's run is scoped to the named tickets, and the scheduler treats any blocker absent from the run's ticket set as a malformed graph.

## Approach
From the lead's side:

- A blocker outside the round whose stored status is `done` or `cancelled` counts as satisfied. The dependent runs as soon as its in-round blockers allow; the outside blocker is never burned (decision 1).
- A blocker outside the round that is `pending` or `failed` makes `dispatch_round` refuse the whole round before anything starts (decision 3). The same refusal lists a blocker that does not exist on the feature at all (decision 5). One refusal names every offending edge, the blocker's status and the fix, and says "not in this round", never "missing". Its shape, for each edge: "ticket 4 is blocked by ticket 3, which is not in this round and is pending — name 3 in this round as well"; for a blocker that exists nowhere: "ticket 4 is blocked by ticket 9, which does not exist on this feature". It never suggests cancelling the blocker.
- Review tickets follow the same rule at dispatch. The review gate's own rule is unchanged (decision 4).
- The lead skill and the `dispatch_round` tool description say that a blocker landed or cancelled in an earlier round counts as satisfied, and list the new refusal (decision 6).

The shape of it:

**Dispatch check (`dispatchRound`).** After the existing refusals, the existing sweep of orphaned `burning` rows, and the existing per-seq validation of the named tickets, and before any named `failed` ticket is reset to `pending`, walk every named ticket's `blockedBy`. A blocker that is itself named is fine whatever its status (a named failed ticket is about to be reset). A blocker not named is fine when its stored status is `done` or `cancelled`. Anything else — `pending`, `failed`, or a seq with no ticket on the feature — is collected. If the collection is non-empty, throw one `GateError` listing every entry in seq order of the dependent, then the blocker. A refused dispatch starts no run, resets no ticket, emits no `round.dispatched`, and leaves `lastDispatchAt` alone. The orphan sweep having run first is accepted (decision 3): an orphaned row outside the round is then reported as `failed`.

**Satisfied outside blockers reach the scheduler (`startRun` → `WorkflowCtx` → scheduler).** `startRun` already splits the feature's tickets into the scoped set and the excluded rest. It additionally computes the seqs of excluded tickets whose status is `done` or `cancelled` and passes them to the workflow on a new optional field of `WorkflowCtx` (for example `satisfiedOutside: number[]`; the name is the builder's). An unscoped run passes nothing. The excluded rows stay hidden from the run's re-reads exactly as today; nothing about which tickets the agentic-review pass hides changes. A snapshot at run start is enough: outside blockers are all finished at dispatch (the dispatch check guarantees it for rounds), and finished statuses do not change while the round runs.

**Scheduler (`readyState` in the ticket burner).** A blocker that is absent from the run's ticket set but present in the satisfied-outside set is treated as satisfied, for every ticket kind. It is not added to the scheduler's ticket set, its status map, its pending set or anything the review gate, the "N done" count, the run summary or the verification-pass check reads (decision 2). A blocker absent from both still fails its dependent with "blocked by missing ticket N" — the backstop for a malformed graph in any run, including an unscoped burn (decision 5). The cycle guard is unaffected: it only walks edges within the run.

**Docs for the lead.** The `dispatch_round` MCP tool description gains one sentence: a blocker outside the round that landed or was cancelled counts as satisfied; one still pending or failed (or that does not exist) refuses the round, naming each such edge. The lead skill's round-planning step and its "What the server refuses" section say the same in plain words, so a lead keeps cross-round edges instead of re-emitting tickets. The existing lead-skill test assertions must stay true.

## Seams
- **`dispatchRound(ctx, featureId, seqs)` service — existing.** The highest seam: drive it with tickets stored through `storeTickets` and statuses set through `updateTicket`. Observe the refusal (a `GateError` and its message listing each edge) and that a refused call changed nothing (ticket statuses, no new run row, no `round.dispatched` event); or, on success, the started run and, with the burner faked, which tickets ran and which failed. This is where both brief repros are reproduced first: a round naming only a ticket whose blocker is `done`, and a round naming a review whose blockers include a `cancelled` ticket outside the round.
- **`dispatch_round` MCP tool over `/mcp` — existing.** The lead's real entry point (as the lead MCP tool tests already call it). Observe the refusal arriving as a tool error carrying the "not in this round" text, and the tool description text.
- **`startRun(…, { ticketIds })` → `WorkflowCtx` — existing seam, new field.** Observe that a scoped run's ctx carries the satisfied-outside seqs, that `tickets` and `listTickets` are unchanged, and that an unscoped run carries none.
- **`burnRun(ctx, deps)` with a fake executor — existing.** The scheduler-level seam the review-ticket and burner tests already use. Observe that a ticket whose blocker is in the satisfied-outside set runs; that a review blocked by such a ticket runs once its in-run implementations settle, with the review gate's verdict unchanged; that the run's done count and summary count only its own tickets; and that a blocker in neither set still fails "blocked by missing ticket N" (the existing test stays green).
- **Lead skill text and `dispatch_round` description — existing.** Observed by the lead-skill and lead MCP tool tests.

## Out of scope
- Any change to the review gate's own rule (`reviewGate` / `gatedImplementations`), including whether a later-round review should require earlier rounds' implementation tickets in a stronger sense.
- Which tickets the agentic-review pass hides from its run (its scoping), and the verification pass's minting.
- How the lead plans rounds, beyond the two doc sentences above.
- Unscoped (whole-feature) burns, single-ticket retries and every other dispatch refusal: unchanged.
- Letting a round wait on, or run around, an unfinished outside blocker (the rejected alternative to decision 3).

## Open questions
- Decisions 2, 3 and 4 were made without the human and are the ones to check first. Decision 4 was challenged: an unfinished outside blocker refuses a round with a review in it, while a blocker that fails during a round only puts the review off.

## Later laps
None: this is one lap (decision 7).
