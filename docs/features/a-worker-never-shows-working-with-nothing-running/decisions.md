# Decisions — A worker never shows working with nothing running

Planned with nobody present, on autopilot (epic: Runcastle Rethink). The human approved the plan in the epic's chat on 2026-11-21 ("Yes to both"), so the assumed marks are gone.

## 1. "Working" means a turn is running, everywhere
**Decision:** A worker reads "Working" only while a turn of it runs. The lead's and the orchestrator's views (the feature context, the epic's feature list, the state line on a handback) use the same fact the worker cards already use, so a worker with nothing running reads "Idle" there too, never "working".
**Why:** The human approved fixing "A stopped worker keeps showing 'working'" and agreed that status should come from facts. Today the cards already say Idle, but the lead reads the stored status, which is how a lead waited 587 minutes on a worker with nothing running.

## 2. Only workers on an assignment of their own are nudged
**Decision:** When an "on its own" worker or a Review worker ends a turn with no handback, runcastle nudges it. It is not nudged when it called `wait_for_you`, when the human or the feature's Stop ended the turn, when the usage limit holds it, or when a message for it is already waiting. "With you" workers, workers started with no assignment, and test-drive workers are never nudged: they read Idle, as today.
**Why:** Those three kinds wait on the human by design, so a quiet turn is normal for them. An assigned worker that goes quiet has simply stopped short.

## 3. A turn the human started never leads to a nudge
**Decision:** If the human wrote to a worker and its reply ended the turn without a handback, it reads Idle and is not nudged, whatever its kind. The next turn someone else starts brings the nudge back.
**Why:** The brief says a worker sitting idle because the human stopped typing must not be marked stalled. A worker that just answered the human is waiting for them, not stuck.

## 4. One nudge, then "Stalled"
**Decision:** The nudge is one runcastle line in the worker's own chat: its turn ended without a handback, so carry on with the assignment, hand back when done, or call `wait_for_you` if blocked. If the turn the nudge started also ends without a handback, the worker reads "Stalled" and is not nudged again. Any new message from the human or the lead, or a send-back, starts a fresh stretch with a fresh nudge.
**Why:** The brief asks for exactly one nudge. One gives a worker that just forgot to hand back a cheap way through, without looping on one that is truly stuck.

## 5. "Stalled" is a new worker status
**Decision:** A new status, shown as "Stalled" with the amber warning tone, and the line "stopped twice without handing back" after it on the worker's row and chat. A stalled worker stays in play: it is listed with live workers, holds the feature back from ready like any unlanded work, and is not restarted when the server restarts. It does not make the feature need the human: it is the lead's to act on.
**Why:** No current status fits. "Failed" says its agent broke, "Needs you" pings the human's phone, and "Idle" is what hid this case.

## 6. Its lead is told and woken, not the orchestrator
**Decision:** When a worker stalls, its lead gets a "worker stalled" card in its chat, the same shape as the "worker failed" card, and is woken once. The card names its choices: write to it with what to do, or drop it. The orchestrator is not told; the lead decides whether its epic needs to know.
**Why:** The project's rule is that events with no agent behind them go to the agent that owns the work. The audit asked to tell the orchestrator too; the brief already noted the project rule overrides that.

## 7. The nudge is not a try; the lead's message to a stalled worker is
**Decision:** Runcastle's nudge does not count toward the lead's "after two failed tries, step back" rule. A message the lead sends to a stalled worker does count, as a send-back does. The lead's guidance gets that one line.
**Why:** The nudge is runcastle's, not the lead's choice. What the lead does about a stalled worker is a real attempt at the problem.

## 8. A worker with no assignment never reads as working
**Decision:** A worker the human starts with "+" reads Working only during its short opening turn, then Idle until the human writes to it, in the lead's view as on its card.
**Why:** The brief's acceptance asks that a worker with no assignment not take a status that looks like work. Decision 1 covers it once every view uses the same fact.

## 9. A restart never leaves a worker waiting on a turn that will not come
**Decision:** At boot, a worker the restart caught after its message was sent but before its turn began (waiting for a free slot, or for its process to start) is resumed: that message is sent to it again, without showing twice in its chat, and it takes its place in the line for a slot. Its row goes on saying "Queued" until its slot comes, then "Working".
**Why:** A restart at 08:36 UTC on 2026-11-21 left 5 workers "queued" with no process, never to start: a message waiting for a slot is logged but no turn has begun, so the restart's wake-up treats the chat as idle. Resuming keeps the work moving with nobody acting; marking them stopped would wait on each lead to send the assignment again.
**Decided by autopilot.** The epic added this scope and let the lead pick resume or stop-and-tell.
