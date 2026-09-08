# Decisions — enforce-the-one-review-ticket-rule-in-machinery

## 1. One lap, whole spec, no map
**Decision:** Sure-and-small: spec the entire feature in one lap. No waypoint map, no deferred `## Later laps` scope.
**Why:** The brief already narrows enforcement to two or three candidate points; the surface is one gate case, one MCP tool function, and tests. The open questions are design decisions settleable in this session, not material needing research or a walking skeleton.

## 2. G3 (`tickets-approved`) is the single lap-level enforcement point
**Decision:** Strengthen the `tickets-approved` case in `checkGate` (packages/server/src/services/gates.ts): the current lap's non-cancelled tickets must include at least one `kind: review` ticket, with an instructive `reason` when they don't. No batch-shape validation in `emit_tickets`, nothing in `storeTickets`.
**Why:** That one `checkGate` case already backs both `complete_phase({ phase: "tickets" })` and the runner's pre-dispatch guard, so it covers every path into a burn. Judging the lap's accumulated state (not a single call) tolerates the legitimate multi-call emission pattern, and the standard override-with-reason seatbelt comes free. A check inside `storeTickets` would break the internal fix-ticket and verification mints, which legitimately store review-less batches.

## 3. Heuristic refusal at `toolEmitTickets`: "Review"-titled ticket without `kind: review`
**Decision:** At the MCP surface (`toolEmitTickets`), refuse the whole batch with a `GateError` when any ticket's title starts with `Review:` or `Review ` (case-insensitive) but its `kind` isn't `review`. The message states both outs: set `kind: "review"`, or retitle if it genuinely is an implementation ticket. Refusal, never silent coercion.
**Why:** G3 fires at gate time, often after the tickets session has ended; this catches the exact incident shape at authoring time, when the emitter can fix and re-emit. Living at the tool surface only, the internal fix/verification mints bypass it. Refusal keeps the session the author of its tickets, and the retitle escape hatch covers the rare false positive.

## 4. Gate predicate: at least one non-cancelled review ticket in the current lap; no ordering check
**Decision:** G3 requires ≥1 non-cancelled `kind: review` ticket stamped with the current lap. Not "exactly one", and no `blockedBy`/ordering enforcement.
**Why:** The burner's verification pass legitimately mints a second review ticket mid-run, so "exactly one" would refuse states the machinery itself creates — that stays a prose authoring rule. Cancelled review tickets don't count because a cancelled review is exactly the silent-degradation state being guarded against. Ordering is a different, rarer failure the dispatcher already handles via `blockedBy`; the brief's non-goals say keep the seatbelt narrow.

## 5. Instructive refusal copy; one acknowledging line in the skill
**Decision:** The G3 `reason` echoes the skill's vocabulary and names the fix in the refusal itself (emit the review ticket / fix the `kind` on a review-shaped one / override with a reason), in the style of the existing `gates.ts` reasons. The tickets skill gets exactly one added line acknowledging the machinery check exists; no other skill changes.
**Why:** The refusal is often read by a human at the gate or a session mid-`complete_phase` — the fix must be derivable from the message alone. The skill line prevents a session that hits the refusal from treating the seatbelt as a bug, and stays inside the brief's "at most a line" non-goal boundary.

## 6. Pinned verification: five regression tests in packages/server/test
**Decision:** (a) a lap with no review-kind ticket is refused at G3 via both `complete_phase` and the gate check the runner uses; (b) multi-call emission still passes — a review ticket arriving in a later `emit_tickets` call satisfies the gate; (c) the override path records its reason and advances; (d) a "Review:"-titled implementation-kind ticket is refused at `toolEmitTickets` with the two-out message; (e) the internal mints (`buildFixTicket` storage, the burner's verification mint) still store review-less batches untouched.
**Why:** (a)–(d) are the brief's pinned verification, all applicable under the locked design; (e) pins decision 2's load-bearing constraint that the seatbelt lives at the tool surface, not `storeTickets`.
