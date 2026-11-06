# Workers: prototype an agent you can enter inside a sandbox

## Problem

Runcastle wants a feature's lead to hand work to **workers**: threads with their own sandbox
and branch that the human can open and talk to at any time, and that report back with a short
handback instead of filling the lead's window. Before anything is built for real, one thing is
unknown: can an agent run as a runcastle thread inside a burn sandbox, stay reachable by the
human (typing to it, seeing its dev server), give its resources back when idle, and still be
fast enough to iterate with? If not, workers run on the host in their own git worktree instead.
The human decides that at checkpoint 1, and needs evidence and a hands-on try to decide.

## Approach

**What the human sees.** With the experimental setting on (decision 5), the human asks a
feature's lead for a worker. A row appears in the feature's thread list, where side chats
already show, tagged "Worker" with its label and status (working, waiting, stopped, handed
back, failed). Opening it shows the normal chat view, live while the worker works; the human
types to it like any chat. When the worker runs a dev server, the chat header shows "Open
preview", which opens it through runcastle's existing design pass-through proxy; on a stopped
worker that link wakes the sandbox and dev server first (decision 20). When the worker is done
it hands back: the lead gets one message with the summary and the commits, and the row says
"handed back". Either side can keep talking to it afterwards.

**The shape.**

- **Worker record and service (new).** A worker is a session of a new kind, `worker`, owned by
  a feature, with a record beside it: label, goal, done-when, status, its branch (cut from the
  feature branch), container name, dev port and dev command, and the latest handback. A worker
  service owns its life: start, stop on idle, wake (sandbox only, or sandbox plus agent),
  handback, fail, discard, and cleanup when the feature ships or is archived. Every mutation
  emits an event, as the project's rule requires, so the thread list and header update live.
- **The sandbox.** Built the way a burn's is (decision 7): sandcastle's long-lived sandbox
  (`createSandbox`) with the burn image, cache mounts, the isolated clone at
  `/home/agent/repo` and its post-commit push to the worker branch (ADR-0005), plus host
  networking (decision 3) and a read-only mount of the host's ACP adapter bundled to one file
  (decision 2). Idle stop is `docker stop` / `podman stop` by container name, wake is
  `start`; the container is removed only on discard or cleanup. The burn engine
  (`ticket-burner`, the landing queue, attempt chaining) is not changed.
- **The sandbox transport (new, at an existing seam).** The thread host already accepts a
  transport: the function that starts an agent process and returns its ACP stream. For a
  `worker` session it runs the adapter inside the container with `docker exec -i` (Podman
  alike) and hands its stdio to the host unchanged. Session cwd and briefing paths are
  container paths. Everything else in the thread host (event log, reducer, prompt queue,
  steering, idle timer, `session/load` on resume) is reused as is. The idle stop also stops the
  container (decision 8), never while the agent waits on the human.
- **Briefing.** The worker's system prompt carries its assignment (label, goal, done-when),
  says to work in `/home/agent/repo` and commit as it goes, to start the dev server with its
  tool, and to finish with `hand_back`, whose summary must include any direction the human
  gave it directly. It runs with permissions bypassed and without runcastle's host guards
  (decision 15). Its MCP config points at `localhost:<serverPort>/mcp` with its own session
  header, so it sees only the worker tools.
- **MCP tools.** For the lead (feature audiences, only with the setting on):
  `start_worker({ label, goal, doneWhen })`, `message_worker({ worker, text })` (queued to the
  turn's end during a turn), `discard_worker({ worker })`. For the worker:
  `hand_back({ summary })` and `start_dev_server({ command? })`, defaulting to the design
  command the project records in `.runcastle/design.json`, with the worker's port in
  `RUNCASTLE_DESIGN_PORT`. The runner starts the command detached inside the container and
  restarts it on every wake.
- **Handback and failure.** `hand_back` records the summary, the worker branch's commits
  against the feature branch and the files they touch, marks the worker handed back, and
  wakes the lead once through the existing lead delivery (`deliverToLead`). Nothing lands: the
  lead merges the branch itself if it wants it (decision 11). A dead container, a crashed
  adapter or a failed setup marks the worker failed and wakes the lead once with the reason
  (decision 19).
- **Web.** The thread list row (tag, label, status) and the chat header's "Open preview" link
  and stopped note. No new screen.
- **The report.** `docs/features/<slug>/report.md`: what was built, what worked and what did
  not, and a table of medians over at least five runs each on this repo:
  cold start (sandbox create plus setup plus adapter ready), wake after idle stop (container
  start plus `session/load`), time to first streamed update and full turn time on two fixed
  prompts (a trivial one and a small code edit), time until the dev server answers after
  `start_dev_server` and after a wake; and the same for a host side chat, plus the time to
  create a host worktree and install its dependencies. One line sets a handback's size beside
  what the lead would have read doing the job itself. It ends with the sandbox-or-host
  question for checkpoint 1 and how to try a worker by hand (decision 18). Docker Desktop's
  host-networking setting and the security cost of host networking are stated plainly.

The lead builds this in its own checkout and takes the measurements on the host (decision 17),
then runs one review round.

## Seams

- **Thread host transport** (existing). Inject a fake ACP agent behind the sandbox transport's
  exec step and observe that a `worker` session gets the exec command, container paths and
  `session/load` on resume, through the same tests that cover the thread host today.
- **Worker service** (new). Start, idle stop, wake, handback, fail, discard and feature-end
  cleanup, with the container runtime calls behind an injected runner; observe the worker
  record, the events emitted and the container commands issued.
- **MCP server per audience** (existing). The five tools appear only for the right session
  kinds and only with the setting on; `hand_back` produces one lead delivery with summary and
  commits; a failure produces one.
- **`thread.list` / thread view over tRPC** (existing). Workers come back with tag, label,
  status and dev-server address.
- **The live run** (manual). The measurements in `report.md` and the hands-on try are the
  real proof; the review round drives it if a drive can start the branch's server.

## Out of scope

- The real worker list and the lead offering workers on its own: `interactive-workers`.
- Moving burn tickets, reviews and conflict resolvers onto workers, a machine-wide worker pool,
  and landing a worker's commits through the landing queue: `burns-become-workers`.
- When agents get woken beyond "handed back" and "failed": `agents-are-woken-only-when-it-matters`.
- Codex workers (decision 14), a host-worktree worker (decision 16), a portable relay instead
  of host networking (decision 3), and a "new worker" door for the human (decision 4).
- Phone layouts beyond what the shared thread list already gives.

## Open questions

- Whether the adapter bundles to one file that runs under the image's Node; if not, it is
  installed into the container at setup, and the report says which and what it costs.
- Whether sandcastle's long-lived sandbox survives a `docker stop` / `start` underneath it, or
  the worker service must drive the container directly after creation. Settled while building.
- Which code survives the merge is decided after checkpoint 1 (decision 5).
