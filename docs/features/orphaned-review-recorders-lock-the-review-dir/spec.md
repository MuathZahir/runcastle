# Orphaned review recorders lock the review dir

## Problem

A review agent drives the app with agent-browser and records a walkthrough WebM into the ticket's review dir. agent-browser is a detached daemon, not a descendant of the agent's process tree — so when the lane dies (idle timeout, Stop, crash), the tree-kill from the stop feature reaps the agent but not the recorder. The daemon, its headless Chrome, and its ffmpeg children keep streaming frames into `walkthrough.webm` indefinitely (nine hours and 94 MB in the incident that seeded this feature).

The damage lands on the *next* attempt: every re-burn of a review ticket starts by wiping the review dir so a stale DIGEST.md/BLOCKED.md cannot report a success that did not happen. On Windows a file another process holds open cannot be unlinked, so the wipe throws `EBUSY` and the run fails in seconds — every time, until a human hand-kills the orphan tree. The human cannot complete a review at all while the orphan lives.

## Approach

The burner takes ownership of the recorder it causes, using a handle it can always recompute: a **deterministic agent-browser session name derived from the ticket id** (`review-<ticketId>`), injected into the review agent's environment as `AGENT_BROWSER_SESSION` at the same point the agent's env is already built. Every agent-browser command the agent runs lands in that named session without the agent cooperating or even knowing. Because the name is derived, not stored, it survives server restarts — no registry entry, no process hunt (decision 1).

Reaping happens at two sites (decision 2):

- **Lane exit (primary).** In the review lane's existing always-runs teardown (beside the drive release), the burner stops the recording and closes the ticket's named session, then waits — bounded — for the walkthrough file handle to actually release. This covers done, crash, idle death, Stop, Cancel, and digest-abort.
- **Pre-wipe (backstop).** Immediately before the review-dir wipe on a re-burn, the burner reaps the same derived session name again. This covers the one exit the teardown cannot: a server death or restart mid-review. It is a no-op when the session is already closed.

The reap participates in the **"not stopped until dead" gate** (decision 4): the lane's terminal state is not written until the teardown settles, under a deadline of the kill registry's class (10s default). If the deadline fires first, the outcome says so out loud — a log line and a note in the ticket's error/digest that the recorder may still be running — never a silent clean stop.

The wipe itself becomes robust (decision 3): reap → wipe → on any error, **rename the dir aside** to a stale-marked sibling and create a fresh dir, so the burn proceeds. Each burn best-effort deletes that ticket's stale siblings — by then the holder is normally dead, so corpses are collected a pass later rather than accumulating. Only when even the rename fails does the run fail, with an error that names the holder problem and the manual `taskkill` remedy instead of a bare `EBUSY`. The invariant the wipe exists for holds on every path: a fresh review dir never carries a prior attempt's DIGEST.md or BLOCKED.md.

Belt-and-braces (decision 5): `AGENT_BROWSER_IDLE_TIMEOUT_MS` is injected alongside the session name at 30 minutes, so a daemon everything above somehow misses self-terminates instead of recording until a human notices.

Verification lanes are covered for free: they run the same execution path, and the session name is unique per ticket. Gates-mode reviews never start a recording, so the reap there is a cheap no-op (skip or fast-return when there is nothing to stop). If agent-browser is not on PATH, the reap is likewise a no-op — the same probe that decides drive availability already establishes that fact.

## Seams

- **Agent environment construction** (existing — where the burner builds the spawned agent's env). Observe: a host review/verification agent's env contains `AGENT_BROWSER_SESSION=review-<ticketId>` and `AGENT_BROWSER_IDLE_TIMEOUT_MS`; implementation agents' and container envs do not.
- **The reap itself** (new — one function: "reap the recorder for ticket X, bounded, never rejects"). Observe: given a ticket id, it derives the session name, issues record-stop/close, waits for the walkthrough handle to release, and resolves `{ confirmed }` — confirmed when the handle is free or there was nothing to reap, unconfirmed only on deadline. The command runner and the handle probe are injectable, so the unit drives without a real daemon.
- **Review-artifacts preparation** (existing — the function that wipes and recreates the review dir). Observe: on a locked dir it renames aside and proceeds; stale siblings from earlier attempts are collected; the fresh dir never contains a prior DIGEST.md/BLOCKED.md; only a failed rename throws, and its message names the remedy.
- **Ticket outcome** (existing — the review lane's terminal `TicketOutcome`). Observe: a stopped/failed lane's outcome is not written before the reap settles, and an unconfirmed reap is named in the error/digest text.

## Out of scope

- **Review-dir wipe policy** — whether evidence should persist across laps belongs to the parked `review-as-a-lap-trail` draft. This feature only makes the existing wipe robust.
- **Idle-timeout tuning** — why the incident's review went idle for 600 s is a separate question.
- **Docker/sandboxed burns** — reviews always run on the host; the recorder problem is host-only.
- **A path-based process hunt** for the daemon/ffmpeg — explicitly rejected (decision 1); the rename-aside fallback covers the wedged-daemon case.
- **Non-review users of agent-browser** — nothing else in the pipeline starts recordings today.

## Open questions

- Whether an in-progress recording resets agent-browser's idle clock is unverified. If a legitimate drive ever goes more than 30 minutes between commands and gets shut down mid-walk, the remedy is bumping or dropping `AGENT_BROWSER_IDLE_TIMEOUT_MS` (decision 5 accepts this risk).
