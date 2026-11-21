# A worker never shows working with nothing running

## Problem

A worker's stored status says `working` from the moment it starts until it hands back, needs the human, fails or is dropped. A turn that ends without a handback leaves that status alone by design (needs-you-is-the-agent-s-call decision 6), and the idle timer that stops its process half an hour later leaves it alone too. The worker cards already turn that into "Idle" by asking whether a turn runs, but the lead's tools, the epic's feature list and the handback state line read the stored status. So in a 36-hour autopilot run a worker that had stopped after a missed usage limit read "working" to its lead for 9.3 hours, the lead waited 587 minutes, and nothing told anyone.

## Approach

From the user's side: "Working" is true wherever it shows (decision 1). An assigned worker that stops short is nudged once in its own chat (decisions 2–4). If it stops short again it reads "Stalled", and its lead gets a card and is woken (decisions 5, 6). Workers that wait on the human by design read Idle and are never nudged (decisions 2, 3, 8).

### One shown status, shared

The web's rule for what a worker shows (its own need, else Working while a turn runs, else Idle; any other status its own word) moves into `@runcastle/core` as a pure function over `{ status, need, turnRunning }`. The web keeps calling it; the server's readers call it too, with `turnRunning` from the agent host as the worker list already computes it:

- the feature context's worker list and counts (what the lead reads),
- the epic's in-flight feature line ("2 working, 1 needs you"),
- the handback state line ("N workers at work"),
- the restart carry-on, which must skip a stalled worker.

`turnRunning` today is computed only in the web's worker router; it becomes one server helper used by all of these.

### The stored status

`WorkerStatus` gains `stalled` (a text column with no check constraint: no migration). It is in `IN_PLAY_WORKER_STATUSES` and in the set that holds a feature back from ready. Every `Record<WorkerStatus, …>` in the web gains it: word "Stalled", tone `warning`, group with the in-play workers, plain line "stopped twice without handing back". `workersNeedYou` does not count it (decision 5).

`stalled` leaves when someone writes to the worker: the human's prompt (`workerPrompted`), the lead's `message_worker`, the Hand back button's prompt, or a send-back. Each sets it back to `working`. `drop_worker` works on it as on any in-play worker. `send_back_worker` stays refused (it needs a handback).

Naming: the turn watch's `StopReason 'stalled'` and `WORKER_STALL` (a turn killed for no progress) are a different thing and keep their names; code comments on both say so.

### The turn-end rule

In the worker service's turn-ended handler, after the handback, failure and usage-limit paths it already has, a turn that ended with no handback goes through one check, in this order:

1. Status is not `working` (it called `wait_for_you`, was dropped, etc.): nothing.
2. The kind is `with-you`, `unassigned`, `fix-drive` or `scenario`: nothing (reads Idle).
3. The turn ended `cancelled` (the human's or the feature's Stop), the usage limit holds the chat, background commands or subagents still run (`end.background`: the agent may start its own turn when they finish), or a prompt is already queued for it: nothing.
4. The prompt that opened the ended turn came from the human: nothing (decision 3).
5. The prompt that opened the ended turn was runcastle's nudge: set `stalled`, emit `worker.stalled`, tell the lead.
6. Otherwise: send the nudge, emit `worker.nudged`.

Steps 4 and 5 read the worker's thread log: the last `prompt` event before the ended turn, its `source`, and whether it carries the nudge's display marker. Reading the log rather than an in-memory counter means a server restart between the nudge and its turn's end still stalls rather than nudging twice.

The nudge is a `source: 'runcastle'` prompt through the agent host, like the transient retry, with a display marker so the log (and the worker's chat) can tell it apart:

> [runcastle] Your turn ended without a handback. Carry on with your assignment. When it is done, hand back; if you are blocked on the human, call wait_for_you.

A Review worker's nudge names its handback (the review package) instead of "your assignment".

### Telling the lead

`worker.stalled` follows `failWorker`'s pattern: an event, then `deliverToLead` with a new `PromptDisplay` variant `workerStalled { workerId, label, kind }`, which wakes the lead once. Its text tells the lead the worker stopped twice without handing back and its choices: `message_worker` with what to do (counts as a try), or `drop_worker`. The web renders it with the existing worker-failed card's component, with "Stalled" in place of "Failed" and no error block. The orchestrator is not told (decision 6; `orchestrator-notify` already ignores worker events).

### Resuming workers a restart caught before their turn (decision 9)

The agent host logs a prompt as it is sent, then the turn waits for the worker's slot before `turn_started`. A thread folds `working` only once a turn has started, so the boot reconciliation sees a worker waiting for its slot (or for its process to start) as idle: it is not closed as cut off, and the carry-on wake skips it. Its row stays `queued` (or `working`) with nothing behind it.

At boot, once the server listens, beside the carry-on wake: every worker that is `working` or `queued`, not a drive worker, not a host review waiting for the drive (the drive-review wait already re-arms those), not running, not among the chats the carry-on wake already told, and not on a copied database's background ban (`mayStartInBackground`), whose thread log holds prompts after its last `turn_started` that are neither held nor steered nor hidden, is resumed. Those prompts' texts, joined in order, are sent again as one `runcastle` prompt marked hidden: the agent receives it, and the chat (which already shows the original messages) does not show it twice. The host's `PromptOptions` gains `hidden` for this. A `worker.resumed` event says so. The slot code then sets it `queued` or `working` as for any turn.

### The lead's guidance

The feature skill's "two failed tries" rule gains: runcastle's nudge is not a try; a message you send a stalled worker is (decision 7).

### Tests change

The worker test that locks in "stays working with no need when its turn ends without a handback" is replaced by the cases below.

## Seams

- **The worker service's turn-ended handler** (existing), with the fake host and fake engine in the worker test support: end a turn with no handback and observe the prompts sent, the status, the events, and what reached the lead. This is the main seam; the brief's acceptance runs here: two quiet turns of an `on-its-own` worker give one nudge, then `stalled` and a lead delivery with `workerStalled`.
- **The shared shown-status function** (new, in core): pure; table-tested over status × need × turnRunning.
- **The feature context tool** (existing): a worker with `working` and no turn running reads Idle in what the lead gets.
- **The web's worker status maps** (existing, component tests): "Stalled" renders with its tone and line; the stalled card renders in the lead chat.
- **A scenario** (new): `workers/feature-with-a-stalled-worker.ts`, seeding a feature with one stalled worker and its card in the lead's chat, for the drive and the review.

Boot seam (existing, the reconcile and wake functions with a real host on a fake agent): a worker whose log ends with a prompt and no turn started, status `queued`, gets that text sent again, hidden, once; one cut off mid-turn gets only the carry-on; a drive worker and a dropped one get nothing.

Cases the handler tests cover: on-its-own nudged then stalled; Review worker likewise; with-you, unassigned and drive workers never nudged; a turn the human started not nudged; a cancelled turn, a limit-held chat, background work and a queued prompt not nudged; the lead's message to a stalled worker sets it working and the next quiet turn nudges again; a restart between nudge and turn end still stalls.

## Out of scope

- Container behaviour: clean container stops, telling runcastle's stop from a crash or memory kill, exit codes (sandboxes are being removed, ADR-0023).
- Usage-limit detection and its wake ("A usage limit never strands work", merged).
- A general "nothing is running" watchdog and queue position: already the backlog feature "Runcastle says when nothing is running".
- Changing when the idle timer stops a process.

## Open questions

None.
