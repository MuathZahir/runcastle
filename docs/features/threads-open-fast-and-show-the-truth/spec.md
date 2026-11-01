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

Opening a thread shows its current state and nothing older. Switching to the largest thread takes
under 300 ms, a first open after a server start under 1 second, a page reload on it under
2 seconds, and a working thread on screen stays within 1 second of its log. No screen changes
shape, so there is nothing to design.

### What was measured

The measurements in `decisions.md` overturned the brief's reading (a long history that loads
slowly). Rendering is cheap, because settled turns draw nothing inside their folds. The costs are:

- **Validating every line on every read.** A read of the largest log takes about 270 ms and
  plain parsing only 11 ms. The rest is validating each line against the `ThreadEvent` schema,
  even for a read that asks only what came after the last event.
- **Three whole-log reads per signal.** Each `thread` live signal invalidates `thread.events`,
  `thread.view` and `thread.list`, and the `thread.view` read is used only until the log arrives.
  The server does one thing at a time, so these queue.
- **Reads cancelled by the next signal.** `resyncThread` in `apps/web/src/lib/live.ts` invalidates
  on every signal, and an invalidation cancels a refetch already in flight. The stream sends a
  thread's signal up to every 120 ms. A read slower than that never lands until the agent pauses.
  `resyncAll` has a guard against exactly this, and its comment describes this bug; `resyncThread`
  has no such guard. Reproduced against `@tanstack/query-core` 5.101.2 at the app's own timings:
  24 reads started, 0 shown, 1 shown after the signals stopped. At 20 ms a read the same test
  shows all of them, which is why only long threads suffer.
- **The old state painted first.** `useThread` draws the held log, or a cached `thread.view`, at
  once. Ticket 16 of `chat-as-web-components` made a reopened thread read past its held log, so it
  no longer stays old. It still shows old first, and the catch-up read then meets the cancellation
  above. Those tickets fixed a different case, which is why the note came after them.
- **Reads held up by their batch.** `thread.events` shares a request with `thread.usage` and the
  rest of the page's reads, and a batch answers when its slowest member does. The thread also
  waits for the feature list before asking: a reload spends about 1.7 seconds on each of those
  batches, against 0.3 for the thread's own read.

### The shape of it

**A tail reader in the thread log (`packages/server`).** The server keeps each read thread's
parsed events and how far into the file it has read, and each read parses only the lines added
since. It reads from the last byte offset, advances only past a complete line, and starts over if
the file shrank, as `seedThreadLog` may do. `foldedLog` in `read.ts` already keeps one such entry
per thread and is unbounded; this replaces it, so thread lists, the waiting flag and thread reads
share one copy. A cold first read still validates the whole log once, about 270 ms for the
largest. Check that against decision 7's 1-second first open; if it does not fit, validate less
on a cold read.

**One read per thread at a time (`apps/web`).** `resyncThread` gets the same guard as `resyncAll`:
a signal during a read marks the thread dirty, the read is never cancelled, and exactly one more
read follows, so the last change is still read by a fetch that began after it. `thread.list`
invalidations go through the same guard, since a thread's status is read from them.

**One read to open a thread (`apps/web`).** `useThread` stops calling `thread.view`, so an open
makes one log read and a signal stops causing a second. `thread.view` stays on the server for
Export. `useThread` paints a thread only once a read that started at this opening has answered.
If that read fails it paints the held log, with an out-of-date line.

**Thread reads on their own requests.** `thread.events`, `thread.usage` and `thread.models` move
out of the shared batch using the existing `UNBATCHED_PATHS` list in `apps/web/src/trpc.ts`. The
thread column asks for its log as soon as the address names a thread, and still checks afterwards
that the page's list holds it, so an address carried from another feature does not open a stranger
(ticket 19's rule). Large answers on `/api/trpc` are compressed, never the `/api/stream` signals.

**One status rule (`packages/core`).** A pure function beside `awaitsHuman` answers what the
thread is doing from its events, whether its process runs, and the time:

```ts
// Sketch: names are the builder's. The order is the decision.
function threadActivity(events, running, now): 'asking' | 'replied' | 'background' | 'turn' | 'idle' {
  // asking: an open ask while the process runs
  // turn: a turn is open
  // background: a reply ended the turn, background work is live, the process runs,
  //             less than 10 minutes since that turn ended, and the reply does not
  //             end in a question mark
  // replied: what `awaitsHuman` calls a reply today
}
```

`awaitsHuman` keeps its meaning for every case but `background`, where it now says no. Three
readers need care:

- `leadAwaitsHuman` follows the rule. Its feature gains a sibling flag saying the lead works in
  the background, which `triageOf` and the header status read as Agent working.
- `awaitingInput` stays true after a turn, because it means the turn ended and `needsMe` checks
  it first so that `waitingReason` beats everything. Leaving it true is what makes a
  `wait_for_you` or `declare_ready` win at once. Do not implement this by clearing the bit.
- `ThreadEntry.state` from `listThreads` gains `working` for `background`. The chat's own
  `view.state` from `foldThread` does not change, which is what keeps the composer honest.

**Background sub-agents.** The `tasks` log event gains a count of live sub-agents beside the
commands, filled from the same `background_tasks_changed` message, whose `local_agent` entries
`isBackgroundCommand` filters out today. Monitors and ambient tasks stay out: they are not work
the agent waits on for a reply. The strip stays commands only.

**The flip at 10 minutes.** Nothing is logged at that moment, so no signal would fire. The host
sets a timer when a turn ends with background work, and publishes a `turn` live signal when it
expires, cleared by the next turn or by the process stopping.

**The skill line.** `packages/skills`' feature skill tells a lead that hands something to the
human while a command runs to call `wait_for_you`.

### Order of work

1. Add a repeatable timing of the targets in decision 7, against a copy of the largest real log,
   with a simulated working thread. Run it first for a baseline. If it shows a target out of reach,
   tell the human before going on.
2. The tail reader, then the one-read-at-a-time guard, with a test that fails first.
3. One read to open and no old paint.
4. Thread reads on their own requests, the list no longer holding up the thread, compression.
5. The status rule and its readers, the 10-minute signal, sub-agents, the skill line.
6. Re-run the timing, the project's typecheck and tests, then the review round.

## Seams

- **`foldThread` / `awaitsHuman` and the new rule in `@runcastle/core`** (existing, one new): pure
  functions over a list of events and a time. All the status cases are testable here: command
  running, 10 minutes passed, question mark, open ask, process stopped, a command finishing
  without waking the agent.
- **`threadEvents` / `listThreads` in `threads/read.ts`** (existing): observe that a read after a
  cursor returns the same events as a full read, after appends, a torn last line and a rewritten
  file, and that it does not re-validate the file.
- **`startLiveSync`** (existing): driven by fake frames and a clock. Observe that a read slower
  than the signal rate still lands, and that the last signal gets one read after it.
- **`useThread`** (existing, through `thread-column.test.tsx`): observe that a held log is not
  painted before the opening's read answers, and is painted with the out-of-date line if it fails.
- **`needsMe` / `triageOf` / the header status** (existing): a feature with background work and no
  waiting reason is Agent working; with a waiting reason it needs the human.
- **The agent host with a fake agent** (existing, `agent-host.test.ts`): observe the `tasks` event
  with sub-agents and the `turn` signal at the limit.
- **A timing script** (new, step 1): the numbers decision 7 asks for, before and after. It lives
  with the repo's other scripts, and it is the feature's proof.

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

- Whether a thread with hundreds of live tool rows re-renders too slowly. Items in the chat are not
  memoised, so each event re-renders them all. The timing in step 1 covers a live turn; memoising
  `Item` is a small change if it shows up.
- Which reads hold up the page-load batch. `project.prep` takes 208 ms alone and 1.9 s during a
  page load, so the server is queueing rather than any one read being slow. Step 1 should profile
  that burst; the tail reader may clear most of it by itself.
- The timings over the SSH tunnel, which can only be checked once the move has happened.
