# Workers spike: findings for checkpoint 1

Measured on 2026-11-06 on this Linux machine (Docker 29.9, the `sandcastle:runcastle` burn
image, Claude Code 2.1.316 in the image and 2.1.318 on the host, model Sonnet 5.5 for the timed
turns). Everything ran against a scratch data folder and scratch clones; `~/.runcastle` and the
live repo were never written to.

## The answer in one paragraph

An agent runs well as a runcastle thread inside a burn sandbox. The human opened it from the
app's chat list, typed to it in the normal chat view, and watched it edit, commit and restart its
dev server. The page was reachable from the host through the one port the sandbox publishes,
its commits arrived on the host as a branch, and its handback woke the lead once with about
180 tokens. An idle worker's container stops and comes back on the next message in about
5 seconds, dev server included. **Speed is not the deciding factor.** The sandbox is within a
second or two of a host chat everywhere, because the model's own time dominates. What separates
the two routes is what each one costs elsewhere (see "Sandbox or host" below).

## Numbers (medians of 5 runs per side, milliseconds)

The sandbox column runs the worker code in this branch. The host column is the stand-in the
plan agreed for a host worker: a fresh git worktree, a dependency install, and the same adapter
running the host's own Claude Code. Repo: a scratch clone of runcastle itself.

| Step | Sandbox | Host |
|---|---|---|
| **Cold start, total** (to a session ready to prompt) | **10,247** | **8,526** |
| · container up | 575 | — |
| · clone, branch, commit hook | 1,249 | 1,694 (worktree) |
| · dependency install (warm cache) | 4,537 | 1,281 |
| · adapter up + new session | 558 + 1,419 | 1,256 + 4,447 |
| **First reply to a one-word prompt** | 2,752 | 2,573 |
| Small edit + commit, whole turn | 6,739 | 5,010 |
| Dev server answering after start | 877 | 1,827 |
| Dev server reached from the host, after it answered inside | 86 | — |
| **Wake after idle stop, to first reply** | **5,408** | **6,476** |
| · container start + dev server restart | 943 | — |
| · adapter up + reload conversation | 616 + 1,367 | 3,031 |
| Dev server answering after wake | 42 | — |
| Stop on idle | 5,553 | — |
| Handback turn (agent calls the tool, ends turn) | 10,502 | — |
| Handback text the lead receives | 140 chars (harness), 733 chars (app run) | — |

Spread: sandbox cold start ran 6.6–16.3 s and host 6.2–10.5 s; edit turns ran 3.9–15.6 s and
4.7–7.2 s. The model's response time moves every row that includes a turn.

Two things are not like-for-like, and they push in opposite directions:

- **The host loads the human's own Claude setup** (plugins, MCP servers, skills), which is why
  opening a session takes about 4.4 s there and 1.4 s in the clean sandbox. That is also why the
  host wakes slower.
- **The host's install used the machine's warm Bun cache;** the sandbox used a shared cache
  volume. The first install into an empty volume took 18 s (the first smoke run), not 4.5 s.

## Question 1: live thread in the sandbox, or attach by handoff?

**Live, on numbers.** Both routes were run in the same sandbox:

| Route | What it costs to get a reply from a worker you open |
|---|---|
| Live (the worker runs as a thread; you open it while it works or after) | 5.4 s to first reply after an idle stop; 0 s while running |
| Handoff (the worker ran headless; you open it later and its session is resumed) | 4.2 s to first reply after attaching (5.8 s for the headless turn before it) |

Handoff saves about a second when opening a cold worker. It gives up being able to watch the
worker and type to it mid-task, which is the reason workers exist. The live route also needed
nothing the handoff route didn't: both load the same captured conversation through the same
adapter.

## Question 2: fast enough to iterate with?

Yes, on this machine. One message to a running worker costs the same as one to a host chat.
Starting a worker costs about 10 s (up to about 25 s on an empty dependency cache), and waking an
idle one about 5.5 s. On a design loop, the preview came back 42 ms after the wake, so the dev
server is never the bottleneck. In the app run, the human's "make the footer grey and commit"
took 18 s end to end, and a message to a stopped worker took 7.2 s.

## Question 3: seeing its dev server

Works, with one sharp edge.

- The container publishes exactly one port on the host's `127.0.0.1`. The page answered from the
  host 86 ms after the dev server was up.
- **The sharp edge: a dev server that listens only on localhost cannot be reached through a
  published port.** This project's own design command (Vite) does exactly that, and it failed
  outright ("nothing answered within 90 s"). Adding `--host 0.0.0.0` fixed it. The worker's
  `start_dev_server` tool now detects a localhost-only server and says so. The real fix is for
  the project's recorded dev command to bind all interfaces in a worker.
- The human opens `http://localhost:<port>/`. That works when the browser runs on the same
  machine as runcastle. **On the coming VPS it will not.** A worker's preview has to go through
  runcastle's existing preview proxy, as the design server's does today. That is
  `interactive-workers`' job, and nothing in this spike prevents it.

## Question 4: idle workers give their seat back

Yes. After an idle stop, the worker holds no process and no running container (no CPU, no
memory). It keeps its disk: the clone, its installs, uncommitted work, and Claude Code's
conversation files. The next message runs `docker start`, restarts the dev server, reloads the
conversation, and replies, in about 5.4 s. The conversation continued exactly where it was.

- Stopping takes 5.5 s because the image's `sleep infinity` ignores the stop signal, so Docker
  waits out its timeout. This is harmless, since it happens in the background. Adding `--init`
  to the container would make it instant.
- There is no worker pool to give a seat back to: burn concurrency is per round today
  (decision 9).

## Question 5: what a handback is

A tool call, `hand_back({ summary })`, made inside the sandbox. Runcastle reads it when the
worker's turn ends, adds the commits and files from the worker's branch, and puts one message in
the lead's chat. In the app run the lead received:

> Worker "Notes footer" handed back (thread …, branch runcastle/worker/…; nothing landed).
> Done. Added a `<footer>` … Committed as 47b0fe3 … Dev server is running … no direction given to
> me directly by the human. … To take the work: git merge runcastle/worker/…

That is about 180 tokens for the lead. The worker's own context reached 26k tokens, most of it
the starting prompt and tools; the lead read none of it. On a one-line task the saving is small,
but it grows with the task, and the lead's window only ever gains the handback.

## Sandbox or host: what each side was measured on

| | Sandbox worker | Host worker |
|---|---|---|
| Built here? | Yes, behind `experimentalWorkers` | No; measured as a host chat in a fresh worktree |
| Speed | Within 1–2 s of host; wakes faster | Within 1–2 s of sandbox; starts faster |
| Its own port and preview? | Yes: one published port, reachable from the host | Yes, and simpler: the design server already gives a host chat its own port and preview proxy today. A host dev server measured 1.8 s to answer. |
| Isolation | Strong: the agent cannot reach runcastle, the host's services, or other worktrees. It runs with no permission prompts. | None beyond permission prompts: it shares the human's machine, network and runcastle's unauthenticated API |
| The human's own skills, plugins and MCP servers | **Absent**: a clean container. Bringing them in means mounting or copying `~/.claude` | Present, as in every chat (the brief keeps user-level skills loaded) |
| Works on Docker Desktop (Mac, Windows) / Podman | Not tested. Published ports are standard on both; the `.git` mount crosses Docker Desktop's slow file layer once per clone. | No container needed |
| Billing | The burn token (`CLAUDE_CODE_OAUTH_TOKEN`) | The CLI's own login |

My read is that the sandbox is worth it if workers will run unattended with no permission
prompts, which a design-iteration worker does. The host is simpler if workers always run with
the human nearby. In either case, the user-skills question is the one to settle first.

## What did not work, or is not done

- **Sandcastle cannot publish a port.** Its `docker run` takes no `-p`, so the worker's container
  is started with a plain `docker run` of the same image, plus the same clone-and-push-back setup
  as burns. Moving burns onto this would mean either a sandcastle patch hunk (ADR-0011) or
  leaving sandcastle for workers.
- **The project's design command was unreachable** from outside the container (see question 3).
- **The thread's footer says "Feature worktree · feature/<slug>"** for a worker, which is wrong:
  the worker works in its sandbox on its own branch.
- **The host repo's `.git` is mounted read-write** so commits come back as refs. That means the
  agent could rewrite any ref in the project. Burns already mount it the same way through
  sandcastle's worktrees.
- **Failure handling is not built.** A dead container shows as an error in the worker's thread,
  and the lead is not told (now a recommendation for `interactive-workers`).
- **Podman, Docker Desktop and Codex were not tested.**
- **The live server path was proven once**, not timed. The app run went: lead tool → sandbox →
  live thread → the human typing in the app → commit on the host → handback in the lead's chat →
  stop → message → wake. The timings come from the harness, which drives the same code.

## How to try a worker by hand

This uses this branch's server on a scratch data folder, never `~/.runcastle`. The live install
runs the published runcastle, not this branch.

1. Make a scratch data folder with `config.json` set to
   `{ "serverPort": 4612, "experimentalWorkers": true }` and a `.env` holding
   `CLAUDE_CODE_OAUTH_TOKEN` (the same line as in `~/.runcastle/.env`).
2. From this branch's checkout, unset every `RUNCASTLE_*` variable except `RUNCASTLE_WEB_DIST`,
   then run:
   `RUNCASTLE_DATA_DIR=<scratch> bun packages/server/src/bin/runcastle.ts serve`
3. Open `http://127.0.0.1:4612`. Open a small repo as a project, create a feature, and in its
   chat ask the lead to "start a worker" with a goal that changes a page. The project's recorded
   dev command must listen on `0.0.0.0` and `$RUNCASTLE_DESIGN_PORT`.
4. Open "Worker: <label>" in the feature's chat list, type to it, and open the
   `http://localhost:<port>/` address it gives.
5. Afterwards: `docker rm -f` the `runcastle-worker-*` container and delete the scratch folder.

To re-run the measurements:
`RUNCASTLE_DATA_DIR=/tmp/<scratch> bun packages/server/src/workers/spike-harness.ts --repo <repo> --runs 5`.

## What the code is

All of it sits behind `experimentalWorkers`, off by default:

- `packages/server/src/workers/`: the sandbox, the worker record, the transport, the in-sandbox
  tools, the app wiring and the harness.
- One widened seam in the thread host: a transport may say how its session opens.
- One lead tool, `start_worker`.

Per decision 5, the code the human's checkpoint choice won't reuse is removed before merge.
