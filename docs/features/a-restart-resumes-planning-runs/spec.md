# A restart resumes planning runs

## Problem

When the human (or an orchestrator) picks "plan automatically", runcastle runs the feature's chat with nobody present until it has a plan to approve. If the server restarts mid-run, the run stops and is never woken: the feature sits idle, with half-written docs, until someone notices. In a 36-hour autopilot run (runcastle 1.7.4) a planning run was cut off mid-write and waited until the human found it.

The cause, confirmed in today's source: the boot step that wakes chats a restart cut off (the carry-on rule, `carriesOn()` in the launcher's reconcile module) skips any chat whose purpose is a planning run, along with the legacy `headless` flag. The commit that added it (agents-are-woken-only-when-it-matters, decision 24) lists planning runs among the skipped chats but gives no reason, and that decision itself names only side chats and workers. The skip dates from when a planning run was a separate one-shot process; since ADR-0015 it is the feature's own main chat, resumable like any other (decision 1).

A second, smaller fault rides with it: a restart never runs the normal "planning ended" step, so a cut-off run keeps its planning purpose forever. While it does, the chat is still treated as unattended and its questions are declined, even after the human starts talking in it.

## Approach

From the human's side: after a restart, a planning run that was cut off mid-turn shows one runcastle line in the feature's chat ("A restart cut off planning: carrying on"), carries on, and ends as it always does, asking for the human's yes to its plan (or on autopilot, handing the plan to the epic). Nothing else changes: no new screen, no message to the orchestrator (decision 3).

Shape:

- **The carry-on rule** wakes a cut-off feature chat whose purpose is a planning run, under the same conditions as a lead: the feature is neither shipped nor archived. On a test drive's copy it is woken as a lead is, since any chat cut off there began there. The legacy `headless` clause stays (no new row is headless, and an old one-shot run cannot be resumed).
- **The planning wake message** is its own constant beside the existing carry-on message. It says a server restart cut off its planning run, to carry on where it was, and (decision 2) lists the files `git status` shows uncommitted in the run's worktree (the feature's whole checkout, not only its docs folder), using the existing five-then-"…" file list helper. With no uncommitted files the list is left out. Reading git status is best effort: a failure leaves the list out, never the wake. It is sent with source `runcastle`, so the planning purpose stays set, the woken turn is still treated as unattended, and its end runs the existing "planning ended" step (complete when it ended on a wait) exactly as an uninterrupted run would. The display summary reads "A restart cut off planning: carrying on"; the timeline event is the existing restart carry-on event.
- **A cut-off planning run that is not woken** (shipped or archived feature, or a wake that throws) is closed the way a Stop closes one: the existing "planning ended" step runs, which records "planning stopped before the plan was complete" and clears the purpose, so the chat answers normally when the human next types in it. This reuses the step the lifecycle's stopped handler already calls.
- **Leads, orchestrators and workers** are untouched: same rule, same message.

A run cut off after it already called `wait_for_you` (plan shown, closing message not yet written) is woken too, as decision 24 already does for any chat cut off while waiting; it writes its closing message and ends. The cost is one turn.

## Seams

- **Boot reconcile then wake** (existing): the restart carry-on test drives the two boot steps (close cut-off logs, then wake) over seeded session rows and counts the prompts each thread received. The existing case "skips … a self-planning run" flips to expect one planning wake. New cases: the planning message names uncommitted files in a real temporary git worktree; a planning run in a shipped feature is not woken and its purpose is cleared with an incomplete "planning ended" event; a woken run's turn end still emits "planning ended" (complete when a wait stands).
- **The human's check (accept test):** on a hand-started server from this branch (drives of runcastle start from the installed version), start "plan automatically" on a feature, kill the server mid-run, start it again, and see the feature's chat show the restart line and go on to its plan.

## Out of scope

- Usage-limit wakes, stalled workers and process cleanup: each has its own feature.
- Any change to what a planning run does or asks.
- Telling the orchestrator about cut-off runs (decision 3).
- Naming uncommitted files in a lead's or worker's carry-on message.

## Open questions

None beyond the decisions marked assumed.
