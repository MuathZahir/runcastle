## Purpose

In a 36-hour autopilot run on another project (18–20 Nov 2026, runcastle 1.7.4), the orchestrator's tools refused every action with "this orchestrator session has ended" while its chat was open and still receiving handbacks. A feature that was ready could not be merged for 98 minutes. It recovered only when the human typed in the chat. The audit found that the handler for the session-end hook marks the session ended whichever process sent the signal, and the per-turn check-in deliberately leaves an ended row ended. The same false "ended" fired eight times on 19 Nov. This is item 1.4 of the audit at `/home/muath/runcastle-audit-fixes.md` (read it; the line references are for 1.7.4 and were read by auditors, so confirm each in today's source first).

What the human gets: an orchestrator chat that is open and taking turns can always act; an autopilot run never stalls on this refusal. Where: runcastle's server, seen in the orchestrator chat. Who: every runcastle user, most of all on autopilot.

The audit's suggested fix: ignore a session-end signal that does not come from the session's current process; treat a chat that is taking a turn as alive and revive its row; and if a refusal is still possible, make its message say how to recover.

Accept when: a test sends a session-end signal from a stale process and the session stays live; and a turn taken on an "ended" session revives it.

## Must not swallow

- The process leak itself (the feature this one waits on).
- Any change to who may merge, start or message features.

## Decided with the human

- The human approved the bug list, this one described as "The orchestrator gets locked out with 'this session has ended'", and said: "Alright, you can create the features and start them."
- Planning mode was the orchestrator's pick (plan automatically), not the human's words.

## Understood

- The audit only infers the cause: a leaked old process exiting after a newer one had started. Once "Stopping a session kills its process" has merged, first check whether the false signal can still happen. The guard against a stale signal is worth having either way, but the size of this feature depends on that check.
- Check whether lead and worker sessions can be marked ended the same way.

## Open

- Why the per-turn check-in was made to leave an ended row ended; there may be a case it protects.

## Ordering

Waits on "Stopping a session kills its process". Nothing waits on it.

Planning mode: automatic
