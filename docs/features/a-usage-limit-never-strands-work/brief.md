## Purpose

In a 36-hour autopilot run on another project (18–20 Nov 2026, runcastle 1.7.4), a review worker hit the 5-hour usage limit. The limit text arrived as an ordinary reply and the turn ended normally, not as an error. Runcastle only looks for the limit when a turn ends in error, so it held nothing and set no wake. Work sat dead for 7.7 hours after the limit had reset. This is item 1.1 of the audit at `/home/muath/runcastle-audit-fixes.md` (read it; its line references are for 1.7.4 and were read by auditors, so confirm each in today's source first).

What the human gets: with "carry on when the usage limit resets" switched on, every chat a limit stopped starts again by itself once the limit has really lifted, with no nudge from them. Where: runcastle's server; the human sees it as the notice in each stopped chat. Who: every runcastle user.

Three gaps to close:

1. **A limit that ends the turn normally is missed.** Detect the limit wording in the turn's final reply, and in a sub-agent's failure text, whatever the stop reason, and treat it like the error path.
2. **A wake that fires too early can strand the chat.** The orchestrator read the code on 2026-11-20: the wake fires 60 seconds after the reported reset (`USAGE_RESET_GRACE_MS` in `threads/host.ts`). If the limit still stands and the turn fails as an error, the chat is held again and a new wake is armed, which is fine. But the new wake time comes from the usage report, and the function that picks it (`limitLiftsAt` in `threads/usage.ts`) ignores reset times already in the past. If the report still shows the old reset time, no time is found, the chat says "could not tell when it resets" and waits for the human forever. A wake that finds the limit still standing must try again after a short wait, and keep trying, never give up silently.
3. **The wake is an in-memory timer.** The audit infers a server restart during a limit window loses it. Confirm, and make the wake survive a restart.

The audit also reports held sessions restarting one at a time after a reset, some waiting another 30 to 35 minutes; look at whether all held chats can wake together.

Accept when: a test feeds a turn that ends normally with the limit text and the chat ends up held until the reset, with a wake that survives a restart; and a test where the wake fires while the limit still stands shows the chat tried again later and carried on.

## Must not swallow

- The worker that keeps showing "working" with no process behind it. That is the safety net for this bug and has its own feature, which waits on this one.
- A general "nothing is running" watchdog.
- Changing the human's "carry on" setting or its default.

## Decided with the human

- The human approved the bug list, this one described as "A usage limit is missed when the turn ends normally, so nothing wakes up at the reset", and said: "Alright, you can create the features and start them."
- On the wake time, the human said: "the usage limit resume schedules the start at the exact time that Claude says the usage limit will reset. I think this might fail, sometimes because this reset time changes ... minutes can be added sometimes. So maybe we should add like a 5 minute buffer to make sure that the limit actually reset before starting. Or do you think this will work either way, because once the resume happens and it's still [not reset], it will just wait a little more until [it resets]. Anyway, just look at it."
- Planning mode was the orchestrator's pick (plan automatically), not the human's words.

## Understood

- The human wants the outcome (the resume works even when the reset time moves), and left the method open. The orchestrator's reading is that retrying is what makes it robust, and a longer buffer alone does not; the size of the buffer is the lead's call.

## Open

- What the limit text looks like for Codex, and for a sub-agent failure.
- Whether a false match on the limit wording is possible when an agent merely quotes it, and how to avoid holding a healthy chat.

## Ordering

Nothing must merge before it. "A worker never shows working with nothing running" waits on it, because both change the same turn-end handling.

Planning mode: automatic
