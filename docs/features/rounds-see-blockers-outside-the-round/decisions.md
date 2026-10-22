# Decisions — Rounds see blockers outside the round

Planned without the human (self-planning run, 2026-10-22), with one independent challenger pass. Terms: a **round** is one ticket-burner run the lead starts with `dispatch_round` over the tickets it names; a **blocker** is a ticket named in another ticket's `blockedBy`; a blocker is **outside the round** when it was not named in that round.

## 1. A finished blocker outside the round counts as satisfied
**Decision:** When a ticket in a round is blocked by a ticket outside the round whose stored status is `done` or `cancelled`, the scheduler treats that blocker as satisfied, exactly as it would inside the round. The blocker is never burned. The rule lives where the scheduler reads blockers, so any run scoped to some tickets obeys it; today only rounds carry such edges (the agentic-review pass and the verification pass mint tickets with no blockers), and which tickets the agentic-review pass hides is not changed.
**Why:** It is the bug. Landing a contract in round 1 and building on it in round 2 is the lead's normal way of working, and a cancelled ticket is already documented to satisfy its dependents.

## 2. Outside blockers satisfy edges; they do not join the round
**Decision:** A finished blocker outside the round is known to the scheduler only as "satisfied". It is not added to the round's own ticket set, so the review gate, the round's "N tickets done" count and summary, and the verification-pass check keep seeing only the tickets the round named.
**Why:** If the earlier round's tickets joined the set, the review gate would count them as this round's landed implementations, the round would claim tickets it did not burn, and the verification pass would list fixes from another run. The brief rules the review gate out of scope; this keeps it untouched.
**Assumed.** Alternative: add the finished blockers to the scheduler's ticket set as non-burnable members, as the brief's sketch reads.

## 3. An unfinished blocker outside the round refuses the whole round at dispatch
**Decision:** If any named ticket has a blocker outside the round that is `pending` or `failed`, `dispatch_round` refuses the whole round before anything starts: no run, no failed ticket reset to pending. The existing clean-up of `burning` rows left by a dead run still happens first, so such a row is reported as `failed`. One refusal lists every such edge, says the blocker is "not in this round" with its status, and names the fix: name the blocker in this round too. For example: "ticket 4 is blocked by ticket 3, which is not in this round and is pending — name 3 in this round as well". The refusal does not suggest cancelling the blocker.
**Why:** A round that starts and then fails a ticket it could never run wastes the round and leaves a failed ticket to clean up. Refusing up front tells the lead exactly what to change, and listing every edge at once avoids a refuse-fix-refuse loop. The brief prefers this. Cancelling is left out of the suggestion because a cancelled blocker counts as satisfied: a lead taking the shortest path would cancel unfinished contract work and build on something that never landed.
**Assumed.** Alternative: dispatch the round anyway and leave the blocked ticket `pending` (deferred) for a later round while the rest runs.

## 4. Review tickets follow the same rule; the review gate is unchanged
**Decision:** A review ticket's `blockedBy` edges are judged like any other ticket's at dispatch: a finished outside blocker is satisfied (decision 1), an unfinished one refuses the round (decision 3). The review gate's own rule (it waits for every implementation ticket in the run, and puts the review off when one of them fails during the run) is not changed.
**Why:** That alone fixes the review failures in both repros in the brief. A failure inside a round happens while it runs and cannot be foreseen, so putting the review off is the right answer there; an unfinished blocker outside the round is known before anything starts, so the lead can fix the round instead.
**Assumed.** Alternative: let the round run and put the review off, as the gate does for a failure inside the round.
**Challenged:** The same edge behaves differently depending on which side of the round it sits: inside, a failed blocker puts the review off and the round goes on; outside, the whole round is refused. The human might prefer the round to run and the review to wait, or the review to run over whatever earlier rounds landed.

## 5. A blocker that exists nowhere is also refused at dispatch
**Decision:** A named ticket whose blocker does not exist on the feature at all is listed in the same dispatch refusal, as a blocker that does not exist. An unscoped burn is unchanged, and the scheduler's runtime failure "blocked by missing ticket N" stays as the backstop for a graph that is malformed; it never appears for a blocker that merely sits outside the round.
**Why:** The same reasoning as decision 3: dispatch already loads every ticket on the feature, so the fault is known before anything starts. The runtime message stays true for the case it was written for.

## 6. The lead is told that edges across rounds work
**Decision:** The lead skill and the `dispatch_round` tool description say that a blocker landed or cancelled in an earlier round counts as satisfied, and list the new refusal for a blocker outside the round that is not finished.
**Why:** Leads learned the workaround (cancel the dependents and re-emit them with only same-round edges). Without a word in their instructions they keep churning tickets, and a lead that meets the new refusal should already know what it means.
**Assumed.** Alternative: change behaviour only and leave the lead's docs as they are.

## 7. One lap
**Decision:** The whole fix is specced and built in lap 1; there are no later laps.
**Why:** It is a small, well-traced bug fix with two concrete repros, and nothing in it is uncertain enough to need a walking skeleton.
