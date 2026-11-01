# Outcome — Threads open fast and show the truth

Long and working threads open quickly on their current state, and a thread running background commands says it's working, not waiting on you.

- Shipped: 2026-11-01

## What shipped

7 commits · 32 files

- 0 tickets landed
- 0 waived
- 0 failed

## Review record

### Ticket 1 · review

- Reviewed commit: 7700357ae88071070ecf8840359c4b0703df6e87
- Landed since: 0
- Outcome: done

### Ticket 2 · verification

- Reviewed commit: 0927d7d76a455e04ab30a1dae1a24f9ec2ee04b6
- Landed since: 0
- Outcome: done

- **An open thread loses all its earlier history once its held log is 5 minutes old** — fixed
- **Test gate failed on one terminal kill-tree test the branch does not touch** — dismissed

## Notes record

- No human notes

## Per-ticket digests

### 2. Review: drive threads opening and their status in the running app

drive mode · DRIVE FAILED · nothing verified — An open thread drops all earlier history (and duplicates a sent message) once its held log is 5 minutes old, and the test gate failed on one unrelated test.

Drive verification pass — run as Drive over the inherited Gates because this ticket's acceptance criteria name screens and states a human operates (the chat column, the sidebar, the header) and a drive was available.

## What I walked

The drive booted `feature/threads-open-fast-and-show-the-truth` at 0927d7d against runcastle-demo. A real Claude Code agent ran in two places: an Orchestrator chat, and the lead chat of a throwaway feature, "Status probe", that I created and started for this. The recording is `walkthrough.webm` and the screenshots are in `shots/`.

- **Switching threads (held).** I switched between Entry tags and the Orchestrator 4 times with a per-frame logger on. Each return drew the full current thread within about 40 ms of the loading line, never an older copy and never "New thread". The empty "New chat" threads show "New thread" correctly: they have no log on disk. I also switched away from and back to the lead 4 times while it worked through five spaced commands. Each return drew the latest step first (2, 3, 4, 5), never an older one.
- **Reload (held).** Reloading on Entry tags kept the address and drew the full history 1.7 s after navigation.
- **Sending right after opening (held, with one exception).** I typed and sent within about 150 ms of opening Kickoff probe. The message showed once and stayed. That agent could not start because the drive's data folder conflicts with the real worktree holding that branch, a drive setup issue and not this branch. Replies on the Orchestrator and the lead appeared live without a reload. The exception is under "Broken" below: a duplicate after the 5-minute point.
- **Background command, then a question (held).** On the lead, after a "started." reply with `sleep 300` running in the background, the feature row read "Agent working", the header read "Working", the sidebar lane was "Working 1", and the composer was the normal "Message the agent". Asked to end on "Shall I go on with the next step?" with the sleep still running (1m 23s), the row went to "Waiting on you" and the header to "Waiting for you". A plain "done." reply went back to working. When the sleep ended at 5 minutes, both flipped to waiting on their own. The Orchestrator behaved the same way: its card said "Working" with a spinner on its row, then went back to "Plan, cut and ask" after the question.
- **Steady arrival (held).** Six `sleep 4 && echo` steps reached the screen at 9.0, 14.2, 19.6, 25.1 and 30.5 s, one every 5.4 s, not in one jump at the end.

## Broken

- **High: an open thread loses its earlier history once its held log is 5 minutes old.** The browser keeps each thread's log in a TanStack Query cache entry that nothing watches. With the default settings, TanStack deletes that entry 5 minutes after it was first written. The branch's new `take` in `use-thread.ts` builds the next log from that entry alone. Once the entry is gone, the next read replaces the whole thread with only the new events. Main avoided this by starting from the thread's own copy in React state. I saw it twice: once on its own at the 5-minute mark, and once on purpose (page open 330 s, one message sent). The thread was cut down to my last message, and the sent message also showed twice, the copy stuck on "Starting the agent…". A reload restores everything. This breaks "no flash of an older one / shows its current state" and "shows once" for any thread watched for more than 5 minutes, which is the main way a working thread is watched.
- **Low: the test gate is red on one test the branch does not touch.** `pty-bun.test.ts` "kills the whole tree" failed (1 of 5,429). The diff changes nothing in the terminal code. It is likely a sandbox or timing flake, but it needs a rerun.

Typecheck passed. No fix was in scope for this pass, so no fix held or failed.

REVIEW-MODE: drive
REVIEW-VERDICT: unverified
REVIEW-REASON: An open thread drops all earlier history (and duplicates a sent message) once its held log is 5 minutes old, and the test gate failed on one unrelated test.
