# One number for how many build at once

## Problem

In a 36-hour run, workers waited 16.4 hours for a place, one at a time, and nothing showed who was waiting or why. The limit already exists (Settings calls it "Agents working at once"), but its default counts CPU cores and gives 1 on any machine with 8 cores or fewer. It sits on the Sandboxes page, which is going away, and the only sign of waiting is a clock mark on a worker's row, with no order and no view across features or projects.

## Approach

From the user's side:

- **The number.** Settings → General gains a "Workers" group with one field, "Workers and reviews at once" (1–16). Left unset, it shows the machine's default and where it came from: "default on this machine: 2, from 11 GB of memory". Changing it applies at once with no restart: a raise lets the next in line start, and a lower one lets running turns finish. A value already set, in the config file or through `RUNCASTLE_BURN_CONCURRENCY`, is kept (decisions 1, 6, 7).
- **Who waits.** Only workers and Review workers mid-turn take a place. Leads, the orchestrator, epics, QA and side chats never wait, and test-drive workers keep their own drive slot. This is today's rule and stays as it is (decisions 2, 5).
- **The default.** total memory ÷ 4 GB, rounded down, clamped to 2–8 (decision 4).
- **The queue.** A line at the sidebar's foot ("2 of 2 working · 3 waiting") opens a list of everyone in line across all projects: those working, then those waiting, in order. A waiting worker's row under its feature says "waiting · 2nd in line", or "held" with the reason in its tooltip when its account hit its usage limit. The line is hidden when nothing works or waits (decisions 3, 8, 9).

The designed pieces, uncommitted until the human approves them:

- `WorkQueue`, a new props-driven component: the foot line and its popover. It takes `{ limit, working, waiting, onOpen, onOpenSettings }`.
- The sidebar foot gains an optional `queue` slot. Worker rows gain a place in line. The status word "Queued" becomes "Waiting".
- Design page `/preview/work-queue.html`, with the states none, room, waiting, open and held.

### Shape

**Default (core + config load).** Add a pure `resolveDefaultWorkersAtOnce(totalMemBytes)` beside the CPU-based resolver and retire that resolver: `clamp(floor(GB / 4), 2, 8)`, where an unknown or non-positive count reads as 2. Config load asks the host for its total memory (`os.totalmem()`) where it asks for the CPU count today. The schema cap rises from 8 to 16 in the three places that hold it: the core schema, the settings descriptor and the web tooltip. The config key and env var keep their names (`burnConcurrency`, `RUNCASTLE_BURN_CONCURRENCY`), so a value someone already set is kept. Only the label and page change. The settings view gains the memory figure for the hint, e.g. a `hostMemoryGb` on the default's metadata.

**Slots with names (server).** The shared slot limiter (`agent-slots`) learns who holds and who waits. `take` and `tryTake` accept an optional holder id (the worker id). The limiter exposes a `snapshot()`: the holders in order of admission, and the waiters in queue order, each with the time it asked and whether its runtime is on hold. Admission order and holds are unchanged. The queue stays in memory: a restart ends every turn, and woken workers ask again in wake order, as today.

**Queue read (tRPC).** A new `worker.queue` query, machine-wide, returns:

```ts
{ limit: number,
  working: QueueEntry[],   // in order of admission
  waiting: QueueEntry[] }  // in queue order; held entries keep their place and carry heldBy
type QueueEntry = { workerId, label, kind, featureId, featureTitle, projectId, projectName, since: number, heldBy: string | null }
```

It joins the limiter's snapshot to the worker, feature and project rows. A worker listed in the sidebar (`ListedWorker`) gains `queuePlace: number | null`, its 1-based place among the waiters that are not held.

**Events.** A place changing already rides on `worker.status` (queued ⇄ working) and `settings.updated`, but places also shift when someone ahead starts, and the working list moves at every turn's end. The limiter takes an `onMove` callback, called on every grant, release, wait, retune, hold and lift; the shared limiter publishes a live `queue` signal from it. That signal writes no timeline row, since a turn's slot is not news anyone reads back and it moves at every turn's start and end. The web treats it like any other signal: it refetches the live queries, with `worker.queue` added to that list.

**Web.** The sidebar's foot fetches `worker.queue` and renders `WorkQueue` into its new slot. A popover entry opens that worker's chat, switching project when it belongs to another. "Change in Settings" opens Settings → General at the field. Worker rows read `queuePlace` for "waiting · 2nd in line". The setting's metadata moves to page `general`, group `workers`, with its new label, tooltip and hint. The Sandboxes page loses the field. The sibling feature [Sandboxes are removed](feature:sandboxes-are-removed) deletes the rest of that page, and whichever lands second resolves the small overlap.

## Seams

- **Default resolver (new, pure, core):** memory in, number out. Unit tests at 4, 8, 11, 32 and 64 GB, and at 0 or NaN.
- **Agent slots snapshot (existing module, new read):** take, release, hold and resize, then observe the holder and waiter order. This is where "first come, first served across projects" and "held keeps its place but is skipped" are pinned.
- **`worker.queue` tRPC query (new):** seeded worker rows across two projects plus slots taken. Observe the entries, order and `heldBy`. Also `worker.listLive`'s `queuePlace`.
- **Rendered markup (existing tier-1 web seam):** `WorkQueue` and the sidebar foot chrome with resolved props, then observe the line's words, hidden when empty, and entry order. Also the settings field's label, page and hint.

## Out of scope

- A scheduler that watches memory while work runs and adjusts itself (rejected in ADR-0023).
- Separate limits per kind of work, project or model.
- The "nothing is running" alert: its own feature, [Runcastle says when nothing is running](feature:runcastle-says-when-nothing-is-running).
- The account's usage limit: handled by the usage-limit work, and only shown here as "held".
- Removing the rest of the Sandboxes settings page: [Sandboxes are removed](feature:sandboxes-are-removed).
- Disk use per worker folder, which ran out on 2026-11-21: not a limit this number sets.

## Open questions

- The portfolio home has no sidebar foot today, so the queue line shows only inside a project, though it lists every project's work. Adding it to the home is a one-line follow-up if wanted.
- A scenario: the existing "Feature with workers" scenario seeds one queued worker but no slot order, because the queue is in memory. The queue view is reached by starting real workers past the limit, or by a scenario that sets the number to 1 and seeds workers that wake into the queue on boot. Decide during the build whether the review needs it.
