# Burns become workers

## Problem

Runcastle still has two ways to delegate work. Build work runs as workers since
`interactive-workers`: the human can step into one, its chat is kept, and it hands back to the
lead. But the end-of-feature review still runs on the old burn engine: a headless run inside a
round, its conversation thrown away, nothing to step into. Tickets, rounds, runs, their tools,
their views and their settings all stay alive for that one review.

Meanwhile workers lack the safety nets the burn engine earned. A worker stopped by a rate limit
just goes quiet. A hung turn shows "working" forever and holds a slot. A server restart leaves a
worker marked "working" with nothing running. A landing conflict always lands on the lead's desk.
Each worker reinstalls its dependencies from scratch and does not build a missing image. Nothing
counts a worker's tokens. The working rules that made burns cheaper (`cheaper-burns`) never
reached the worker briefing.

## Approach

### What the human sees

**One kind of delegated work.** The review is a worker labelled **Review** in the feature's
worker list, enterable like any worker, its chat kept after the feature merges (decisions 3, 12).
There are no rounds, no Work view, no tickets view and no round transcript lanes. A shipped
feature's record of its old tickets is its `outcome.md` (decision 14).

**The review.** The lead starts it when the work is done. Its mode is fixed at start:
- a **drive review** runs on the host in the human's own checkout while it holds the project's one
  drive slot with the feature branch checked out (the review drive, as today). It drives the app
  in the browser, records the walkthrough, replays scenarios, runs the project's checks, and gives
  the drive slot back when it hands back. While the human drives, it waits as queued;
- a **gates review** (nothing to drive) runs as an ordinary sandboxed worker on the committed
  feature branch: the project's checks plus a read of the diff.

It reports findings as it goes and hands back with the **Review Package** card in the lead's chat,
as today (decision 4). The lead resolves findings, fixes the real ones, and then starts a fresh
**verify** review given only those findings and the fix commits. The server no longer runs gates
itself (decision 5).

**Workers recover by themselves.**
- A transient error (rate limit, overloaded, dropped connection, stall) is retried in the same
  conversation after a short backoff, up to three times; then the worker fails and wakes its lead
  once, as today. Errors that will not pass (bad login, no credit, CLI too old, conversation too
  long) fail at once (decision 8).
- A turn with no progress for too long, or a single command past a hard ceiling, is cancelled and
  counted as a transient error (decision 9).
- A worker a restart cut off mid-turn is told "carry on where you were", like leads (decision 10).
- The usage limit follows the human's "Carry on when the usage limit resets" setting, as every
  chat does; there is no worker-only rule (decision 7).

**Landing conflicts.** An "on its own" worker whose land conflicts is sent back by runcastle with
the conflicting files and the other side's commits, to merge the feature branch in and resolve;
the lead is told and lands again on the next handback. After two tries, or for a "with you"
worker at once, the lead is told and chooses: resolve it itself or send the worker back
(decision 6).

**Stop** ends the lead's turn and cancels every working or queued worker's turn. They stay where
they are, enterable, and nothing starts until the human replies (decision 15).

**Settings.** "Agents working at once" stays. The CPU cap per sandbox and the
repeated-test-suite guard's switch stay and govern workers. The attempt, iteration and
conflict-attempt counts, the burn workspace mode and the "sandbox off" switch go. The page that
held them is renamed so "Workers" names only workers (decision 18).

**The upgrade.** Tickets, rounds and runs are dropped. Open findings stay with their feature. A
feature that still had tickets not done gets one note, riding its lead's next message, naming each
dropped ticket and its goal (decision 17).

### The shape of it

**Worker errors and stalls** move into the worker runner. The burn engine's error patterns (run
fatal, retryable, provider specific) move out of the burn into a shared, pure classifier. The
agent host already ends a turn on an error and already handles the usage limit; the worker service
gains a retry step on its turn-ended hook: classify the error, re-prompt the same thread with a
"carry on" line after backoff (5s, 10s, 20s), count attempts per turn on the worker, and fail on
the fourth or on a fatal class. The stall watchdog watches a worker's turn for agent output and
open tool calls; silence past the idle bound with no command running, or one command past the
ceiling, cancels the turn with a stall error that the same retry step takes. The restart reconcile
that wakes leads also wakes workers whose turn it cut off.

**Worker sandboxes** are set up like burns were: the project image is built when missing or stale
(`ensureBurnImage`), the per-project dependency cache seeds the worker's clone with installed
dependencies (copied at setup, never held for the worker's life), the project's setup command runs,
the CPU cap applies, and, for Claude Code workers with the guard on, runcastle's repeated-test-suite
guard is installed as a hook inside the sandbox (the human's own hooks stay out). The briefing
gains the burn prompt's working rules. Before a sandbox is removed, the agent's own conversation
file is copied out beside the worker's thread log; the worker's token use is read from it (the same
reader the burn used) and recorded on the worker row, and the outcome lists workers with tokens.

**The review worker** is a worker with kind `review` and a mode (`drive`, `gates`, or `verify`
on either surface). A drive review has no sandbox: it is an agent thread on the host whose working
directory is the project's checkout, started only once the review drive holds the drive slot; its
runcastle tools come over the normal MCP route (it is on the host) and include `review_drive`,
`report_finding` and `hand_back`. A gates review runs in an ordinary worker sandbox, and the
worker's relayed tools gain `report_finding` for review workers. The review prompt is the existing
review template, with the server-run gate block replaced by the project's verify commands and known
failures for the reviewer to run itself. On handback, the Review Package is built from the
worker's findings, shots and walkthrough and posted as today. Findings are keyed to the review
worker instead of a review ticket.

**The lead's tools.** `start_worker` gains the review kind (or a `start_review` sibling, settled when
built). `emit_tickets`, `update_ticket`, `cancel_ticket`, `list_tickets`, `get_ticket`,
`dispatch_round`, `stop_round` and the round fields of `get_feature_context` are removed;
`resolve_finding`, `report_finding`, `review_drive`, `show_review_package` and `declare_ready` stay.
`declare_ready` keeps refusing while a worker, the review included, is working or holds unlanded
work.

**Deleted.** The sandcastle dependency and its patch, the ticket burner, review ticket runner,
review gates, gate reuse, kill registry, run reconcile, interrupted-command notes, the round and
run services, the tickets service, the ticket and run routers, their web views and libs, the
burner prompt templates, the lead skill's tickets and rounds guides, and the orchestrator's and
self-planning run's ticket paths. ADRs 0002, 0003, 0006, 0007 and 0011 are marked superseded by a
new ADR recording this move; 0004, 0005, 0008 and 0018 are amended to say they now govern worker
sandboxes.

## Seams

- **The worker service with the fake sandbox engine and fake ACP agent** (existing,
  `workers-life` / `workers` tests). Observe: a transient error re-prompts the same thread and the
  attempt count; a fatal error and the fourth transient fail the worker and wake the lead once; a
  stall cancels and retries; a conflicting land sends an "on its own" worker back and tells the
  lead, and goes to the lead after two tries or for "with you"; Stop cancels working and queued
  workers.
- **The error classifier** (new, pure, moved from the burner). A table test of error texts to
  classes.
- **Boot reconcile** (existing). A worker cut off mid-turn gets the carry-on prompt.
- **The sandbox engine's command lines** (existing). The image build at start, the cache seeding,
  the setup command, the CPU flag, the guard hook file, the conversation file copied out before
  removal.
- **The review worker** (new kind on the worker service). Drive review: waits for the drive slot,
  runs on the host checkout, gives the slot back at handback; gates review: sandboxed; its
  handback posts a Review Package with the findings it reported; verify mode gets only the given
  findings.
- **The MCP audience table** (existing). The lead's tools lose the ticket and round tools; review
  workers get `report_finding` (and on the host, `review_drive`).
- **The migration** (existing drizzle migrations). Tickets, rounds and runs dropped; findings
  re-keyed; the in-flight note held for leads of features with unfinished tickets.
- **Web components** (existing). The feature page with no Work or tickets view, the Review worker
  in the worker list, the Review Package card, the renamed settings page.

## Out of scope

- The Fix-drive and scenario chats becoming workers: their own feature, created by the orchestrator,
  starting when this one merges (decision 2).
- A spending cap per worker beyond the CPU cap; bundling pings.
- A sandboxed drive review (a browser inside the image).
- Any change to the wake rule beyond workers joining the restart carry-on.

## Open questions

- Whether the cache seeding copies the warm slot's dependencies into the worker clone, or the
  worker installs against the warm package-manager store; settled by measuring when built, keeping
  whichever starts faster without holding a cache slot for the worker's life.
- The stall bounds (silence and single-command ceiling) are picked when built from the burn
  engine's idle timeout and logged timings.
- This feature is built and reviewed by the installed runcastle, which still has the burn engine;
  the new review worker is checked by hand on a hand-started server of this branch.
