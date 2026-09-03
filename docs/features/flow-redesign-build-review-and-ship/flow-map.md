# Flow map — build, review, and ship (as-is)

Walked with agent-browser against a standalone server (worktree code, built web
dist, port 4612) on a scratch data dir. **Fixtures for the next walks live in
`docs/features/flow-redesign-build-review-and-ship/prototypes/walk-fixtures/`**
(gitignored):

- `data/` — the scratch runcastle data dir (db, config: docker sandbox,
  `sandcastle:runcastle-demo` image, implement model `claude-haiku-4-5`,
  serverPort 4612). No `.env` — the Claude OAuth token must be sourced into the
  server's environment at launch (`set -a; . ~/.runcastle/.env; set +a`);
  `readTokenFromEnvFile` falls back to `process.env`.
- `scratch-app/` — the fixture repo source. **The project actually points at a
  clone: `C:\Users\user\rcwalk-app`** — it must live at a short real path, see
  dead end 1. `bun run dev` serves a static page on :4599 (the dev command for
  the test-drive walk). All prepared keys are set on the project row.
- `seed.ts` — reseeds project + features from zero (see its header).
- `shots/` — screenshots r01–r10 referenced below.
- A junction `C:\Users\user\rcwalk` → this dir exists for short shell paths
  (do NOT point the *project* at it — git resolves it and sandcastle's Windows
  git-mount rewrite then mismatches, see dead end 1).

Server start (from the feature worktree root):

    env -u RUNCASTLE_MIGRATIONS_DIR -u RUNCASTLE_PTY_HOST -u RUNCASTLE_SKILLS_DIR \
        -u RUNCASTLE_HOOK_CLIENT -u RUNCASTLE_SANDCASTLE_TEMPLATE -u RUNCASTLE_SERVER_URL \
        -u RUNCASTLE_SESSION_ID \
        RUNCASTLE_DATA_DIR=C:/Users/user/rcwalk/data \
        RUNCASTLE_WEB_DIST=<worktree>/apps/web/dist \
        bash -c 'set -a; . ~/.runcastle/.env; set +a; exec bun packages/server/src/bin/runcastle.ts serve'

State left for the next walk: **`greetings-pages` is burned to success and sits
in the review phase** (3/3 tickets, 5 commits on `feature/greetings-pages`, no
review agent ran). `doomed-run` sits in implementation with a permanently
failing ticket (#2 "agent made no commits"). `cancel-me` sits in implementation
with a cancelled run (one lane "stopped by user", one "orphaned"). `empty-tickets`
sits in the tickets phase with zero tickets.

## A. Run view (`RunBody.tsx`) — Burn through success, failure and cancel

Walked 2026-09-03: one run to success (greetings-pages), one with a
designed-to-fail ticket (doomed-run), one cancelled mid-flight (cancel-me),
plus the zero-tickets states on both sides of G3.

### What the next-step bar offers, state by state

The whole model is `lib/feature-ui/next-step/implementation.ts` (+ the tickets
phase's resolver for pre-burn); every state was seen live:

| State | Kick / title | Copy | Primary | Secondary |
|---|---|---|---|---|
| tickets phase, ≥1 ticket | NEXT STEP / Review & burn the tickets | "Each ticket is one atomic task the agent will implement. Review them, then burn." | **Burn N tickets** | Revisit |
| tickets phase, 0 tickets | WAITING / Waiting for tickets | "No tickets yet — a grill session emits them." | Open grill to emit tickets | — |
| implementation, 0 tickets (F25.1) | WAITING / No tickets to burn | "…reached the build phase with an empty ledger. A session breaks the work into tickets…" | Open a session | — |
| implementation, never burned | NEXT STEP / Review & burn the ticket(s) | "Read the card — edit it if it is not quite right — then burn it into commits." | Burn N tickets | Revisit |
| run **running** | IN PROGRESS / Burning tickets | "Burning N tickets — X done[, Y failed]." | **Cancel run** (danger) | — |
| run **failed** | NEXT STEP / Resume the burn | "The run failed — resume the burn to retry." | Resume burn | Revisit |
| run **cancelled** | NEXT STEP / Resume the burn | "The run was cancelled — resume the burn to continue." | Resume burn | Revisit |
| run **succeeded** | *(state never shown)* | server auto-advances to review (G4); the bar is already "Test drive, then ship" | — | — |

Clicking Burn flips the phase to implementation instantly (the phase rail
highlights **build** — the rail says "build", the db says `implementation`),
the run row is created, and the lanes appear already `burning`.

### Ticket lanes

One lane per ticket of the current lap, `#seq + title + status chip` and a
status-dependent tail; the whole lane is clickable ("show this ticket's agent")
and pins the Agent tab to that ticket.

| Ticket status | Lane shows | Controls |
|---|---|---|
| pending | `pending` (+ "after #N" chip when blocked) | — |
| burning | elapsed timer | **Stop ticket** — stops this agent only, other lanes keep burning; ticket lands as `failed: stopped by user` |
| done | short commit sha (click = copy) + duration | — |
| failed | first line of the error, red | **Retry** (resume: "continues from any commits preserved by previous attempts", ADR-0006 attempt chaining) · **Retry fresh** (native `confirm()`, discards preserved work, danger style) |
| failed with `conflictFiles` | conflict card | **Resolve with agent** · **Resolve in terminal** (launches a revisit session briefed on the conflict) — *not walked; walk C covers conflicts* |
| blocked by a failed dep | `failed — blocked by failed ticket N` | Retry / Retry fresh |

Per-ticket **Retry immediately starts a solo re-burn** (the failed ticket flips
to `burning` on the spot; the bar returns to "Burning N tickets — X done"). The
bar's count keeps speaking about the whole lap's ledger, not the one retried
ticket.

### Agent / Events tabs

- Tab strip: `Agent #N | Events`. Selection: first burning ticket, else the
  most recently terminal one; an explicit lane click pins.
- **Agent** — the live agent-style transcript (`AgentTranscript.tsx`): ⏺ text
  bullets, ● tool lines (`Bash(cd /home/agent/cache/slots/1/repo && …)`), a
  "Burning…" spinner while live. Transcripts of *this* server session's runs
  are kept per ticket (switching lanes after the run still shows each agent's
  transcript). After a server restart: "no agent output captured — transcripts
  are held in server memory for the current burn; older runs keep only the
  event timeline."
- **Events** — the coarse run timeline: `run.started`, `burn.docs.digest`
  ("docs digest: 130 bytes to every ticket (brief.md)"), `ticket.burning`,
  `burn.setup` (cache-slot warm/install lines), `burn.text` / `burn.tool`
  (mirrors of the transcript), `ticket.timing`, `ticket.failed`/`ticket.done`,
  `burn.summary`, `run.finished`.
- For the first ~15–20 s of every ticket (container create + cache sync) the
  Agent tab shows only "waiting for the agent's first output…" — the
  container-boot progress lives in the Events tab only. On a ~30 s haiku
  ticket, the majority of the lane's lifetime shows a blank agent pane.

### Success run (greetings-pages)

3 tickets (#2 blocked by #1), concurrency 2: #1+#3 burn in parallel, #2 starts
when #1 lands. ~30–40 s per ticket. On the last landing the server
auto-advances to review — **the run view is gone the moment the run succeeds**;
there is no terminal "success" run state to stand on. The review page's
SUMMARY block then carries "run — succeeded · 3/3 tickets done", the per-ticket
burner digests ("What was done / Surprises / Left undone"), and "changes —
5 commits". (Shots r04–r06.)

### Failed run (doomed-run)

Run closes `failed · 1/2 done` when every lane is terminal. A collapsible
**"What this run produced"** section appears above the lanes with the done
tickets' digests (failed tickets have no digest entry). Gate G4 panel reads
"Run clean — every ticket reached a terminal state → **Ready to advance**"
while the bar insists "Resume the burn". The failed lane's transcript shows the
agent concluding happily (`<promise>COMPLETE</promise>` rendered raw) while the
lane says `failed: agent made no commits` — the two accounts contradict each
other and nothing explains the verdict. (Shots r07–r08.)

### Cancelled run (cancel-me)

**Cancel run is a single unconfirmed click** (`Workspace.tsx` fires
`run.cancel` directly — danger styling is the only guard). Run lands
`cancelled · 0/2 done`. Lanes: the explicitly stopped one reads
`failed — stopped by user`; the one killed by the run cancel reads
`failed — orphaned — the run ended (cancelled) while it was burning`. Both are
red `failed` — a deliberate human stop is indistinguishable from a crash at a
glance. Retry / Retry fresh on both; Resume burn resets all failed → pending
and re-runs. (Shot r10.)

### Prior findings checked

- **F25.1 "Burn 0 tickets"** — **fixed**. Implementation + zero tickets now
  shows the honest WAITING state (shot r09); the code comments cite F25.1 at
  the fix site. Tickets phase with zero tickets was always honest.
- **F12 burn copy** — **half fixed**. The tickets rail now says "Burning runs
  each ticket as its own sandboxed agent, in parallel, committing to the
  feature branch" and names `sandbox · docker` + the implement model. The bar
  itself still says only "Review them, then burn" — no duration expectation,
  and nothing anywhere says roughly how long a ticket takes.
- **ADR-0006 controls** — all present as designed: Stop ticket / Retry
  (resume from preserved commits) / Retry fresh (discard, confirmed) /
  conflict verbs (code-read, exercised in walk C).

### Dead ends / gaps (run view)

1. **Windows path fragility kills a burn before the agent starts.** A repo at
   a long path (~200 chars) fails `git worktree add` inside sandcastle with
   `fatal: '$GIT_DIR' too big`, and with `core.longpaths` on it then fails at
   `docker run` with a mangled mount spec (`…/.git:C:/…/.git:z" too many
   colons`) — sandcastle's `patchGitMountsForWindows` compares gitdir paths
   textually and a junction/canonicalization mismatch slips raw Windows paths
   into `-v`. The lane surfaces the raw git/docker error with no hint; the run
   dies in ~1 s. (Hit live while setting up; reproduced twice.)
2. **A failed run has no exit but retry.** The bar offers only "Resume burn";
   G4 already says "Ready to advance" (every ticket terminal) but nothing on
   the page advances. A ticket that will never pass (our doomed #2) loops
   forever: there is no per-ticket "cancel/waive" from the run view (cancel
   exists as an MCP tool and pre-burn), and no "accept the partial run and go
   to review" short of the gate's generic "Override with reason…".
3. **Cancel run is one unconfirmed click** that kills every burning agent
   (contrast: Retry *fresh* — strictly less destructive — does get a confirm).
4. **Stop/cancel outcomes are recorded as `failed`.** "stopped by user" and
   "orphaned — the run ended (cancelled)" wear the same red `failed` chip as a
   real crash; the run summary counts them in "1 failed". No `cancelled` lane
   state exists visually.
5. **Blank agent pane during container boot** (~15–20 s per ticket, most of a
   short ticket's life): "waiting for the agent's first output…" with the
   boot narrative hidden in the Events tab.
6. **The burner's protocol leaks into the transcript**: `<promise>COMPLETE</promise>`
   renders raw as the agent's last word; tool lines show sandbox-internal paths
   (`/home/agent/cache/slots/1/repo`) that mean nothing to the human.
7. **Failure verdict vs transcript contradiction**: a lane can read
   `failed: agent made no commits` under a transcript that ends in a confident
   completion — nothing connects the two or explains what the burner checked.
8. **The bar's burning copy under-reports**: "Burning 2 tickets — 0 done"
   omits failures until at least one exists, and during a solo per-ticket
   retry it still speaks in whole-lap numbers.
9. **No way back to an old run.** The run view shows only the latest run; the
   Events tab of older runs survives but transcripts are memory-only, and the
   "N runs" counter in the status bar goes nowhere.
