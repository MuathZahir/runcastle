# Runcastle says when nothing is running

## Problem

In a 36-hour autopilot run, work sat dead for 7.7 hours behind a worker that showed "working", and most of the human's messages were "is it stuck?". When every agent has stopped and nobody asked the human anything, runcastle says nothing, so the human only finds out by checking.

## Approach

From the human's side: when a project has started features, nothing has run in it for 10 minutes, and nothing in it is in "Needs you", runcastle raises one "needs you" on the project's orchestrator chat. It reads, for example, "Nothing is running: 2 features stopped. Search: held for the usage limit until 14:05. Header: a worker stopped mid-assignment." It reaches the phone like any other "needs you". It stays until work runs again in the project or the human writes in that chat. No agent is woken or told.

### The rule, per project

A pure function in core decides from a snapshot of one project; the server gathers the snapshot.

```ts
// shape, not final names
type QuietFeature = {
  id: string; title: string
  running: boolean            // a lead turn, a worker turn, a running run, a queued worker, a review or a drive in progress
  yourMove: boolean           // decision 4: stopped by the human, or last lead turn answered the human with no worker mid-assignment
  reason: QuietReason
}
type QuietReason =
  | { kind: 'limit'; until: number }        // a session of the feature holds a usage-limit wake
  | { kind: 'worker' }                      // a worker mid-assignment with no turn running ("stalled" once that status exists)
  | { kind: 'merge' }                       // the feature said ready and nobody merged it
  | { kind: 'unknown' }                     // "stopped after its last turn"
type QuietSnapshot = {
  features: QuietFeature[]    // started features only: no drafts, no merged or archived ones (decision 2)
  otherRunning: boolean       // an orchestrator chat's turn or a drive in progress
  needsYou: boolean           // any wait or open ask on any chat of the project, epics included (decision 3)
}
// raises when: !needsYou && !otherRunning && no feature running
//              && at least one feature with !yourMove
```

- **Running** means what is actually running, never a stored status: the agent host says the chat's turn is in progress, a run is running, or a worker is queued for a slot. A worker whose status says "working" with no turn running is not running (the brief's ruling while "A worker never shows working with nothing running" is unmerged). A test drive in progress counts as running, since the human is at it.
- **Your move** (decision 4): the human pressed Stop and has not written since; or the human's last message in the lead's chat came after the start of the lead's last turn and no worker of the feature is mid-assignment. A worker is mid-assignment when it was given one and has not handed back, landed, been dropped or failed.
- **Reasons**, first match wins: a usage-limit wake on any of the feature's chats (`limit`, with its time); a worker mid-assignment not running (`worker`); a ready the human or the epic has not acted on (`merge`); else `unknown`. When the "Stalled" status lands on main, a stalled worker gives `worker` with the words "a worker stalled", and this feature merges main in before it says ready.

### The watcher

A new server service beside the needs watcher, started at boot after it, skipped on a database copy and stopped at shutdown.

- It re-checks a project when a turn starts or ends, when a wait is set or cleared, and on a one-minute timer, so a stop is noticed even with no event.
- It keeps, per project in memory, when the project last went quiet and whether this stop already raised its alert. Quiet begins at the end of the last running thing; a server start counts as the start of quiet, so a restart never raises the alert for a stop it cannot date.
- After 10 quiet minutes with the rule still true, it sets the wait with the "runcastle" mark on the target chat: the epic holding the stopped features (the newest one if several), else the project's newest orchestrator chat, else, for a project with none, the first stopped feature's own chat. Setting the wait already emits the event the needs watcher turns into the phone ping; nothing new is needed on the push side.
- **Once per stop** (decision 6): when work runs again, the watcher clears its own wait (a new wait-end cause, "work started again") and arms for the next stop. Work that is only chats held by the usage limit trying again (the hold stays on a chat until a turn of it ends clear of the limit) does not count as work running again: it is the same stop. Any other work ends the stop at once. An alert a previous server left standing is taken back at start, so it is cleared the same way and still counts as this stop's one alert. A human writing in the chat clears the wait as any wait is cleared today, which also counts as the end of that stop.
- The wait's line is built from the reasons, in the order the features were started, and folded to one line as every wait is.

### The web

Nothing changes in layout. The wait shows wherever a runcastle-marked wait on an orchestrator chat shows today: the epic's row in the sidebar, the Needs you inbox, the tab title, the project's dot on the rail and the phone notification, whose tap opens that chat.

## Seams

- **The rule function in core** (new): snapshot in, alert line or nothing out. Every decision's case is a table test here.
- **The watcher over a test database** (new, beside the needs watcher's tests): seed a project and features, fake the agent host's running answer and the clock, and observe the wait on the right chat, the `session.waiting` event, one wait per stop, and the clear when a turn starts. The phone push needs no new test: it already follows that event.

## Out of scope

- The audit's wider watchdog: per-feature quiet timers, escalation from the orchestrator to the human, notices to agents.
- The "Stalled" worker status (its own feature) and the visible queue (its own feature).
- Waking, nudging or restarting anything.
- Designs left waiting for approval: they are not a "needs you" today and stay that way.

## Open questions

- None blocking. A settings switch (decision 9) and an age limit on what holds the alert back (decision 3) are the two places the human may want a change after living with it.
