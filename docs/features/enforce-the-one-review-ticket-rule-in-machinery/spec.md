# Enforce the one-review-ticket rule in machinery

## Problem

The tickets skill mandates that every batch closes with a `kind: review` ticket, but the rule lives only in prose and is intermittently dropped by the emitting LLM: on a production install a review-shaped ticket was emitted without its `kind` field, defaulted to `implementation`, was correctly containerized by the dispatcher, and reported BLOCKED — the burn sandbox by design has no app, database, or browser. The cost is high and silent: a wasted container, a review that never ran, and a review phase that degraded to "manual review from zero" with nothing loud telling the human why. A rule that materially matters and lives only in prose is the seatbelt case: enforce in machinery, override with reason.

## Approach

From the human's perspective nothing changes on the happy path; when a tickets session forgets the review ticket, the pipeline now refuses loudly at two moments instead of burning a container silently.

Two guards, no new modules:

1. **Lap-level gate (primary).** The `tickets-approved` case of `checkGate` — the single check already evaluated by `complete_phase({ phase: "tickets" })`, the runner's pre-dispatch guard, and the launcher — additionally requires **at least one non-cancelled `kind: review` ticket stamped with the current lap**. Not "exactly one" (the burner's verification pass legitimately mints a second review ticket mid-run), and no `blockedBy`/ordering enforcement. Because it judges the lap's accumulated ticket state rather than any single call, the legitimate multi-call emission pattern is unaffected. The refusal `reason` echoes the skill's vocabulary and names the fix in the message itself: emit the review ticket, or fix the `kind` on a review-shaped one, or override the gate with a reason. The existing override-with-reason machinery is the escape hatch, unchanged.

2. **Authoring-time heuristic (secondary).** At the MCP tool surface only (`emit_tickets`'s tool handler, not the `storeTickets` service), a batch containing a ticket whose title starts with `Review:` or `Review ` (case-insensitive) but whose `kind` is not `review` is refused whole with a `GateError` stating both outs: set `kind: "review"` (almost certainly the intent), or retitle if it genuinely is an implementation ticket. Refusal, never silent coercion — the session stays the author of its tickets and can fix and re-emit within the same session, before the gate is ever reached.

The placement constraint is load-bearing: `storeTickets` has legitimate internal callers that store review-less batches — the per-finding fix-ticket mint and the burner's mid-run verification mint — so neither guard may live in the service layer. The quick-change door already satisfies the gate by construction (it authors its own review ticket in code).

The tickets skill gets exactly one added line acknowledging that the machinery check exists, so a session that hits the refusal reads it as the seatbelt, not a bug. No other skill changes.

## Seams

- **`checkGate(ctx, 'tickets-approved', feature)`** (existing) — the gate service's public check function. Observes the refusal for a review-less lap, the instructive reason text, satisfaction once a review ticket exists (including one arriving in a later emit call), and that cancelled review tickets do not satisfy it. Exercising it via `complete_phase` covers the same predicate on the MCP path.
- **The `emit_tickets` MCP tool handler** (existing) — observes the heuristic refusal for a "Review"-titled non-review ticket, the two-out error message, and acceptance of correctly kinded batches.
- **`overrideGate`** (existing) — observes that the override path records its reason and advances past the strengthened gate.
- **`storeTickets` service** (existing) — observes that internal review-less batches (fix-ticket mint, verification mint) still store untouched, pinning the tool-surface-only placement.

No new seams.

## Out of scope

- Review modes (Drive vs Gates), the review prompt, and host-side review execution — improve-workflow owns those decisions; this feature only guarantees the `kind` is present so they engage.
- Dispatcher changes beyond what the gate check requires — the dispatcher behaved correctly in the incident.
- Changes to the tickets skill's slicing rules (beyond the single acknowledging line).
- Retroactive repair of existing mis-kinded tickets in user DBs — humans re-emit or edit those in the UI.
- Enforcing "exactly one" review ticket or its `blockedBy` ordering — prose authoring rules, not machinery.

## Open questions

None — all decisions locked in decisions.md.
