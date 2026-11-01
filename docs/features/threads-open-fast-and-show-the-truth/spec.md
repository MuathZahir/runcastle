# Threads open fast and show the truth

## Problem

The human can't trust what a thread shows at a glance, and opening one is slow.

A feature whose agent has finished a turn and is waiting on its own test run says "Waiting on
you", so the human goes to look and finds nothing to do. Reloading the app on a long thread sits
on "Loading the thread…" for several seconds. A thread that is working shows an old state, then
jumps to the present with a run of new tool calls. So the two things the human uses threads for,
knowing where work stands and reading it, both mislead.

## Approach

### What the human sees

A thread whose agent replied and still has a background command or sub-agent running says
"Agent working" until that work ends, until 10 minutes have passed since the turn ended, or until
the agent has asked something, whichever comes first. Anything the agent asks beats it at once.
The chat does not pretend a turn is running: the composer works as after any turn, and the
command strip keeps its timer.

Opening a thread shows its current state and nothing older, and a working thread on screen stays
within a moment of its log. No screen changes shape, so there is nothing to design.

### What was measured

`scripts/thread-timing.ts` measures all of this in real Chrome against a copy of the real data,
with other threads working. Rendering is cheap, because settled turns draw nothing inside their
folds. The plan's first explanation, that validating log lines costs 270 ms a read, was wrong:
`curl` to `localhost` loses about 200 ms on Windows trying IPv6 first. A real read of the largest
log is about 35 ms. What the browser timings showed instead:

- **Reads cancelled by the next signal.** `resyncThread` in `apps/web/src/lib/live.ts` invalidated
  on every signal, and an invalidation cancels a refetch already in flight. The stream sends a
  thread's signal up to every 120 ms, and a read slower than that never landed until the agent
  paused. `resyncAll` had a guard against exactly this, and its comment described this bug;
  `resyncThread` had none. Reproduced against `@tanstack/query-core` 5.101.2: 24 reads started,
  0 shown, 1 shown after the signals stopped.
- **Each signal read the whole thread.** It invalidated `thread.events`, `thread.view` and
  `thread.list`. `thread.view` is the whole thread folded, and was needed only until the log
  arrived, so the batch these shared was 8.4 MB. That is why a read in the page took longer than
  a signal.
- **The old state painted first.** `useThread` drew the held log, or a cached `thread.view`, at
  once. Ticket 16 of `chat-as-web-components` made a reopened thread read past its held log, so it
  no longer stayed old. It still showed old first, on 4 of 4 reopens in the baseline, and the
  catch-up read then met the cancellation above. Those tickets fixed a different case.
- **The feature list.** A reload waits for it, because the page needs it to know which feature the
  address names, and it took 1.5 seconds. It parsed every ticket of 188 features in full just to
  count them (400 ms), and read and folded the log of every feature ever shipped to ask whether
  its lead waits on the human (1.2 seconds cold). It is also read on every `turn` signal.
- **Reads held up by their batch.** `thread.events` shared a request with `thread.usage`, which
  starts a process, and with the rest of the page's reads. A batch answers when its slowest member
  does.

### The shape of it

**One read per thread at a time (`apps/web`).** `oneAtATime` in `live.ts` is `resyncAll`'s guard,
now also used per thread and for the thread lists: a signal during a read marks it dirty, the read
is never cancelled, and exactly one more follows, so the last change is still read by a fetch that
began after it.

**One read to open a thread (`apps/web`).** `useThread` no longer calls `thread.view`, so an open
makes one log read and a signal causes no second. `thread.view` stays on the server for Export.
Every opening reads past the held log, and the thread is drawn only once that read has answered.
The cached copy of a log is an entry nothing watches, which the query cache drops after five
minutes even with the thread on screen, so a read's answer always joins the log that read was made
against, never the cache alone. The first build missed this and a thread watched for five minutes
lost its history; the review's live drive caught it.
If it fails, the held log shows with an out-of-date line; with nothing held, the thread stays
loading and asks again every 2 seconds, so it never reads as a new thread. The "Loading the
thread…" line fades in after a moment (`--dur-3`), so a read that answers at once shows no flash. ↑ in the composer still recalls
from the held log while the thread catches up.

**A tail reader in the thread log (`packages/server`).** `readThreadEvents` keeps each log's
parsed events and how far into the file it has read, and each read parses only the lines added
since. It advances only past a complete line and starts over if the file shrank or `seedThreadLog`
rewrote it. `foldedLog` in `read.ts` stays, on top of it.

**A feature list that reads less (`packages/server`).** `ticketStatusCounts` counts tickets in one
query for the project. Only an active feature asks about its lead: nothing reads that flag of a
shipped, archived or draft feature.

**Thread reads on their own requests.** `thread.events`, `thread.list`, `thread.usage` and
`thread.models` move out of the shared batch using the existing `UNBATCHED_PATHS` list in
`apps/web/src/trpc.ts`. Ticket 19's rule stands: a thread the address names opens only once the
page's list holds it, and with `thread.list` on its own request that wait is short. Answers on
`/api/trpc` are gzipped, never the `/api/stream` signals.

**One status rule (`packages/core`).** `threadActivity` answers what the thread is doing from its
events, whether its process runs, and the time. It replaces `awaitsHuman`, which meant `asking` or
`replied`:

```ts
function threadActivity(events, running, now): 'asking' | 'turn' | 'background' | 'replied' | 'idle' {
  // asking: an open ask while the process runs
  // turn: a turn is open
  // background: a reply ended the turn, background work is live, the process runs,
  //             less than 10 minutes since that turn ended, and the reply does not
  //             end in a question mark
  // replied: a reply the human has not answered
}
```

Three readers need care:

- `leadState` replaces `leadAwaitsHuman`, and `feature.list` gains `leadInBackground`, which
  `triageOf` reads as Agent working. The header reads the main chat's `ThreadEntry.state`.
- `awaitingInput` stays true after a turn, because it means the turn ended and `needsMe` checks
  it first so that `waitingReason` beats everything. Leaving it true is what makes a
  `wait_for_you` or `declare_ready` win at once. Do not implement this by clearing the bit.
- `ThreadEntry.state` from `listThreads` gains `working` for `background`, except on a lead whose
  feature has a waiting reason. The chat's own `view.state` from `foldThread` does not change,
  which is what keeps the composer honest.

**Background sub-agents.** The `tasks` log event gains a count of live sub-agents beside the
commands, filled from the same `background_tasks_changed` message, whose `local_agent` entries
`isBackgroundCommand` filters out. Monitors and ambient tasks stay out: they are not work the
agent waits on for a reply. The strip stays commands only.

**The flip at 10 minutes.** Nothing is logged at that moment, so no signal would fire. The host
sets a timer when a turn ends with background work or background work changes after a turn, and
publishes a `turn` live signal when it expires. A `tasks` event also pushes `turn`, since work
ending moves what the thread reads as.

**The skill line.** The feature skill tells a lead that hands something to the human while a
command runs to call `wait_for_you`.

### Results

On the largest real thread (4.3 MB) in real Chrome, on this machine, with other threads working.
"After" is the last three runs of `scripts/thread-timing.ts`.

| | Target | Before | After |
|---|---|---|---|
| Switch back to the thread | 300 ms | 514 ms | 87–208 ms |
| Reload on the thread | 2 s | 2.1 s | 1.15–1.3 s |
| Opens that drew an old state first | 0 | 4 of 4 | 0 of 4 |
| Working thread, typical lag | 1 s | 746 ms | 101–113 ms |
| Working thread, worst lag | 1 s | 5.5 s | 150–176 ms |
| Working thread, markers never shown | 0 | 5 | 0 |
| Settled turns lost after six minutes open | 0 | not measured | 0 |
| First open after a server start | 1 s | 4.2 s | **1.13–1.9 s, not met** |

One open of that thread now sends 1.06 MB, where it sent 8.6 MB.

The review's live drive, with a real Claude Code agent, saw the status rule work end to end: a
`sleep 300` left running read Agent working in the row and the header, a question flipped both to
waiting with the command still running, and the command ending flipped them by itself.

The first-open target is missed, and it stands as decision 7 set it. That wait comes once per
server start. Nothing dominates what remains: no single read takes more than about 0.75 s, and
they overlap while the server warms its own code. Getting under 1 second would mean working on
the server's start and the page's project reads, outside threads.

## Seams

- **`foldThread` and `threadActivity` in `@runcastle/core`**: pure functions over a list of events
  and a time. All the status cases are tested here: command running, 10 minutes passed, question
  mark, open ask, process stopped, work finishing without waking the agent.
- **`readThreadEvents` and `listThreads` in `packages/server`**: a read after appends, a torn last
  line and a rewritten file gives what a whole read would.
- **`startLiveSync`**: driven by fake frames. A read slower than the signal rate lands, and the
  last signal gets one read after it.
- **`useThread`**, through `thread-column.test.tsx`: a held log is not drawn before the opening's
  read answers, and is drawn with the out-of-date line if it fails.
- **`needsMe` / `triageOf`**: a feature with background work and no waiting reason is Agent
  working; with a waiting reason it needs the human.
- **The agent host with a fake agent**: the `tasks` event with sub-agents, and the `turn` signal at
  the limit.
- **`scripts/thread-timing.ts`** (new): the numbers decision 7 asks for, before and after, and the
  slow reads of a page load. It is the feature's proof, and it is what caught the wrong first
  explanation.

## Out of scope

- The sidebar's list, its order and thread names, which belong to "The sidebar shows only active
  threads".
- Redesigning the chat or the loading page. No new status lane or label.
- Paging a long thread, or moving diffs out of the log (decision 6). `turn_ended.files` is 2.9 MB
  of the largest 4.5 MB log, the obvious next step if a log ever outgrows this.
- A new indicator for a dropped live stream. The sidebar already shows the stream's state.
- The agent's process being stopped after 30 minutes idle with a background command still running.
  The idle timer looks only at turns, asks and the queue, so a long command is killed with its
  process. It is a real bug beside this feature, not part of it, and it does not touch the status
  rule: a stopped process ends the background state.
- Background work on Codex (decision 5).

## Open questions

- The timings over the SSH tunnel, which can only be checked once the move has happened.
