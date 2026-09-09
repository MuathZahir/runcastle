# Stopping a headless agent actually stops it

## Problem

Clicking Stop on a burning ticket, Cancel on a run, or waiving a ticket under verification flips the UI to a terminal state — but the agent process is still alive. Events keep streaming onto the timeline, commits keep syncing, and in the worst case a "stopped" verification agent visibly carries on working. The stop affordance is a lie: nothing in the stack ever kills the real process.

Root cause, verified in code: the abort signal handed to sandcastle only interrupts an Effect fiber. Every process sandcastle spawns (host `cmd.exe` shells, `docker exec` clients) is a raw `child_process.spawn` wrapped in a plain Promise — no canceler, no signal, no kill on abort. Host-mode `close()` is a no-op; docker container teardown happens at run end, not abort time. Sandcastle's README promises "signal kills the in-flight agent subprocess"; the shipped 0.12.0 code (latest published) cannot deliver it. On top of that, runcastle writes the terminal state as soon as the run promise rejects, with nothing observing whether the process died.

## Approach

From the user's perspective: Stop means dead. The button shows "Stopping…" while the kill runs, and the ticket only reads stopped once the process is confirmed gone. If a process genuinely refuses to die within 10 seconds, the ticket is still marked stopped but the UI and timeline say so plainly ("stop timed out — the process may still be running") instead of pretending.

The shape (decisions 2–3): the existing sandcastle patch is extended just enough to make the kill target knowable — nothing about its behavior changes. The docker provider accepts an optional caller-supplied container name; the host provider accepts an optional `onChildSpawn(pid)` callback (a fresh child is spawned per exec, so a callback is the only workable shape there). All kill logic lives runcastle-side.

A new kill-handle registry in the server tracks, per ticket/run lane, what is currently killable: the deterministic container name (`runcastle-<runId>-t<seq>`) for docker agents, or the most recent live child PID for host agents. The burner registers handles when it launches an agent and clears them when the run settles. At abort time the registry kills: `docker rm -f <name>` for containers (immediate SIGKILL + removal, no stop grace), the existing proven `killProcessTree` (taskkill `/T /F` on Windows, process-group signal on POSIX) for host trees — reaping the `claude.cmd` shim's node grandchild, per the dev-pane precedent.

Confirmation of death (decision 4): the stop/cancel mutations become kill-and-wait — abort the controller, kill via the registry, wait bounded (10s) for confirmed death (docker: the container no longer exists; host: the tree-kill settled), then resolve. No new ticket status: the web app's existing mutation-pending state renders "Stopping…". Ordering is self-enforcing — killing the child is what makes sandcastle's run promise finally reject, and the existing failure path then writes the terminal state, so "stopped" cannot precede death. On timeout, resolve anyway with a warning flag; the UI toasts it and a timeline event records it.

Waive (decision 5): `cancelTicket` on a ticket whose agent is live routes through the same kill-and-wait before its DB flip; waiving an idle ticket stays a pure flip.

Coverage (decision 6): all four agent launch sites — ticket burner (docker), merge-conflict resolver (docker), review/verification agent (host), research agent (host). `cancelRun` kills every live lane.

Cleanup after a SIGKILL is already handled: the slot burn-cache is a named volume unaffected by container removal, and slot setup scrubs stale `.git/*.lock` files and hard-resets on every burn.

## Seams

- **tRPC mutations `ticket.stop`, `run.cancel`, `ticket.cancel` (existing, highest seam).** The user-facing contract: mutation resolves only after confirmed death (or the bounded timeout, with the warning surfaced in the result). Observable: process/container existence before vs. after, ticket/run row state, timeline events.
- **Kill-handle registry (new, server-internal).** Register/clear/kill per lane. Observable in isolation: registering a fake handle and killing asserts the right command shape and the bounded wait/timeout behavior without spawning real agents.
- **Sandcastle patch surface (new, at the vendor boundary).** Docker: a run launched with a supplied container name is visible under that exact name in `docker ps` and dies on `docker rm -f`. Host: `onChildSpawn` fires with a PID whose tree `killProcessTree` reaps. This seam is what integration tests drive to prove the kill is real.
- **`killProcessTree` (existing, proven).** Reused as-is from the dev-pane teardown feature; not re-tested here beyond its call sites.

## Out of scope

- Gating the events service by ticket status (zombie defense-in-depth) — deferred; with a confirmed kill, zombies should not exist to write events.
- Interactive PTY sessions and dev-pane teardown — already shipped elsewhere.
- The verification-pass repetition bug and the dead "Continue to review" button — separate features.
- Upstreaming the sandcastle fix / filing the upstream bug — a side errand outside this feature.
- Boot-time sweep of stray `runcastle-*` containers — the deterministic naming enables it later, but it is not built in this lap.

## Open questions

None blocking. The exact patch diff shape (option names, where the callback threads through sandcastle's provider options) is implementation detail for the burner to settle against the vendored 0.12.0 source.
