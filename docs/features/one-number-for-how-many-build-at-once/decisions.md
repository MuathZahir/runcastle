# Decisions: One number for how many build at once

Planned automatically, with nobody present. Decisions marked **Assumed.** are the lead's picks; those marked **Decided by autopilot.** were confirmed by the Runcastle Rethink epic on 2026-11-22, and the human can overturn any.

## 1. One number for how many workers and reviews run at once
**Decision:** One setting, visible in Settings, says how many workers and reviews may be mid-turn at the same time, across every project on the machine. Its default comes from the machine's memory and is higher than today's 1.
**Why:** In a 36-hour run workers waited 16.4 hours in line, one at a time. With containers gone the human expects many more at once ("since we don't have sandboxes, we should be able to run a much larger number of workers at once"). One number the user can see and change was chosen over a scheduler that watches memory and adjusts itself.

## 2. Leads and the epic never wait in line
**Decision:** Only workers and Review workers wait for a place. A feature's lead, the orchestrator and an epic's chat always run at once, whatever the number says.
**Why:** The human agreed to the orchestrator's proposal that leads and the epic never queue. A lead held in line would stop the very chat that starts and steers the work.

## 3. The queue is visible
**Decision:** The human can see what is running, what is waiting, and in which order.
**Why:** Nothing showed who was waiting or why, so 16.4 hours of waiting went unseen. Agreed with the human as part of the orchestrator's proposal.

## 4. The default is one per 4 GB of memory, between 2 and 8
**Decision:** With nothing set, the number is the machine's total memory divided by 4 GB, rounded down, never below 2 and never above 8. This 11 GB machine gets 2 (today it gets 1). A machine reports a little less than its label, so a 32 GB one reads about 31 GB and gets 7; 8 needs 32 GB or more as reported. Settings names the default and where it came from: "default on this machine: 2, from 11 GB of memory".
**Why:** Memory is the real ceiling. Measured on this repo: a worker's agent process holds 0.2–0.4 GB, and a typecheck peaks at 0.85 GB on top; tests and a dev server add more in bursts. 4 GB per worker leaves room for leads and the server, which on this machine already hold about 6 GB. It replaces today's default, which counts CPU cores and gives 1 on any machine with 8 cores or fewer.
**Decided by autopilot.** Alternative it was picked over: 3 GB per worker (3 on this machine), or counting the memory free when the server starts rather than the total.

## 5. A worker counts only while it works
**Decision:** A worker or review takes a place only while it is mid-turn. One waiting for you, idle between turns, stalled, or handed back holds no place, and the next in line starts.
**Why:** That is how the limit works today, and an idle worker's agent is not running tests or builds. Counting every live worker would leave places held by workers waiting on the human.
**Decided by autopilot.** Alternative it was picked over: count every live worker, whether or not it is mid-turn.

## 6. The number can go up to 16
**Decision:** The setting accepts 1 to 16. The default still stops at 8; a higher number is the user's own choice for a big machine.
**Why:** Today's cap of 8 was set for containers. On a 64 GB machine the user may want more, and the brief asks for "a much larger number" at once.
**Decided by autopilot.** Alternative it was picked over: keep the cap at 8.

## 7. The number lives in Settings → General, under "Workers"
**Decision:** The setting moves from the Sandboxes page to the General page, in a group named "Workers", labelled "Workers and reviews at once". A value the user already set is kept.
**Why:** Sandboxes are being removed (the feature [Sandboxes are removed](feature:sandboxes-are-removed)), so that page is going away, and General is where machine-wide settings already sit.
**Decided by autopilot.** Alternative it was picked over: keep it on the Sandboxes page and let the sandbox removal move it.

## 8. The queue shows in the sidebar, where workers are already listed
**Decision:** The sidebar gains one line at its foot: "2 of 2 working · 3 waiting". It opens a list of everything in line across all projects: those working, then those waiting in their order, each with its feature, project and kind. A waiting worker's own row under its feature says its place: "waiting · 2nd in line". The line hides when nothing is working or waiting.
**Why:** The brief asks for the queue to be seen without hunting, and the sidebar is where running workers are already listed (with a clock mark when queued). A row alone cannot show order across features and projects, so the foot line carries the whole line-up.
A waiting row keeps its clock mark in front, beside "waiting · 2nd in line".
**Approved by the human on 2026-11-22** ("Yes to both", relayed by the Runcastle Rethink epic), on the design page "Work queue in the sidebar": the foot line and its list, and the clock kept on a waiting row. Alternative: a queue section on the Settings page beside the number, which is out of sight while work runs.

## 9. First come, first served, across every project
**Decision:** Workers and reviews start in the order they asked for a place, whichever project or feature they belong to. A worker on an account that hit its usage limit is skipped, and says "held: <why>", until the limit lifts.
**Why:** One plain order is easy to read in the list and fair across features. The usage-limit hold already works this way.
**Decided by autopilot.** Alternative it was picked over: reviews go first, since a review is what stands between a feature and "ready".
