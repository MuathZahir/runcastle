# Decisions — Workers: prototype an agent you can enter inside a sandbox

Planned without the human (headless self-planning run, 2026-11-06). Every decision below is
assumed until the human confirms it. The project's orchestrator, which carries this cut for the
human until checkpoint 1, agreed the plan the same day with changes: those are marked
**Changed by the orchestrator**, and decisions 23 to 27 are its.

Check first: 1, 11, 23, 25

## 1. The worker runs live in the sandbox as a normal thread, not by handoff
**Decision:** The worker's agent runs inside its sandbox as an ACP thread from its first
message (ACP is the Agent Client Protocol that every runcastle chat already runs over,
ADR-0015). Its updates stream into the same thread log, so the human can open it while it
works and type to it mid-task. "Attach by handoff" (the worker runs headless and Open resumes
its captured session later) is not built; the report says why.
**Why:** The thread host already takes a pluggable transport (the function that starts an
agent process), so a live thread costs one new transport. Handoff would give a worse product
(nothing to watch while it works) on the same machinery, since Open would still have to run an
ACP session in that sandbox. If the live route fails outright, the spike falls back to
measuring handoff and says so.
**Assumed.** Alternative: attach by handoff (headless `claude -p` through sandcastle, Open
resumes the session interactively in the same sandbox).

## 2. The ACP adapter runs inside the container; runcastle talks to it over `docker exec -i`
**Decision:** The adapter process (`claude-agent-acp`, the bridge between ACP and the Claude
Code CLI) runs inside the sandbox next to the CLI, and the server speaks ACP to it over the
stdin/stdout of a `docker exec -i` (or `podman exec -i`). The only thing crossing the
container wall is the ACP stream. The adapter reaches the container as a read-only mount of
the host's own copy (bundled to one file), so the burn image is not changed.
**Why:** The adapter reads and writes the CLI's session files and passes paths to it; keeping
both in the container means no host-to-container path translation and resume (`session/load`)
finds its files. The image already carries Node, Bun and a Claude CLI pinned to the host's
version.
**Assumed.** Alternative: the adapter stays on the host and only the CLI runs in the container
(a wrapper `claude` that execs into it), which splits session files across the wall.

## 3. The prototype uses host networking for the sandbox
**Decision:** The worker's container runs with host networking (sandcastle's existing
`network` option). That lets the agent reach runcastle's MCP server at `localhost:4512` and
puts its dev server on a host port the app can proxy, with no change to sandcastle. On Linux
and Podman this needs nothing; Docker Desktop (Mac, Windows) needs its host-networking setting
turned on. The report records this and the security cost: an agent on the host network can
reach every service on the host's localhost, including runcastle's unauthenticated API.
**Why:** It answers the spike's question (can it work, how fast) with the least code. The
portable answer is a small relay over `docker exec` stdio in both directions, which is worth
building only if the sandbox route wins at checkpoint 1. The setting's description says
plainly what host networking exposes.
**Assumed.** Alternative: a relay over `docker exec` stdio (works everywhere, no setting, only
exposes `/mcp`), or a new port-publish hunk in the sandcastle patch.
**Superseded by 23.**
**Challenged:** Together with decision 15 (no permission prompts), an agent with every
permission can reach runcastle's unauthenticated API (merge, start drives) and anything on the
host, which on the coming VPS is everything; fine for measuring, not for merged code.

## 4. A worker is a new thread kind owned by the feature, started by its lead
**Decision:** A worker is a session of a new kind, `worker`, belonging to one feature, with a
label, a goal and a done-when. The lead starts it with an MCP tool (`start_worker`). The
human starts one by asking the lead.
**Why:** The worker model has the lead delegating; the human's own "start a worker" door
belongs to `interactive-workers`.
**Assumed.** Alternative: a "New worker" button in the app for the human.
**Changed by the orchestrator:** every tool name in this feature (`start_worker`, `hand_back`,
`start_dev_server`, `message_worker`, `discard_worker`) is provisional; `interactive-workers`
names them for real.

## 5. All of it sits behind an experimental setting, off by default, and is trimmed before merge
**Decision:** One config flag (`experimentalWorkers`) turns on the `worker` tools and
transport. With it off, nothing a user sees changes. After checkpoint 1, before the merge, the
lead removes the code the human's choice will not reuse (for example the sandbox transport if
the human picks host workers), so the branch merges the findings plus only what lives on.
**Why:** The brief allows the spike code to be thrown away or kept behind a flag; a flag lets
the branch merge without exposing half-built workers, and trimming keeps unused machinery out
of main.
**Assumed.** Alternative: always on.

## 6. No new screen: the worker appears in the feature's existing thread list
**Decision:** A worker shows in the feature's thread list (where side chats already appear)
with a "Worker" tag, its label and its status, and opens in the normal chat view. The chat
header gains one link, "Open preview", while its dev server runs. Nothing is designed.
**Why:** The real worker list is `interactive-workers`' job. Reusing the thread view is also
part of the proof: the same view must work for a sandboxed thread.
**Assumed.** Alternative: a first cut of a worker list.
**Withdrawn — changed by the orchestrator:** a product decision the spike does not need to take its measurements; it is now a recommendation for `interactive-workers` (see the end of this file), not something this feature builds.

## 7. The sandbox is a burn sandbox, kept alive
**Decision:** The worker's container is built the way a burn's is: the same image, cache
mounts, isolated clone of the repo (ADR-0005) and setup hook, on its own branch cut from the
feature branch. Unlike a burn it stays up between turns instead of exiting when one agent run
ends. The burn engine itself is not changed.
**Why:** The question is whether a burn sandbox can host a thread; a lighter container would
answer a different question. Sandcastle already offers a long-lived sandbox with exec.
**Assumed.** Alternative: a plain container with the repo mounted.
**Changed by the orchestrator (through 23):** sandcastle cannot publish a port (its
`docker run` takes no `-p`, and adding one means regenerating the permanent patch, ADR-0011),
so the worker's container is started with a plain `docker run` / `podman run` of the same burn
image, user, cache mount and isolated-clone setup, plus the published port.

## 8. Idle workers stop their container and resume on the next message
**Decision:** After 30 idle minutes (the chat rule in ADR-0015, never while the agent waits on
the human), the adapter stops and the container is stopped, not removed. The next message
starts the container again, restarts its dev server, and resumes the conversation with
`session/load`. The idle time is configurable so the spike can measure resume.
**Why:** A stopped container holds no memory or CPU but keeps the clone, its installs, any
uncommitted work and the CLI's session files, so resume is fast and exact.
**Assumed.** Alternative: remove the container on idle and rebuild it from the branch on
resume (loses uncommitted work and installed dependencies).

## 9. No worker pool yet
**Decision:** The prototype counts workers against nothing. "Giving the seat back" is proven
by an idle worker holding no running container or process. There is no machine-wide burn
pool today (burn concurrency is per round), so building one belongs to
`burns-become-workers`.
**Why:** Nothing to give back to until a pool exists.
**Assumed.** Alternative: build a machine-wide pool now and have workers take and return a
seat.

## 10. A handback is a tool call that wakes the lead once
**Decision:** The worker calls `hand_back({ summary })`. Runcastle records the summary, the
worker branch's commits and the files they changed, marks the worker "handed back", and
wakes the lead once with exactly that (never the transcript), through the existing lead
delivery. The worker's briefing tells it to include in the summary any direction the human gave
it directly, since the lead never reads the transcript.
**Why:** This is the brief's definition, and it is what keeps the lead's window small.
**Assumed.** Alternative: hand back automatically when a turn ends.

## 11. A handback does not land the commits
**Decision:** The worker's commits stay on its own branch. The lead decides what to do: merge
the branch into the feature itself, talk to the worker again, or drop it. The landing queue
(ADR-0002) is not touched.
**Why:** Landing is burn machinery the brief says must survive the move unchanged, and moving
it is `burns-become-workers`. The prototype only has to show what comes back.
**Assumed.** Alternative: a handback lands the worker's branch through the landing queue, so
"landed" is a real status.

## 12. A handed-back worker can still be talked to
**Decision:** The human or the lead can open a handed-back worker and send it a message; it
goes back to "working", and its next `hand_back` wakes the lead again. Statuses in the
prototype: working, waiting (its turn ended without a handback), stopped (idle), handed back,
failed.
**Why:** The brief's worker is reachable at any time. "Landed" and "needs you" wait for
landing and the wake rule.
**Assumed.** Alternative: a handback closes the worker for good.
**Withdrawn — changed by the orchestrator:** a product decision the spike does not need to take its measurements; it is now a recommendation for `interactive-workers` (see the end of this file), not something this feature builds.

## 13. The dev server runs inside the sandbox on a port runcastle assigns
**Decision:** Each worker gets its own port. The worker starts the project's dev server with
a tool (`start_dev_server({ command })`, defaulting to the design command the project already
records), which runs it inside the container. The app shows it through the existing design
pass-through proxy, opened from "Open preview".
**Why:** A server process the runner owns can be restarted on resume (decision 8) and stopped
with the worker; one the agent backgrounds in its own shell dies unseen.
**Assumed.** Alternative: the agent starts it in the background itself and reports the port.
**Changed by the orchestrator (through 23 and 26):** the tool runs inside the sandbox, and the
human opens the preview at the `localhost` address of the published port, not through the
design proxy.

## 14. Claude Code only
**Decision:** Workers run on Claude Code. Codex workers are not prototyped.
**Why:** One runtime answers the question; Codex's adapter is a separate unknown.
**Assumed.** Alternative: both runtimes.

## 15. Inside the sandbox the worker runs without permission prompts
**Decision:** The worker runs with permissions bypassed, as burns do, because the container is
the boundary. Runcastle's host-side guards (written for host paths) are not applied.
**Why:** A worker that stops to ask permission for every edit is not one anybody would iterate
with.
**Assumed.** Alternative: the chat's normal permission rules.

## 16. The report measures the sandbox against today's host chats; the host fallback is not built
**Decision:** The spike ends with `report.md`: cold start, resume after idle, time to first
reply and per-turn latency on fixed prompts, time until the dev server answers, each next to
the same numbers for a host side chat (the brief's fallback is a host worker in its own git
worktree, which runs exactly like one), plus the time to create a host worktree and install its
dependencies so the host's start is not flattered. It also sets the size of a handback beside
what the lead would have read doing the job itself. It lists what did not work. The human
decides sandbox or host at checkpoint 1.
**Why:** A host side chat already is the fallback's runtime, so building a host worker would
measure the same thing twice.
**Changed by the orchestrator:** the report also says whether a host worker could get its own
port and preview, so both sides of the checkpoint choice are described on the same terms.
**Assumed.** Alternative: build the host-worktree worker too, behind the same flag, for a
side-by-side.

## 17. The lead builds the spike itself, then one review round
**Decision:** No build tickets. The lead writes the spike in its own checkout and takes the
measurements on the host, then runs one review round (a review ticket) before saying ready.
**Why:** The spike needs Docker on the host to start sandboxes and time them; a burn worker
runs inside a container and cannot. The work is also one tightly connected change.
**Assumed.** Alternative: hand the code to burn tickets and measure afterwards.
**Challenged:** The brief's evidence is that a lead working alone in one huge window is the
problem; the lead should run the measuring sessions in a host side chat to keep its own window
small and try the pattern being argued for.
**Changed by the orchestrator:** the lead builds the spike itself, and the repeated measuring
sessions run through subagents so the lead's own window stays small.

## 18. The human gets a hands-on try before checkpoint 1
**Decision:** The ready message and the report say how to try a worker by hand: start this
branch's server (live sessions run the installed runcastle, not the branch), turn the setting
on, ask the lead for a worker that changes a screen, open it, type to it, open its preview.
The test drive is that try.
**Why:** "Fast enough to iterate with" is partly a feel; numbers alone will not settle it.
**Changed by the orchestrator (through 24):** the try runs on this branch's server against a
scratch data folder, never `~/.runcastle`.
**Assumed.** Alternative: the report's numbers only.

## 19. A failed worker wakes its lead once
**Decision:** When a worker's container or agent dies, or setup fails, the worker is marked
failed and the lead is woken once with what failed. This is not the wake rule, only the
minimum so a lead never waits on a worker that will never hand back.
**Why:** Only a handback wakes the lead otherwise (decision 10).
**Assumed.** Alternative: failures only show in the thread list.
**Withdrawn — changed by the orchestrator:** a product decision the spike does not need to take its measurements; it is now a recommendation for `interactive-workers` (see the end of this file), not something this feature builds.

## 20. Opening the preview of a stopped worker wakes its sandbox, not its agent
**Decision:** "Open preview" on a stopped worker starts its container and dev server without
starting the agent, so the human can look at a design hours later. The sandbox stops again
after the same idle time.
**Why:** Iterating on a design means coming back to look at it; a dead link would make the
human send a throwaway message just to see the screen.
**Assumed.** Alternative: the link shows "stopped, send a message to wake it".
**Withdrawn — changed by the orchestrator:** a product decision the spike does not need to take its measurements; it is now a recommendation for `interactive-workers` (see the end of this file), not something this feature builds.

## 21. Workers are cleaned up: by the lead, and when the feature ends
**Decision:** The lead can discard a worker (`discard_worker`), which removes its container
and branch. A feature's remaining workers are removed when it ships or is archived.
**Why:** Each stopped container keeps a full clone plus installed packages; nothing else would
ever remove them.
**Assumed.** Alternative: leave them for the human to clear by hand.
**Withdrawn — changed by the orchestrator:** a product decision the spike does not need to take its measurements; it is now a recommendation for `interactive-workers` (see the end of this file), not something this feature builds.

## 22. The lead can message a worker at any time
**Decision:** The lead sends a worker a message with `message_worker`; during a turn it is
queued to the turn's end, as runcastle's own prompts already are. It works on a working,
waiting, stopped or handed-back worker alike.
**Why:** Decision 12 covered only a handed-back worker; a lead correcting a running worker is
the normal case.
**Assumed.** Alternative: the lead can only message a worker once it has handed back.
**Withdrawn — changed by the orchestrator:** a product decision the spike does not need to take its measurements; it is now a recommendation for `interactive-workers` (see the end of this file), not something this feature builds.

## 23. One published port per worker; the sandbox cannot reach the host
**Decision:** Supersedes: 3. The worker's container stays on Docker's ordinary bridge network,
as a burn's does, and publishes exactly one port, its dev server's, bound to `127.0.0.1` on
the host. Nothing inside the sandbox can reach runcastle: the worker's own tools
(`hand_back`, `start_dev_server`) are a small MCP server that runs inside the container and
writes what the worker said to a file; runcastle reads it through `docker exec` when the
worker's turn ends. If publishing a port cannot work, that is reported as a finding; there is
no fallback to host networking.
**Why:** An agent with every permission on the host network could reach runcastle's own
unauthenticated API (merge, drives) and everything else on the machine, which is moving to a
VPS. A file read at turn end keeps the handback a tool call with no way out of the sandbox.
**Assumed.** Alternative: host networking (decision 3), or a relay that lets the sandbox reach
only `/mcp`.
**Changed by the orchestrator:** it ruled out host networking.

## 24. The spike never touches the live data folder; worker state is a file per worker
**Decision:** Everything the spike runs, the hands-on try included, uses a scratch data folder
(`RUNCASTLE_DATA_DIR`), never `~/.runcastle`. A worker's state (label, goal, container,
branch, port, status, handback) is one JSON file in the data folder; no table and no
migration are added.
**Why:** The human's live runcastle runs on `~/.runcastle`; a spike must not be able to break
it, and a schema change is not worth making for code that may be thrown away.
**Assumed.** Alternative: a `workers` table, migrated only in the scratch folder.
**Changed by the orchestrator:** it set both rules.

## 25. The report times one attach-by-handoff resume too
**Decision:** The live thread in the sandbox stays the pick (decision 1), but the spike also
runs one headless `claude -p` in a worker's sandbox, then resumes that captured session
interactively through the adapter in the same sandbox, and times it. The report compares the
two routes on numbers.
**Why:** Question 1 asked for a pick with evidence; two measured routes are evidence, one
number and an argument are not.
**Assumed.** Alternative: argue for the live route without timing handoff.
**Changed by the orchestrator:** it asked for the second number.

## 26. The spike builds only what the measurements and the hands-on try need
**Decision:** No new web UI. A worker appears in the app as one of the feature's side chats,
labelled "Worker: <label>", and opens in the normal chat view, where the human types to it.
Its preview is opened at the `localhost` address of its published port, which the worker and
the report both state. Statuses are only what the spike reads (running, stopped, handed
back). Idle stop (decision 8) stays, because resume is one of the measurements.
**Why:** The orchestrator moved the product decisions (list row, status model, failure wakes,
preview wakes, cleanup, queued messages) to `interactive-workers`.
**Assumed.** Alternative: the small UI of decision 6.
**Changed by the orchestrator:** it cut the product decisions.

## 27. Measurements run in a standalone harness, the app proof on the scratch server
**Decision:** The timings come from a script that drives the same sandbox transport and ACP
client the server uses, against this repo, with the host chat as the baseline; repeated runs
are dispatched through subagents. The end-to-end proof (lead starts a worker, the human opens
and types to it, it hands back and the lead is woken) runs once on this branch's server with a
scratch data folder.
**Why:** Timing through a running server adds noise and needs a live lead; the server path
needs proving once, not five times.
**Assumed.** Alternative: take every measurement through the running server.

## 28. Interactive workers run in the sandbox, as a trial
**Decision:** At checkpoint 1 the human chose the sandbox route: "Let's try the sandbox. We can
test it for now." Interactive workers run inside a burn-image sandbox, to be revisited after
use. The spike's host stand-in measuring paths are removed (decision 5); everything else stays
behind `experimentalWorkers` for `interactive-workers` to build on.
**Why:** The numbers showed no speed reason to prefer either route; the sandbox lets a worker
run with no permission prompts without reaching runcastle or the host repo. The open costs (the
human's own skills not in the sandbox, previews needing runcastle's proxy) are the trial's to
judge.

## Recommendations for `interactive-workers`
Withdrawn from this feature by the orchestrator; the spike's experience will refine them.
- A worker row in the feature's thread list with a "Worker" tag, its label and its status, and an "Open preview" link in its chat header (was 6).
- Statuses working, waiting, stopped, handed back, failed; a handed-back worker can still be talked to (was 12).
- A failed worker wakes its lead once, so a lead never waits forever (was 19).
- Opening a stopped worker's preview wakes its sandbox and dev server but not its agent (was 20).
- The lead can discard a worker; a feature's workers are removed when it ships or is archived (was 21).
- The lead can message a worker at any time, queued to its turn's end (was 22).
