# Decisions — orphaned review recorders lock the review dir

## 1. The burner identifies the recorder by a deterministic session name, nothing else
**Decision:** Every review/verification agent runs with `AGENT_BROWSER_SESSION=review-<ticketId>` injected into its environment by the burner (`buildAgentEnv` is the hook). Reaping is `agent-browser --session review-<ticketId> record stop` / `close` by that name. No path-based process hunt for the daemon/ffmpeg.
**Why:** The name is *derived from the ticket id, not stored*, so it survives a server restart for free — a re-burn recomputes it and reaps before wiping, with no registry entry to forget. That removes the main argument for a pid sweep. A Windows process hunt by ffmpeg command line is fiddly, and its one remaining job (a wedged daemon that won't answer `record stop`) is covered by the rename-aside fallback instead. Accepted trade-off: an alive-but-unresponsive daemon keeps recording into the renamed-aside dir until noticed.

## 2. Reap at two sites: lane exit (primary) and pre-wipe (backstop)
**Decision:** (a) In `reviewTicketOutcome`'s `finally` (beside `releaseDriveQuietly`): `record stop` + `close` on the ticket's session, then a bounded wait for the walkthrough file handle to be released. (b) In `writeReviewArtifacts`, immediately before the `rmSync`: reap the same derived session name again, then wipe.
**Why:** The `finally` covers every in-process lane end (done, crash, idle death, Stop, Cancel, digest-abort) and is what honors "reap on every lane exit" — pre-wipe alone would leave an orphan recording until the next re-burn (the incident ran nine hours). The pre-wipe reap covers the one exit `finally` cannot: a server death/restart mid-review. It is a no-op when the session is already closed, and it directly guards the EBUSY site.

## 3. Wipe fallback: rename aside, collect stale dirs next pass, fail only when even rename fails
**Decision:** `writeReviewArtifacts` becomes: reap session → `rmSync` → on any error, rename `reviewDir` to sibling `<reviewDir>.stale-<epochMs>` → `mkdirSync` fresh and proceed. Each burn also best-effort deletes that ticket's `*.stale-*` siblings. Only when even the rename fails does the run fail — with an error naming the holder problem and the `taskkill /T /F` remedy, not a bare `EBUSY`.
**Why:** A locked dir must not fail the run (brief requirement 2), and rename works on Windows where unlink cannot (the lock is on the file, not usually the dir). Stale siblings are trash, not evidence — collecting them on the next pass caps accumulation without a background job. The invariant survives every path: a fresh `reviewDir` never carries a prior attempt's DIGEST.md/BLOCKED.md. The walkthrough route resolves through `reviewWalkthroughPath`, so a renamed-aside dir simply stops being served — correct, it is the dead attempt's evidence. Wipe *policy* stays untouched (parked in `review-as-a-lap-trail`).

## 4. The recorder reap participates in the "not stopped until dead" gate
**Decision:** The lane teardown (`record stop` + `close` + bounded wait for the walkthrough handle to release) must settle before the ticket's terminal state is written, under its own deadline of the kill registry's class (10s default). Deadline fires first → report *unconfirmed* out loud (log line + note in the ticket's error/digest that the recorder may still be running), never a silent clean stop.
**Why:** The brief demands "the same 'not stopped until dead' bar the stop feature set"; reaping asynchronously after the stopped report recreates exactly the lie that feature ended, one process further out. Cost accepted: a worst-case Stop on a review lane takes up to ~10s longer; the ordinary case (responsive daemon) closes in under a second.

## 5. `AGENT_BROWSER_IDLE_TIMEOUT_MS=1800000` as the last-ditch backstop
**Decision:** Inject `AGENT_BROWSER_IDLE_TIMEOUT_MS` (30 minutes) into the review agent's env alongside the session name, so a daemon the reap somehow misses self-terminates instead of recording until a human notices.
**Why:** Caps the tail of the one scenario decisions 1–4 leave open (reap failed and no re-burn follows) from hours to 30 minutes, at the cost of one env var and zero new code paths. Known unknown: whether an in-progress recording resets the idle clock — if a live drive ever goes >30 min between agent-browser commands and gets shut down mid-walk, the remedy is bumping or dropping the var.

## 6. One lap, whole spec
**Decision:** Sure-and-small: spec the entire feature as one lap. No walking skeleton, no `## Later laps`. Verification lanes are covered for free (`executeReviewTicket` serves both pass kinds; the session name is unique per ticket), and Gates-mode reviews make the reap a cheap no-op.
**Why:** The failure is concretely reproduced, requirements come from a real incident, every decision locked without needing research or prototype, and the blast radius is two files plus an env injection.
