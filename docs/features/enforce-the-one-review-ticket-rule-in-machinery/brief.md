## Why this feature exists

Observed on the production install (JanaLearn_Updated, feature `enter-a-course-while-it-is-still-generating`): the tickets session wrote a review-shaped ticket — #3 "Review: drive the mid-generation course experience end to end", goal and every acceptance criterion a browser observation — but omitted the `kind` field, which defaults to `implementation`. The dispatcher therefore correctly containerized it, and the agent reported BLOCKED: the burn sandbox by design has no docker, no postgres/redis, no browser, no gitignored .env, no drive machinery. The review burned a container, could not touch the app, and the feature landed in review with no agent notes.

This is intermittent LLM omission, not a systematically broken prompt: the sibling in-flight feature `lesson-coherence-and-practicality` on the same install got its review ticket correctly `kind: review`, as did older shipped features ("Review the integrated change"). The tickets skill is already as emphatic as prose can be — `packages/skills/packs/runcastle/skills/tickets/SKILL.md:43`: "Every batch closes with one, unconditionally… no exceptions", restated at lines 41, 67 and self-check item 6 (line 89) — and it still got dropped. A rule that materially matters and lives only in prose is exactly the seatbelt case charter decision 8 covers: enforce in machinery, override with reason.

The cost of the failure is high and silent: a wasted container, a review that never ran, and — per improve-workflow decision 7 — a review phase that silently degrades back to "manual review from zero" with nothing loud telling the human why.

## Where the gap is

- `toolEmitTickets` (`packages/server/src/mcp/server.ts:515`) and `storeTickets` (`packages/server/src/services/tickets.ts`) validate nothing about review tickets — no check that the batch closes with one, no check on a review ticket's `blockedBy`, no heuristic for a "Review:"-titled ticket missing the kind.
- The burn gate (G3) does not check that the current lap's ticket set contains a `kind: review` ticket before dispatch.
- Context that binds the design: review execution semantics are settled in `docs/features/improve-workflow/decisions.md` (decisions 3, 4: review-kind tickets run HOST-SIDE via drive machinery precisely because the sandbox has no app/db/browser; decision 9: review blockers count as satisfied when terminal, not only done). This feature does not touch any of that — it only guarantees the kind is present so those decisions actually engage.

## Candidate enforcement points (for the grill to settle — my leaning is the first two together)

1. **Validate at `emit_tickets`**: refuse (GateError with instructive message, matching the skill's own wording) or loudly warn when a batch contains no `kind: review` ticket. Care needed: sessions sometimes emit in multiple calls to dodge the ~10KB payload timeout (known behavior — short contexts first, `update_ticket` after), so "batch" may not mean "one call". Options: only enforce when the feature/lap has no review ticket yet at phase-completion time rather than per call, or validate at `complete_phase` for the tickets phase.
2. **Burn-gate check**: before dispatch, the current lap's tickets must include a review-kind ticket; block with the standard override-with-reason. This is tolerant of multi-call emission and catches every path into a burn.
3. **Cheap heuristic repair/refusal**: a ticket titled `Review:`/`Review ` without `kind: review` is almost certainly the omission — refuse it with instructions (prefer refusal over silent coercion, so the session stays the author of its tickets).

## What it must NOT swallow

- No redesign of review modes (Drive vs Gates), the review prompt, or host-side review execution — improve-workflow owns those decisions.
- No dispatcher changes in `ticket-burner.ts` beyond what a gate check requires — the dispatcher behaved correctly here.
- No changes to the tickets skill's slicing rules; at most a line acknowledging the machinery check exists.
- No retroactive repair of existing mis-kinded tickets in user DBs — humans re-emit or edit those in the UI.

## Verification worth pinning

Regression tests in packages/server/test: (a) an emit/complete path that would leave a lap with no review-kind ticket is refused or blocked at the chosen enforcement point(s); (b) the legitimate multi-call emission pattern still works; (c) the override path records its reason; (d) a "Review:"-titled implementation-kind ticket triggers the heuristic refusal if option 3 is adopted.
