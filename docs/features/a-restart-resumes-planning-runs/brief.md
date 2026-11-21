## Purpose

After a server restart, runcastle wakes the chats it cut off, but the rule that decides which ones (`carriesOn()` in `launcher/reconcile.ts`) skips unattended planning runs. In a 36-hour autopilot run on another project (runcastle 1.7.4), a planning run was cut off mid-write and sat idle until the human noticed. This is item 1.6 of the audit at `/home/muath/runcastle-audit-fixes.md` (read it; confirm the cause in today's source before changing anything).

What the human gets: a "plan automatically" feature whose planning was interrupted by a restart continues by itself and still ends with a plan for them to approve. Where: runcastle's server; the human sees it in the feature's chat. Who: every runcastle user.

The audit suggests the wake message name the run's uncommitted files so it does not start over, and that the orchestrator chat that started the run be told it was cut off and resumed.

Accept when: a restart test with an in-flight planning run shows it resumed.

## Must not swallow

- Usage-limit wakes, stalled workers and process cleanup; each has its own feature.
- Any change to what a planning run does or asks.

## Decided with the human

- The human approved the bug list, this one described as "A server restart does not resume planning runs", and said: "Alright, you can create the features and start them."
- Planning mode was the orchestrator's pick (plan automatically), not the human's words.

## Understood

- Small and self-contained. Find out why planning runs were excluded in the first place before removing the exclusion; there may have been a reason.

## Open

- Whether telling the orchestrator fits the rule that events with no agent behind them go only to the agent that owns the work.

## Ordering

Nothing must merge before it, and nothing waits on it.

Planning mode: automatic
