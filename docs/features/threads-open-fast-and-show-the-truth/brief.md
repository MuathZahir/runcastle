## Purpose

The human can't trust what a thread shows at a glance, and opening one is slow. Two notes from triage on 2026-10-31 say the same thing from two angles: the status can be wrong, and the conversation can be late.

## 1. False "Waiting on you"

The note: "Showing "Waiting on you" when the agent is waiting for a command to finish". Screenshot: C:\Users\user\.runcastle\project-notes\pnote__oUsC5KEpTqx.png

In the screenshot, "Burns work for any Linux user" shows "Waiting on you" while its chat shows "Run the final full typecheck and test suite · running 3m 41s", and the agent has just said it will commit once that's green.

The agent ended its turn with a command running in the background. Runcastle records background commands (`backgroundTasks`, `t.tasks` in `packages/server/src/threads/host.ts`) but doesn't use them when working out status, so the end of a turn reads as waiting on the human.

Wanted: "Agent working" while the agent's background commands run.

**The catch to solve:** a long-lived background command, like a dev server, must not keep a thread on "working" after the agent has really asked the human something. A false "working" hides a question, which is worse than a false "waiting". The human accepted this risk knowing the feature's agent has to handle it.

## 2. Slow threads that show an old state first

The note: "Loading threads takes way too much time and sometimes loads but takes some time to show final state (shows on an old state when it was working even though it already finished)".

The human's own account of when it happens: long threads, and especially threads that are actively working. It sometimes shows the "Loading thread" page for some time, then shows an old state of the conversation, then suddenly snaps to the new state with more tool calls.

Wanted: long or working threads open quickly, and the human is never shown an old state before the current one.

My reading, not confirmed: the page waits on a long history, and a working thread keeps moving while that loads, so an older copy lands first and then jumps to now. Measure before fixing.

Several fixes for stale state landed around 28 October (see `git log` for tickets 16, 19, 25, 33 and 36 of `chat-as-web-components`, for example "a thread opened again reads past its held log at once"). The note came after those, on the installed 1.6.0, so either they missed a case or this is a different cause. Check that first: do not assume the bug is what those tickets already fixed, and do not redo them.

## Must not swallow

- The sidebar's list, its order, or thread names: those are "The sidebar shows only active threads".
- Feature-level status lanes beyond what this false "waiting" needs.
- Redesigning the chat or the loading page.

## Open

- What makes a long thread slow: reading the log, sending it, or rendering it. What "quickly" should mean once it's measured.
- Whether to show the latest part of a long thread first and load the rest on demand.
- How to tell a command the agent is waiting on from a long-lived one it left running, and what shows when the agent has both asked something and left a command running.
- Whether Codex reports background commands at all.

## Ordering

Up next after "The sidebar shows only active threads": it starts by itself when that merges. The order is only so the two don't compete for the machine; this feature needs nothing from that one.

## Working agreement

Agreed with the human for this cut (this feature and "The sidebar shows only active threads"), 2026-10-31:

Checkpoints: the human's only stop in this cut is the sidebar feature's designs. This feature has no human checkpoint: it is carried through to merged by the orchestrator without stopping. Publishing a release needs the human's yes.
