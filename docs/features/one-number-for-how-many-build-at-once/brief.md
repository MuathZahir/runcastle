## Purpose

In a 36-hour run, workers waited 16.4 hours in a queue, because one worker ran at a time and nothing showed who was waiting or why. With containers gone, the human expects far more: "since we don't have sandboxes, we should be able to run a much larger number of workers at once."

This is decision 16 of `docs/adr/0023-a-lighter-feature-loop-without-sandboxes.md`.

What the human gets:

- One number, visible in settings, for how many workers and reviews run at the same time. Its default comes from the machine's memory and is higher than today's one.
- Leads and the orchestrator never wait in that queue. Only workers and reviews do.
- A queue the human can see: what is running, what is waiting, and in which order.

Where: runcastle's server (the worker queue) and the web app (settings, and wherever running work is listed). Who: every runcastle user.

## Must not swallow

- A scheduler that watches memory while work runs and adjusts by itself. Considered and not built: one number the user can see and change.
- Separate limits per kind of work, per project or per model.
- The alert for "nothing is running": its own feature.

## Decided with the human

- More workers at once (quoted above), and the orchestrator's proposal of one visible number with a default from the machine's memory, leads and the epic never queueing, and a visible queue: the human went on with "Alright. The rest is fine" and "Alright, you can start".
- Planning mode was the orchestrator's pick (plan automatically).

## Understood

- The real ceiling on the host is memory, since each worker may run tests, a build and a dev server. A usage limit on the model account is the other ceiling, and it is handled by the usage-limit feature, not here.
- Workers sharing a folder cannot run two at once in it; parallel workers have their own folders (the feature this waits on).

## Open

- The default's formula. The orchestrator suggests something as plain as one worker per 4 GB of memory, with a floor of 2 and a ceiling near 8; the lead should measure a real worker's footprint on this repo before fixing it.
- Where the queue is shown, so it is seen without hunting: the orchestrator suggests the place running workers are already listed.

## Ordering

Waits on "Workers build in the feature's folder". Nothing waits on it.

Planning mode: automatic

## Added by the orchestrator, 2026-11-21

The human, 2026-11-21: "I also want you to tell all features to prioritize implementing on their own. Maybe use subagents. But prefer not to use workers since we keep running out of memory and disk... We need to finish these fixes as fast as possible". So the lead builds this itself in the feature's folder, with its own subagents for parallel parts, and starts no workers, not even a Review worker. It reviews with its own subagents, fixes what they find, runs typecheck and the affected tests, then declares ready.
