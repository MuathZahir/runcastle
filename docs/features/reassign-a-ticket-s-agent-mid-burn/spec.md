# Reassign a ticket's agent mid-burn

## Problem

When a run is live and a runtime's quota runs out (the real incident: Codex's usage limit mid-burn), the human can see the wreck coming but cannot steer. The model menu exists only on the tickets-phase ledger — once implementation starts they are on run lanes, which offer retry/stop/waive but no model control. Worse, even where the backend accepts a model edit (`ticket.edit` on pending/failed tickets), a live run never sees it: the scheduler works off an in-memory snapshot of the ticket rows taken at run start, and resolves each ticket's model off that snapshot at launch. The only recovery is to wait for the run to die, edit every ticket, and re-burn.

## Approach

Manual reassignment, end to end, with no new server contract:

1. **Run lanes get the model menu.** Pending and failed lanes in the run view render the same `ModelMenu` the tickets-phase `TicketRow` uses — same component, same configured roster, same `ticket.edit` mutation. A "stopped" ticket is stored as failed, so it is covered. Burning, done, and cancelled lanes get no menu: `assertMutable`'s pending/failed set stands untouched (decision 6) — a burning lane is committed to the model it launched with (stop is the human's separate first move, decision 2), and rewriting done/cancelled history would lie about what was burned.

2. **Launch-time model resolution.** When the scheduler starts a lane (`runOne` in `burnTickets`), it re-reads the live ticket row through the existing `ctx.listTickets` seam and launches *that* row instead of the run-start snapshot copy, falling back to the snapshot when the ctx has no store hook (test fakes unchanged). The whole row refreshes — model, body, criteria — while the scheduler's own bookkeeping (status map, `blockedBy` graph) stays on its snapshot. Because the launched ticket object flows through the per-ticket auth precheck (`gateTicketAuth`) → `ticketCredentials` → executor untouched, one refresh point makes the model, the auth token, and the precheck all agree on the new assignment — the existing "precheck and executor cannot disagree" property is preserved for free, and cross-runtime reassignment (codex ↔ claude-code) works because credential re-resolution per ticket already exists downstream. A mid-run edit therefore reaches every not-yet-launched ticket in the same run; launched lanes see nothing (decision 3).

3. **One-gesture "retry on <model>".** When no run is live, a failed lane's retry affordance grows a model choice: the UI composes the two existing calls — `ticket.edit` (model) then `ticket.retry` — as a single click. No new server surface; ordering is safe because the edit lands first and the retry burn resolves the fresh row anyway. ADR-0006's refusal of `ticket.retry` while a run is live stands (decision 4): the scheduler never reconsiders a seq it already moved to failed, and its dependents may have cascade-failed, so in-run reset would mean unwinding cascade state mid-flight.

Per-ticket assignment semantics are unchanged (model-chooser decisions.md #4): the assignment is the run override for that ticket's burn; clearing it falls back to the ordinary `resolveModel` chain.

## Seams

- **`ticket.edit` (tRPC) — existing.** The one mutation door for reassignment; observes that a model change on a pending/failed ticket persists and that other statuses are refused. Unchanged, exercised from a new surface.
- **`ticket.retry` (tRPC) — existing.** Composed after `edit` for the one-gesture retry; observes that a retried ticket burns on its new assignment, and that retry stays refused while a run is live.
- **`burnTickets` / `burnRun` scheduler with a fake `ctx.listTickets` — existing.** The launch-time resolution seam: a test edits a queued ticket's row in the fake store mid-run and observes the lane launch with the fresh model (and the auth precheck judge the fresh runtime); a ctx without `listTickets` observes snapshot behavior, unchanged.
- **`resolveTicketModel` — existing, pure.** Observes which model a given ticket row resolves to; needs no change, only fresh input.
- **Run-lane component (web) — existing, extended.** Observes the menu render on pending/failed lanes only, the roster match with the tickets-phase ledger, and the retry-with-model gesture issuing edit-then-retry.

No new seams.

## Out of scope

- **Error classification of any kind** (decision 5). No fatal-table entries, no classifier-input enrichment. Investigation notes for whoever picks it up: observed quota deaths carry an empty error tail (`codex exited with code 1:` — nothing after the colon), so the limit wording (e.g. `You've hit your session limit · resets 8:50pm (UTC)`, sitting in `burn.text` events) never reaches `classifyTicketRunError`; pattern additions alone cannot work. The in-flight `failure-aware-scheduling-for-review-and-verification-passes` feature has already landed a `run-fatal` verdict with a `/usage limit/i` pattern on its branch — classification belongs there.
- **Automatic runtime fallback** (quota exhausted → silently switch runtime). A policy feature of its own with consent questions; this feature is strictly the manual path.
- **In-run retry** (retry-with-new-model while the run is live) — see Later laps.
- **Reassigning burning/done/cancelled tickets.** Burning lanes are committed; done/cancelled are history.
- **Scheduling changes.** `failure-aware-scheduling` owns review/verification scheduling; this feature's ticket-burner edits are the launch-time row refresh only, kept narrow because both features touch the same file and whichever lands second wears the conflict.

## Open questions

None — all resolved or explicitly deferred.

## Later laps

- **In-run retry via scheduler re-admission.** Lifting ADR-0006's retry-while-live refusal would need the scheduler to re-admit a reset seq and unwind its dependents' cascade state. `admitNewTickets` is a plausible seed, but it fires only when a review settles and does not unwind cascades. Only worth a lap if run lifetimes grow long enough that waiting for run end hurts.
