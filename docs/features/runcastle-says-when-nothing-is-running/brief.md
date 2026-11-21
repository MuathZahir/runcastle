## Purpose

In a 36-hour autopilot run, the expensive failures were all silent. Work sat dead for 7.7 hours behind a worker that showed "working", and 6 of the human's 10 typed messages were "is it stuck?" nudges. Nothing ever said "all work has stopped".

What the human gets: one alert, sent to them and not to an agent, when features are open, nothing is running or queued, and nothing is waiting on them. It says why when runcastle knows: held for a usage limit until a time, a worker stalled, waiting on a merge. Where: runcastle's "needs you" surface and the phone notification it already sends. Who: every runcastle user.

This is decision 12 of `docs/adr/0023-a-lighter-feature-loop-without-sandboxes.md`: runcastle states facts itself, and a status comes from what is actually running.

## Must not swallow

- The larger watchdog the audit proposed (item 2.1 of `/home/muath/runcastle-audit-fixes.md`): per-feature quiet timers, escalation from the orchestrator to the human, notices to agents. The human agreed to one alert only.
- The stalled-worker status itself (the feature this waits on) and the visible queue (its own feature).
- Waking or restarting anything. This feature only tells the human.

## Decided with the human

- The human agreed the rule "Runcastle states facts itself, not through an agent. A status comes from what is actually running. One alert goes to you, not to an agent: 'features are open, nothing is running, and nothing is waiting on you'" with "Agreed", and the cut with "Alright, you can start".
- Planning mode was the orchestrator's pick (plan automatically).

## Understood

- A feature the human simply has not come back to is "waiting on you" and must not raise the alert.
- The alert should fire once per stop, not repeat every few minutes.

## Open

- How long "nothing is running" must last before the alert, so a normal gap between two turns does not raise it.
- Whether a draft that cannot start counts as an open feature.

## Ordering

Waits on "A worker never shows working with nothing running", which makes statuses true; this alert depends on them. Nothing waits on it.

Planning mode: automatic

## Added by the orchestrator, 2026-11-21

The human, 2026-11-21: "I also want you to tell all features to prioritize implementing on their own. Maybe use subagents. But prefer not to use workers since we keep running out of memory and disk... We need to finish these fixes as fast as possible". So the lead builds this itself in the feature's folder, with its own subagents for parallel parts, and starts no workers, not even a Review worker. It reviews with its own subagents, fixes what they find, runs typecheck and the affected tests, then declares ready.

To save time the orchestrator started this one beside "A worker never shows working with nothing running" instead of after it. The alert only reads statuses, so it can be built now: treat a worker with no running process as not running, and add "a worker stalled" as a reason once that feature's "Stalled" status lands on main (merge main in before declaring ready).
