## Purpose

In a 36-hour autopilot run on another project (18–20 Nov 2026, runcastle 1.7.4), a worker's process was stopped by the idle timer thirty minutes after a missed usage limit. The handler for a stopped worker left its status alone, and a worker whose turn ends without a handback keeps its status by design. The worker showed "working" for 9.3 hours, its lead waited 587 minutes, and nothing told anyone. This is item 1.2 of the audit at `/home/muath/runcastle-audit-fixes.md`, with the related status points in items 2.2 (read them; the line references are for 1.7.4 and were read by auditors, so confirm each in today's source first).

What the human gets: a worker's status is true. "Working" means a turn is in progress. A worker that stopped without handing back is nudged once by runcastle; if it stops again without a handback, it shows as stalled and its lead is told, so the feature either moves or visibly needs someone. Where: runcastle's server, seen on worker cards and in the feature's status. Who: every runcastle user.

Accept when: a test ends a worker's turn without a handback twice; the worker is "stalled", its lead has a notice, and no worker can be "working" with no process behind it. A worker started with no assignment must not take a status that looks like work.

## Must not swallow

- Container behaviour: clean container stops, telling "stopped by runcastle" from a crash or a memory kill, reading container exit codes. Sandboxes are being removed in a later redesign, so do not build on them here.
- Usage-limit detection and its wake (the feature this one waits on).
- A general "nothing is running" watchdog, or showing queue position; offer those as backlog if they come up.

## Decided with the human

- The human approved the bug list, this one described as "A stopped worker keeps showing 'working'", and said: "Alright, you can create the features and start them."
- Earlier in the same chat the human agreed the direction that status should come from facts, as part of a plan they called good; the detailed flow is still to be grilled.
- Planning mode was the orchestrator's pick (plan automatically), not the human's words.

## Understood

- A new "stalled" status is something the human will see, so its wording and where it shows are theirs to confirm in the plan.
- The audit says to tell "its lead and the orchestrator". The project's rule is that such events go only to the agent that owns the work, which is the lead; the lead decides whether its epic needs to know.

## Open

- Whether the nudge should count against the "after two failed tries, step back" rule.
- What a human-entered worker, sitting idle because the human stopped typing, should show. It must not be marked stalled.

## Ordering

Waits on "A usage limit never strands work", because both change the same turn-end handling for workers. Nothing waits on it.

Planning mode: automatic

## Added scope (from the epic, 2026-11-21)

A server restart leaves queued workers dead: their rows stay "queued" with no process and never start (seen at 08:36 UTC, 5 workers stuck). At boot, resume them or mark them stopped so their lead is told. The lead picked resume (decisions.md, 9).
