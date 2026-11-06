# Workers spike: findings for checkpoint 1

**Outcome:** at checkpoint 1 the human chose the sandbox route as a trial ("Let's try the
sandbox. We can test it for now."); decision 28. The host stand-in measuring code was then
removed from the harness; its numbers stay below and in `measurements/run-1-both-sides.json`.

Measured on 2026-11-06 on this Linux machine, in two harness runs: run 1 timed both sides under the
same conditions; run 2 re-timed the sandbox after the review round's fixes (raw results for both
are in `measurements/`). The machine was quieter during run 2, so compare sandbox to host within
run 1 only. Measured (Docker 29.9, the `sandcastle:runcastle` burn
image, Claude Code 2.1.316 in the image and 2.1.318 on the host, model Sonnet 5.5 for the timed
turns). Everything ran against a scratch data folder and scratch clones; `~/.runcastle` and the
live repo were never written to.

## The answer in one paragraph

An agent runs well as a runcastle thread inside a burn sandbox. The human opened it from the
app's chat list, typed to it in the normal chat view, and watched it edit, commit and restart its
dev server. The page was reachable from the host through the one port the sandbox publishes,
its commits arrived on the host as a branch, and its handback woke the lead once with about
180 tokens. An idle worker's container stops and comes back on the next message in 3–6 seconds,
with its dev server answering about a second after the wake. **Speed is not the deciding factor.** The sandbox is within a
second or two of a host chat everywhere, because the model's own time dominates. What separates
the two routes is what each one costs elsewhere (see "Sandbox or host" below).

## Numbers (run 1: medians of 5 runs per side, milliseconds)

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
| Stop on idle | 5,553 | — |
| Handback turn (agent calls the tool, ends turn) | 10,502 | — |
| Handback record (summary + commits + files, as JSON) | 140 chars (harness's fixed one-line summary) | — |

The host's wake row is the same steps a host thread takes after its 30-minute idle stop: the
adapter starts again and reloads the conversation, then replies (`wakeToFirstReplyMs` in the raw
results).

### Run 2: the sandbox after the review's fixes (medians of 5)

Each worker now copies the feature branch into its own bare repository (0.3 s here, 2 s with a
cold disk cache) instead of mounting the host repo; the timings below include it.

| Step | Sandbox |
|---|---|
| Cold start, total | 6,006 |
| First reply to a one-word prompt | 3,248 |
| Small edit + commit, whole turn | 7,075 |
| Wake after idle stop, to first reply | 3,319 |
| Preview answering again, timed from the start of the wake | 1,051 |
| Live: reattach to a running sandbox, to first reply | 3,083 |
| Handoff: attach to a headless run's session in a running sandbox, to first reply | 3,877 |
| Headless turn before that handoff | 3,730 |

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

Both routes were timed the same way in run 2: a running sandbox, a fresh adapter, the
conversation loaded, then a one-word reply.

| Route | To first reply (median) |
|---|---|
| Live: reattach to the worker's own thread | 3.1 s |
| Handoff: attach to a headless run's captured session | 3.9 s |

Handoff is no faster; within the noise they are the same work, since both load a conversation
through the same adapter. Handoff also gives up watching the worker and typing to it mid-task,
which is the reason workers exist. (Run 1 set a wake from a *stopped* container against a
handoff on a *running* one; the review rightly called that unfair, and run 2 replaces it.)

## Question 2: fast enough to iterate with?

Yes, on this machine. One message to a running worker costs the same as one to a host chat.
Starting a worker costs 6–10 s (up to about 25 s on an empty dependency cache), and waking an
idle one 3–6 s. After a wake the preview answers again about 1 s in, well before the agent's
first reply, so the dev server is not the bottleneck. In the app run, the human's "make the footer grey and commit"
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
conversation, and replies, in 3–6 s. The conversation continued exactly where it was.

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
| Isolation | Better, not complete. The agent cannot reach runcastle (it listens on the host's loopback only) and cannot touch the host repo (it works on its own bare copy, see below). It can reach host services that listen on all interfaces, through the bridge, as burns can today. It runs with no permission prompts. | None beyond permission prompts: it shares the human's machine, network and runcastle's unauthenticated API |
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
- **Fixed after the review: the host repo's `.git` is no longer mounted.** The first version
  mounted it read-write so commits came back as refs, which let the agent write hooks or config
  that would later run on the host. Each worker now gets its own bare copy of the feature branch,
  pushes into that, and the host fetches the worker's branch from it at handback (a fetch runs
  none of that repo's hooks). Burns still mount the host repo through sandcastle's worktrees; the
  same question applies to them.
- **Fixed after the review: a stopped worker's port could be handed to the next worker**, so
  the first could not start again. Ports of existing workers are now never reused.
- **If a worker's conversation cannot be reloaded, the thread starts a new one** with a notice.
  The thread host's guard against that checks the host's disk, where a worker's conversation
  never is. A real worker needs the guard to look inside its sandbox.
- **The setting is read in two places**: the lead's tool list reads the config file, the rest
  reads the server's loaded config. They agree unless the file changes while the server runs.
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
  tools, the app wiring and the harness. Raw harness results are in `measurements/`.
- One widened seam in the thread host: a transport may say how its session opens.
- One lead tool, `start_worker`.

Per decision 5, the code the sandbox route won't reuse (the harness's host stand-in) was
removed after checkpoint 1.
