# Outcome — Reassign a ticket's agent mid-burn

Let the human change which agent/model a ticket burns on after a run has started — model menu on run lanes, launch-time model resolution instead of the run-start snapshot, and retry that honours the new assignment — so an exhausted Codex quota doesn't strand a run.

- Shipped: 2026-09-11
- Laps run: 1

## What shipped

8 commits · 9 files

### Lap 1
- 2 tickets landed: #1 Scheduler resolves a ticket's row at launch, not from the run-start snapshot; #2 Run lanes get the model menu, and failed lanes retry on a chosen model in one gesture
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 1efe1f21ef24cf4ab49edd8671cd55173f6da3cf
- Landed since: 0
- Outcome: done

- **Automated gate results were not available in this Gates review** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Scheduler resolves a ticket's row at launch, not from the run-start snapshot

# ticket 1 — the scheduler resolves a ticket's row at launch

## What was done

`burnTickets`'s `runOne` (packages/server/src/workflows/ticket-burner.ts) now re-reads the
live ticket row through the existing `ctx.listTickets` seam at the moment a lane starts, and
launches that row instead of the run-start snapshot copy. A small helper, `refreshedForLaunch`,
looks the row up by ticket id, writes it into the `bySeq` entry and returns it — so the launched
payload, the per-ticket auth precheck (`gateTicketAuth` → `ticketAuthMissing` → `ticketCredentials`),
the `ctx.updateTicket` calls and digest harvesting all read one and the same row, and precheck and
executor cannot disagree about the assignment. When the ctx has no `listTickets` (test fakes) or the
row has vanished, the snapshot row is used exactly as before. Scheduler bookkeeping is untouched:
`status`, `pending` and the blockedBy graph stay on the snapshot. No change outside `runOne`, as the
ticket asked, so the diff stays narrow against the in-flight failure-aware-scheduling branch.

Five tests were added to packages/server/test/ticket-burner.test.ts under a new describe: a mid-run
model reassignment reaching a still-queued lane's executor; a mid-run body edit (goal/context/
criteria) reaching it too; the auth precheck judging the reassigned runtime (and refusing it, so the
lane never reaches the executor); a ctx without `listTickets` launching the snapshot row; and an edit
to an already-launched lane leaving it on the model it started with.

## Surprises

- The whole-row replacement is safe for the dependency graph for a reason worth writing down:
  `ticket.edit` only accepts title/goal/context/acceptanceCriteria/seams/model — `blockedBy`, `kind`
  and `seq` are not editable at all, so a refreshed row can never move the graph under the scheduler.
- The test fake had to be built carefully: `makeCtx`'s `updateTicket` mutates the ticket objects in
  place, so a fake store that shares object identity with the snapshot makes a mid-run edit look like
  it reached an already-burning lane. The store fake therefore *replaces* a row on edit (`store[i] =
  {...row, ...patch}`), the way a real store hands back a fresh object per read.
- The verify baseline in the prompt is stale: the suite is 247 files / 3620 tests here, not 118/1768.
  Two files fail and neither is mine — `dev-pane.test.ts` (1 test, the known sandbox process-tree
  failure) and `sandcastle-exec-failure.test.ts` (all 9: `formatExecFailureMessage is not a function`,
  i.e. the ADR-0011 sandcastle patch is not applied to this sandbox's node_modules). `bun run typecheck`
  is clean (0 errors).
- Drive machinery: this change adds no service, no required env var, no seed and no extra process, so
  nothing under `.runcastle/` needed editing. I checked the triggers only; I did not run drive-setup
  or the app (no services in the sandbox).

## Left undone

- The UI half of this feature (the run-lane `ModelMenu` on pending/failed lanes, and the one-gesture
  "retry on <model>") belongs to the other tickets — untouched here.
- `WorkflowCtx.listTickets`'s doc comment in packages/core/src/workflow.ts still describes the seam as
  existing only for mid-run ticket minting; it now has a second caller. Left alone to keep this diff to
  `runOne`, but a one-line comment update there would be honest.
- `refreshedForLaunch` calls `ctx.listTickets()` once per lane launch (a full feature-ticket read). Fine
  at current ticket counts; if a run ever carries hundreds of tickets, a by-id read would be cheaper.

#### 2. Run lanes get the model menu, and failed lanes retry on a chosen model in one gesture

# Ticket 2 — run lanes get the model menu, and retry-on-a-model

## What was done

`Lane` (apps/web/src/components/run/Lane.tsx) now takes `roster`, `onModel` and
`onRetryWithModel`, and `LaneRow` carries the ticket's assigned `model`. A lane
whose status is `pending` or `failed` — the server's own `assertMutable` set, so
a stopped lane is covered — renders the tickets-phase `ModelMenu` in its control
row; burning, done and waived lanes never do, and neither does a read-only
record. The control row now also opens for a pending lane, which previously had
no controls at all, and got `items-center` because the 28px menu sits beside
32px buttons. Where a retry is offered, a second `ModelMenu` labelled "Retry on…"
sits next to it — only when `RunBody` supplies `onRetryWithModel`.

`RunBody` adds a `ticket.edit` mutation on the same `onMutated` invalidation as
the rest, passes the roster down, and composes the one gesture: `edit` then, on
success, `retry`. The retry toasts were lifted out of the inline `onRetry` into
a `retryTicket(ticket)` helper so the plain retry and the composed one say the
same things. `onRetryWithModel` is withheld while a run is live (ADR-0006
refuses `ticket.retry` there), and a run whose status has not loaded yet counts
as live — offering a refused retry would land the reassignment and nothing else.

Tests: tier 1 in `apps/web/test/run-lanes.test.ts` (which lanes carry which
menu, readonly, no-roster) and a new tier-2 `apps/web/test/run-body-model.test.tsx`
that stubs tRPC and asserts a pending lane's choice reaches `ticket.edit`
mid-run, that "default" sends `model: ''`, that retry-on-a-model issues
edit-then-retry in that order with the existing toast, and that a live run's
failed lane keeps exactly today's retry.

## Surprises

- `Lane` had no notion of the ticket's assigned model at all — it only received
  the derived `TicketModelChip` for the header — so `LaneRow` needed the raw
  `model` field before the menu could show its current value.
- `Lane` now imports `ModelMenu` from `components/bodies/tickets/`, which is a
  cross-surface import (run → tickets). The ticket asked for reuse in place, so
  the component was not moved; if a later feature wants it shared, `src/ui/` is
  where STYLE.md would put it.
- `bun run test` has one failure on this branch that is not mine and not in the
  prompt's baseline: `packages/server/test/dev-pane.test.ts` > "kills the child
  process tree so the port-holder is not orphaned" — a process-group kill that
  the sandbox does not reap. Confirmed failing on a single targeted run of that
  one file; my diff is apps/web only. The rest is green (3622 passed), and
  `bun run typecheck` is 0 errors. The prompt's baseline counts (118 files /
  1768 tests) no longer match this branch, which now has 248 files / 3627 tests.
- Drive machinery needed no change (no new service, env var, seed or process); I
  only checked that `.runcastle/drive-setup.ts` and `.runcastle/drive-stop.ts`
  are present — nothing was run, since the sandbox has no app or services.

## Left undone

- A failed lane with no run live now shows two comboboxes ("Ticket model" and
  "Retry on…"). That is what the two acceptance criteria ask for separately; if
  it reads as clutter in the real app, merging them into one split control is a
  design call, not a bug fix.
- The launch-time row refresh in `burnTickets` is ticket 1's work; nothing here
  touches `packages/server`. Without it, a mid-run reassignment of a queued
  ticket persists but the current run still launches the snapshot's model.
