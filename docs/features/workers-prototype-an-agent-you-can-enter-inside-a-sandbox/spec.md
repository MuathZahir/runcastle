# Workers: prototype an agent you can enter inside a sandbox

## Problem

Runcastle wants a feature's lead to hand work to **workers**: threads with their own sandbox
and branch that the human can open and talk to at any time, and that report back with a short
handback instead of filling the lead's window. Before anything is built for real, one thing is
unknown: can an agent run as a runcastle thread inside a burn sandbox, stay reachable by the
human (typing to it, seeing its dev server), give its resources back when idle, and still be
fast enough to iterate with? If not, workers run on the host in their own git worktree instead.
The human decides that at checkpoint 1 and needs numbers and a hands-on try to decide.

## Approach

**What the human sees.** With the experimental setting on (decision 5), a feature's lead
starts a worker. It shows in the app as one of the feature's side chats, titled "Worker:
<label>", and opens in the normal chat view, live while it works; the human types to it like
any chat. When the worker starts its dev server it says the address to open
(`http://localhost:<port>/`), served from inside its sandbox through the one port the sandbox
publishes. When done it hands back: the lead gets one message with the summary, the commits
and how to merge them. Nothing else in the app changes (decision 26).

**The shape.**

- **Worker record (new, no database — decision 24).** One JSON file per worker under
  `<dataDir>/workers/`, keyed by its thread's session id: label, goal, done-when, container,
  branch (cut from the feature branch), port, status, handbacks and setup timings.
- **The sandbox (decisions 7, 8, 23).** A plain `docker run` / `podman run` of the burn image,
  as the agent user, on the ordinary bridge network, publishing one port on `127.0.0.1`.
  Sandcastle is not used for the container because it cannot publish a port without a new
  patch hunk. Mounts: the worker's own bare copy of the feature branch (never the host repo,
  so nothing in the sandbox can plant a hook or config there), the runtime dir (read-only), and
  a shared cache volume. Setup clones the worker branch into `/home/agent/repo` with a
  post-commit hook that pushes every commit into the bare copy (ADR-0005's shape); the host
  fetches the worker's branch from it at handback,
  then installs dependencies by lockfile. Idle stop is `docker stop`; wake is `docker start`,
  which also restarts the dev server the worker last ran. The burn engine is not changed.
- **The runtime dir.** The ACP adapter (`claude-agent-acp`, the bridge between ACP and Claude
  Code) bundled to one file with Bun, once per adapter version, plus the worker's MCP script.
  Mounted read-only, so the burn image is unchanged (decision 2).
- **The sandbox transport (new, at an existing seam).** The thread host already takes a
  transport, the function that starts an agent process. A transport may now also say how the
  session opens: its cwd, MCP servers, session options and permission mode. For a worker
  thread it runs `docker exec -i … node /opt/runcastle/acp.mjs` with the Claude token passed by
  name, and opens the session in `/home/agent/repo` with the worker's own MCP server,
  permissions bypassed (decision 15) and the worker's briefing appended to the system prompt.
  Event log, reducer, prompt queue, idle timer and `session/load` are reused as they are.
- **The worker's tools (decision 23).** A dependency-free stdio MCP server inside the sandbox:
  `hand_back({ summary })` writes the summary to a file; `start_dev_server({ command? })` runs
  the command (default: the project's recorded design command) detached on the worker's port
  with `PORT`, `RUNCASTLE_DESIGN_PORT` and `HOST=0.0.0.0`, waits until it answers on the
  container's own address, and says when it only listens on localhost (which a published port
  cannot reach). Nothing in the sandbox can reach runcastle.
- **Handback (decisions 10, 11).** When a worker's turn ends, the server reads the handback
  file through `docker exec`; a new one is recorded with the worker branch's commits and
  files and wakes the lead once through the existing lead delivery. Nothing lands.
- **The lead's tool.** `start_worker({ label, goal, doneWhen })`, offered to the feature's
  main chat only when the setting is on. Names are provisional (decision 4).
- **The measuring harness (decisions 16, 25, 27).** A script that drives the same sandbox code
  and adapter with a bare ACP client against a scratch clone of this repo, five runs per side,
  medians: cold start (container, clone, install, adapter, session), a trivial turn and a small
  commit turn, the dev server answering from the host, a handback turn and its size, stop,
  wake to first reply, the dev server after wake, a live reattach, and an attach-by-handoff
  resume (headless `claude -p` in the sandbox, then its session loaded through the adapter). It
  needs a scratch `RUNCASTLE_DATA_DIR`. The host stand-in it compared against at checkpoint 1
  was removed once the human chose the sandbox route (decision 28).
- **The report.** `report.md` in this folder: numbers, what worked and what did not, whether a
  host worker could get its own port and preview, the security and portability notes, and how
  to try a worker by hand on a scratch server (decision 18).

## Seams

- **Thread host transport** (existing, widened). A fake ACP agent behind a transport that
  supplies session options shows the session opening with them (`workers-spike.test.ts`).
- **Sandbox argv** (new, pure). One published loopback port, no host networking, the token by
  name only, the clone and push-on-commit hook.
- **The live run** (manual). The harness's numbers and one end-to-end run on this branch's
  server with a scratch data folder.

## Out of scope

- The worker list, statuses, failure wakes, preview waking a stopped sandbox, cleanup and lead
  messages: recommendations for `interactive-workers` (end of `decisions.md`).
- Moving burns, reviews and resolvers onto workers, a worker pool, and landing a worker's
  commits: `burns-become-workers`.
- When agents get woken beyond a handback: `agents-are-woken-only-when-it-matters`.
- Codex workers, a host-worktree worker, a relay letting the sandbox reach `/mcp`, a "new
  worker" door for the human.

## Open questions

- Which code survives the merge is decided after checkpoint 1 (decision 5).
- A worker whose container dies is only visible in its thread's error today; failure wakes
  are for `interactive-workers`.
