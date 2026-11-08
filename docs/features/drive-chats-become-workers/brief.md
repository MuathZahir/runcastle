## Purpose

The last piece of the worker model (ADR-0019 point 4: workers replace burn tickets, review tickets, conflict resolvers, drive-fix chats and side chats). `interactive-workers` made side chats workers and moved build work onto workers; `burns-become-workers` moves the review and conflict resolution and deletes the old burn engine. What remains are the two chats docked beside a running test drive: the "Fix drive" chat (fixes the drive's own setup) and the scenario chat ("New scenario" / "Fix it"). Today both are host chats tied to the drive, with their own kind (`scenario`, `drive-fix`), their own write rules and their own launch paths.

Split out of `burns-become-workers` on 2026-11-08. The human: "I don't care, do what you think is best here. But I want these things to be done anyway." They want everything from this effort finished so runcastle is ready to publish.

## Understood

- Workers run in a sandbox (the human's checkpoint-1 decision, `interactive-workers`). These two chats are the awkward case: they work against the human's real checkout and the drive's database, not a feature branch in isolation. Whether they become sandboxed workers, workers that run on the host, or keep their host placement while joining the worker list, labels, handback and statuses, is this feature's central design question.
- Agents talk by tool call; machine events go only to the agent that owns the work (ADR-0019 point 6, `agents-are-woken-only-when-it-matters`).

## Must not swallow

- The safety nets, the review and conflict workers, and deleting the burn engine → `burns-become-workers`.
- The test drive itself (starting, stopping, the drive slot — ADR-0014).

## Open

- Sandbox vs host for these two, given they need the real checkout and the drive's database.
- Whether a scenario written in the scenario chat lands on the feature branch the way a worker's commits do.

## Ordering

Waits on `burns-become-workers` (it changes the worker runner this builds on). Up next: starts by itself when that merges.

## Working agreement: autonomous (2026-11-08)

The human delegated these decisions: "do how you see fit". Planning mode: plans itself. The orchestrator gives the yes, lists every decision that changes how runcastle behaves for the human plainly in its report, and merges when it is right.
