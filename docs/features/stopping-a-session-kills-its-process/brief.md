## Purpose

A 36-hour autopilot run on another project (18–20 Nov 2026, runcastle 1.7.4) ended with 66 `claude` and 67 `bun` processes holding about 12 GB, swap full, and builds killed for memory. An audit traced it to runcastle's stop: the agent adapter is spawned without its own process group, the kill signals a group that does not exist, the error is swallowed, and nothing dies. Every idle stop, model reopen, edit-a-message fork and stall kill leaks a process. Two `claude` processes held the same resume id at once.

The full finding is item 1.3 of the audit at `/home/muath/runcastle-audit-fixes.md` (read it; its file and line references are for 1.7.4 and were read by auditors, so confirm each in today's source before changing anything).

What the human gets: after a session is stopped for any reason, its adapter and every child process are gone, and memory comes back. Where: runcastle's server, on every platform it runs on (Windows, macOS, Linux). Who: every runcastle user.

The audit's suggested fix: spawn so the process leads its own group (or kill the process tree directly), ask politely, wait a few seconds, then force; confirm it is gone and log if not. The same fault is reported at the build-cancel kill and the Codex rate-limit side process. It also suggests cleaning up orphan agent processes at server start that no live session owns.

Accept when: a test starts a session, stops it, and the adapter and its children no longer exist; a second test resumes a session five times and exactly one process holds its resume id.

## Must not swallow

- The false "this orchestrator session has ended" lock-out. It may be caused by this bug, and a separate feature that waits on this one handles it.
- Anything about worker containers. Sandboxes are being removed in a later redesign, so do not invest in container stop behaviour here.
- The stalled-worker status and the usage-limit wake; each has its own feature.

## Decided with the human

- The human read the list of audit bugs, this one described as "Stopping a session never kills its process, which leaked 12 GB of memory", and said: "Alright, you can create the features and start them."
- Planning mode was the orchestrator's pick (plan automatically), not the human's words.

## Understood

- This is a bug fix with no change to what the human sees, apart from memory no longer leaking.
- The hourly orphan sweep in the audit is a suggestion; whether a start-up sweep alone is enough is the lead's call.

## Open

- Whether the audit's cause holds on Windows, where process groups work differently.
- How to tell a runcastle-owned orphan from the human's own `claude` processes safely. Never kill a process runcastle did not start.

## Ordering

Nothing must merge before it. "The orchestrator is never locked out" waits on it.

Planning mode: automatic
