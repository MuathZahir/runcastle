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

State left for the next walk (updated after walks B–F, 2026-09-04):
**`greetings-pages` sits in review on lap 2** — 8/8 tickets done (lap 1: #1–#3
implementation, #4 a hand-seeded `review` ticket with a digest and a staged
`walkthrough.webm`, #5–#6 fix tickets promoted from notes; lap 2: #7–#8 seeded
by `seed-lap2.ts` and burned for real), 12 commits, no lap-2 review ticket.
Notes: lap 1 has 6 open (5 fillers + one text-only annotation) and 2 promoted
(one annotated; PNG at `data/annotations/note_2iaXK2HqGuRZ.png`); lap 2 has 1
open. `doomed-run` (implementation, permanently failing #2), `cancel-me`
(implementation, cancelled run) and `empty-tickets` (tickets phase, zero
tickets) are as walk A left them.

Walk B–F fixture additions: `seed-lap2.ts` (lap-2 tickets + tickets phase, run
after Iterate); walkthrough fixtures generated with ffmpeg in
`C:\Users\user\rcwalk\vids\` (`short.webm` 30 s 1280×720, `long.webm` 20 min
640×360, `corrupt.webm` random bytes) — swap one into
`data/reviews/tkt_review_lap1/walkthrough.webm`; screenshots `v01`–`v33` in
`shots/`. **Run agent-browser with `--session <name>`** (or
`AGENT_BROWSER_SESSION`): the daemon is shared across Claude sessions and
another walk hijacked the default tab mid-run. The stale worktree
`data/worktrees/<proj>/greetings-pages` (registered against the pre-clone
scratch-app path) had to be deleted before Iterate could open a lap session.

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

## B. Review landing (`ReviewBody.tsx`) — arriving with and without a review

Walked 2026-09-04 on `greetings-pages` in three states: no review ticket (as
walk A left it), a done review ticket with a digest but no recording, and the
same ticket with a staged `walkthrough.webm`. Viewport 1440×1000.

### Card order and what is above the fold

`ReviewBody` renders, top to bottom: SessionPanel → ConflictCard →
DriveFailureCard → [Summary | Test drive] grid → OpenDefects →
PlannedNextLapCard → DrivePane → **WalkthroughCard** → NotesPanel. With a
recording present the walkthrough card's top edge sits at **y = 691** of a
1000 px viewport and the frame itself starts at 742 — on arrival the human sees
the top quarter of the video and none of its controls (shot v08). With no
recording the notes panel is the last thing on the page and the Test-drive card
is a mostly empty box the grid stretches to the summary's height (v01, v07).

| State | WHAT LANDED THIS LAP | review-agent row | Everything else |
|---|---|---|---|
| no review ticket | "No review summary this lap — below is each burner's own account" + three full burner digests (H1 "Ticket 1: …", What was done / Surprises / Left undone each) | amber **no review ran this lap** | the four check rows sit ~450 px below the digests; on arrival the amber row is below the fold (v01) |
| review ticket, done, no video | the review digest as markdown (fixture: two paragraphs + an "Observations" list) | green **no findings** (findings are counted from `review_findings` rows, of which the fixture has none — the digest's own "Observations" bullets do not count) | `tickets 4/4 done` — the review ticket is counted as a ticket (v07) |
| review ticket + walkthrough | as above | as above | Knowledge rail gains `Test notes` once a note exists |

Test-drive card idle copy is `testDriveExplainer(caps)` and is accurate to the
project's real capabilities (its wording changed when the dev command was
removed).

### Dead ends / gaps (review landing)

1. **The digest wall is the first thing on the page.** With no review summary,
   three burner digests (each with its own H1) fill the whole summary card and
   push the four check rows — including the amber "no review ran this lap" —
   off the first screen. The one line the card exists to make loud is the last
   thing seen.
2. **The Test-drive card is a stretched empty box** in every idle state (the
   grid is equal-height with the summary), and once a drive is live its
   explainer is gone (research §4).
3. **"tickets 4/4 done" counts the review ticket** as a delivered ticket; the
   sidebar says "4/6 done" the moment two fix tickets are promoted.
4. **Status bar says "0 runs"** on a feature with a succeeded run (walk A dead
   end 9, still true here).
5. **"Session ended — Decisions from this conversation were captured to
   Knowledge."** renders for a lap session that was ended one second after it
   opened and captured nothing (v32).

## C. Test drive — with the dev command, without it, Iterate mid-drive

| State | Bar | Test-drive card | Below the cards | Status bar |
|---|---|---|---|---|
| idle, dev command set | NEXT STEP / Test drive, then ship · **Start test drive** · Address notes (if open notes) · Iterate · **Merge & ship** | explainer (checkout + setup + dev server + Open app, teardown on stop) | — | branch |
| live, dev command set | "Merge when it looks right" / "Test-driving the branch — merge when it looks right." · **Stop test drive** · Iterate **disabled** (title: "Stop the test drive first — the branch is checked out") · Merge & ship | `driving now` + branch + "Click through the feature. When it feels right, merge — or stop the drive and send feedback back through tickets." | **DrivePane** strip: `dev server` chip · branch · **Open app ↗** (`http://localhost:4599`, appears once the server answers) · Show/Hide output (xterm with `$ bun run server.ts` …) | `● driving feature/greetings-pages · stop` |
| live, no dev command (F22) | same "Merge when it looks right" bar | `checked out — nothing started` + "…no server was started: this project has no dev command. Set one in Settings…" (v06) | no DrivePane | `driving` |
| stopped | back to idle | explainer | — | branch back on `main`, :4599 dead |

- **F22 is closed**: no faked success — the card says nothing started and why,
  and no dev-server chip exists over a process that was never spawned.
- **F3 is closed**: Iterate is disabled with the reason while the drive holds
  the branch; the server guard is in `rethink()` too.
- Notes typed during a drive land in the notes panel below the DrivePane (v05)
  and `Address notes` appears in the bar as soon as one exists.

### Dead ends / gaps (test drive)

1. **Open app is below the fold.** The DrivePane renders under the summary grid;
   on a page with a digest wall the "Open app ↗" link the drive exists for is
   at y ≈ 715 after scrolling (v04) — nothing near the bar points at it.
2. **The bar does not know nothing started.** With no dev command the bar still
   reads "Test-driving the branch — merge when it looks right"; only the card
   says the drive is a bare checkout.
3. **Explainer disappears once live** (research §4 confirmed).
4. Not reached: `DriveFailureCard` (setup command failure) and `StopReviewDrive`
   (a review agent's own drive) — walk D covers them.

## D. Walkthrough player + annotation (`WalkthroughPlayer.tsx`) — THE PRIORITY WALK

Staged `walkthrough.webm` for review ticket #4 (ffmpeg `testsrc`, 30 s,
1280×720, VP8). The frame's built-in counter makes the seek position visible in
every screenshot. The video is served with `206` range responses.

### Load and layout

- Arrival: `readyState 4`, `duration 30`, Annotate enabled — the `loadeddata`
  gate the research worried about is fine on Chromium with `preload=metadata`.
- Player at rest (v09): frame 788×444 in the card, then one bar: `▶` ·
  range slider (572 px wide, 4 px tall) · `0:00 / 0:30` · **Annotate**.
- **Scrolling the controls into view puts the top of the frame under the sticky
  next-step bar** (canvas top at y = 170 with the bar spanning 148–230, v16):
  the top ~60 px of the frame cannot be seen or drawn on while the controls are
  reachable. There is no scroll position that shows the whole frame *and* its
  controls in a 1000 px viewport.

### Play / pause / scrub / keyboard

| Action | Result |
|---|---|
| ▶ | plays; button becomes ❚❚; Annotate greys out with `title` "pause on the frame you want to draw on" (v10) |
| click at 50 % of the slider | seeks to 0:15 at once, frame updates |
| drag the slider | scrubs live (frame follows the thumb) |
| ArrowLeft/Right with the slider focused | **0.05 s per press** (`step={0.05}`) — 20 presses to move one second; PageUp/Down 3 s; Home/End work |
| Space / K / arrows anywhere else | nothing — no keyboard shortcuts at all |
| click on the frame | nothing (no play/pause on the frame) |
| double-click, fullscreen, rate, frame-step | do not exist |

### Annotate — the states (screenshots)

| State | Shot | What is on screen |
|---|---|---|
| paused, Annotate enabled | v09 | bar as above |
| playing | v10 | Annotate disabled, hover-only reason |
| annotate mode, nothing drawn | v11 | canvas overlay (`cursor: crosshair`); play + scrub **disabled**; bar replaced by `[What's wrong in this frame?] Undo(off) Clear(off) Save note(off) Cancel` + hint "Draw on the frame, then say what you saw — it lands in the notes below as an ordinary note, carrying this moment (0:15) and a picture of it." |
| one stroke drawn, no text | v16 | red freehand line, **2.46 px wide on screen** (4 px at 1280 wide, scaled to 788); Undo/Clear enabled; **Save note still disabled** |
| one stroke + text | v17 | Save note enabled |
| saved | v18 | overlay gone, player back to normal; a note row appears at the bottom of the list: checkbox · 60×34 thumbnail · `0:15` button · text · Edit/Delete |
| text, no drawing | — | saves fine: the note gets a PNG of the bare frame and the `0:15` timestamp (indistinguishable in the list from an annotated one) |
| editing an annotated note | v21 | the row becomes a bare single-line `<input>` + Save/Cancel — thumbnail and timestamp vanish while editing |
| Address-notes dialog | v25 | text + author chip only; no thumbnail, no timestamp |

Save round-trip (note + PNG upload + list refetch) measured at **773 ms**; the
PNG is 154 KB and carries the stroke at full resolution (verified by opening
`data/annotations/<id>.png`).

### THE BREAK: the second stroke crashes the whole feature view

Reproduced 3/3 on fresh loads, plus twice more in the course of the walk:
draw one stroke (fine), start a second — **the feature view is replaced by the
error boundary**: `BROKEN — This feature couldn't be rendered. Everything else
still works. feature feat_… — TypeError: Cannot read properties of null
(reading 'getBoundingClientRect')` (v12b). The drawing, the text and the
annotate mode are gone; the way back is another feature and return, or a
reload. In one run the crash came on the *first* stroke of a second annotation
on the same page load; in another, on the first stroke after Undo.
Mechanism (code-read, `WalkthroughPlayer.tsx:180-184`): `startStroke` does
`setStrokes((s) => [...s, [pointIn(e)]])` — `pointIn` reads
`e.currentTarget.getBoundingClientRect()` *inside the updater*, which React
runs lazily whenever the component already has a pending update; by then the
synthetic event's `currentTarget` is null. The first stroke on a clean queue
is computed eagerly and survives; any stroke after that lands on the crash
within one or two strokes. `extendStroke` computes the point eagerly and is
fine. **This is the "doesn't work" in the human's verdict**: a circle and an
arrow is two strokes, and two strokes crash the page.

### Discards, undo, clear

| Action | Result |
|---|---|
| Undo with one stroke | stroke gone, Undo/Clear disabled again |
| Clear | all strokes gone |
| Escape in the text box (stroke drawn) | overlay closes, **stroke lost, no confirm, no toast** |
| Cancel with stroke + typed text | both lost silently |
| Save with no text | impossible — a drawing alone cannot be saved |
| Enter in the text box | saves |

### Jump to this moment

- Clicking a note's `0:15` seeks and pauses the player (t 0 → 15, verified).
- **It does not scroll the player into view.** With eight notes the player is
  fully off-screen when the list is in view (video top at −101 px); the click
  moves the playhead and nothing on screen changes (v19 → v20). Nor does the
  list scroll to a note from the player — there is no link from a saved note
  back to its row.

### Long video (20 min, 640×360, 21 MB)

- Metadata took **31 s** to arrive with `preload=metadata`; for that whole time
  the card showed `0:00 / 0:00`, a disabled scrub and a disabled Annotate with
  no loading state — the same look as the corrupt case below.
- Slider: 566 px for 1200 s → **2.1 s per pixel**; a one-pixel click to the
  right of 10:00 lands on 10:00 again. Arrow keys still move 0.05 s. There is
  no way to reach a given second, let alone a frame.
- A mid-slider seek settled in ~1 s (v23).

### Video that fails to load (random bytes)

- `video.error.code 4` (`DEMUXER_ERROR_COULD_NOT_OPEN`), but the card renders
  exactly like a healthy player still loading: empty frame area, `0:00 / 0:00`,
  scrub disabled, Annotate disabled with the hover-only "the recording has not
  loaded a frame to draw on yet", **play enabled** — clicking it toasts "the
  browser refused to play this recording" (v24). Nothing says the file is
  broken, and the "not loaded yet" tooltip is wrong forever.

### Dead ends / gaps (player + annotation)

1. **Second stroke crashes the feature view** (above). Root of the complaint.
2. **The frame's top is under the sticky bar** whenever the controls are in
   view; the video is sixth on the page and never fully visible with its
   controls.
3. **Save is gated on text**; a drawing alone cannot be saved.
4. **One-line note input** at capture; Enter saves; no multi-line.
5. **Escape/Cancel discard silently**, and Escape is bound in the very box the
   human is typing in.
6. **Keyboard**: no play/pause, no frame step, no seek shortcuts; slider arrows
   move 0.05 s.
7. **No frame accuracy on a long recording**: 2 s per slider pixel at 20 min.
8. **No loading state and no error state**: 31 s of a dead-looking card on a
   long file; a broken file looks identical, and play "refuses" via toast.
9. **Annotate disabled-with-tooltip** while playing (research §1.4.5, confirmed).
10. **Pen is 2.5 px on screen**, one colour, no shapes/arrows/text/eraser.
11. **Jump-to-moment does not bring the player into view.**
12. **Editing an annotated note drops its picture and timestamp** from the row
    while editing; the dialog that triages it shows neither at all.
13. **A text-only annotation is indistinguishable** from a drawn one in the
    list and in the ticket it becomes.
14. **Delete is one unconfirmed click** with no undo (a note plus its PNG).
15. **Thumbnail opens the raw PNG in a new tab** — no in-app viewer.

## E. Notes triage (`AddressNotesDialog.tsx`) — Fix and Iterate

Dialog (v25): "N open notes from the drive. Two ways to answer them" →
**QUICK FIXES** (all notes pre-checked, text + author chip, **Make N tickets**)
and **NEEDS RETHINKING** (**Start the lap session**, disabled with the bar's own
reason when Iterate is). The list box scrolls at eight notes.

### Fix (batch promote)

Unchecked six, promoted two (one plain, one annotated):

- One mutation; dialog closes; bar flips to **NEXT STEP / Burn the fix
  tickets** — "2 fix tickets ready — burn to run them, then review again." with
  **Burn 2 tickets** primary and Merge & ship / drive / Address notes / Iterate
  secondary (v26).
- Tickets #5 and #6 stored on **lap 1**, `pending`, kind `implementation`.
  **No review ticket is appended** — `ux-issues` dec. 9 half-enforced,
  confirmed live; the fix batch would burn and return to review unreviewed.
- Ticket title = the note text truncated with "…" (#5 "The footer text is not
  centred and sits flush against the p…"); the context paragraph names the
  attachment path, the `0:15` clock and the Read instruction, as designed.
- Note rows freeze (v27): `→` · [thumbnail] · `0:15` · text · `#5 <title>`; no
  actions.

### Iterate (new lap)

- First click: the lap flip happened, the launch **failed** on a stale fixture
  worktree, and the server rolled back cleanly — `lap.started` then
  `lap.aborted — its terminal could not be opened (could not create talk
  worktree … fatal: '…/greetings-pages' already exists); back at review on lap
  1`. F3(b) works. The UI showed nothing durable about it: the bar was simply
  unchanged and the raw git error lives only in the Activity feed.
- Second click (worktree cleared): phase → **ideation**, lap → 2, a `revisit`
  session spawns inline (v29): `LAP LIVE / Lap 2 in progress / The lap session
  digests the drive, amends the docs and emits this lap's tickets.` + a
  terminal showing Claude Code's "Accessing workspace … Yes, I trust this
  folder" prompt. Ending it leaves NEXT STEP / **Work lap 2** — "Lap 2 is open
  — its session amends the docs and emits this lap's tickets, then hands back
  to Burn. Promoting is refused until it has run." · **Start lap 2 session**.
- The two pending lap-1 fix tickets were **not** mentioned by the dialog, the
  bar or the banner when Iterate was offered and taken.

### Dead ends / gaps (triage)

1. **Batch-promote appends no review ticket** (decision 9, confirmed).
2. **Triage is blind to the evidence**: no thumbnail, no timestamp, no
   jump-to-moment in the dialog; the picture that justified the note is
   invisible where the decision is made.
3. **Ticket titles are truncated note text** with a trailing ellipsis in the
   title itself.
4. **Iterate over pending fix tickets** is silent — lap 2 starts with lap 1's
   unburned fixes still pending and nothing says so (they then burn inside lap
   2, §F).
5. **A failed Iterate leaves no trace on the page** beyond the feed; the human
   who clicked sees the same bar they started with.
6. **The lap session opens on Claude Code's trust prompt** for the talk
   worktree — the first thing the human must do in a lap is answer "Yes, I
   trust this folder".

## F. Laps — lap 2 from tickets to review

Stood in for the lap session with `seed-lap2.ts` (two lap-2 tickets, phase →
tickets) and burned from the UI.

### Lap banner, ledger, burn

- Banner from lap 2 on (v30): chip `LAP 2` · "Iterate sent this feature back
  through the pipeline: the lap session read your test-drive notes, amended the
  spec, and emitted this lap's tickets. Earlier laps are kept in full." ·
  "started 1m ago · Lap 1 landed 4 tickets". The past-tense claim renders the
  moment Iterate lands, before any session has read anything; "landed 4"
  counts the review ticket, and became **"landed 6"** once lap 1's pending
  fixes burned during lap 2.
- Tickets ledger (v30) groups by lap: `LAP 1 4/6 DONE` collapsed, `LAP 2 0/2
  DONE` expanded with #7, #8. Sidebar "4/8 done". Bar primary: **Burn 8
  tickets** — the count is the whole feature, not the lap's pending 2 (nor the
  4 pending across laps).
- Burn (v31): the run view shows **all eight lanes, ungrouped** (#1–#4 already
  `done` with their old shas, #5/#6/#7 burning, #8 pending); bar "Burning 8
  tickets — 4 done." The lap-1 fix tickets burned in lap 2's run. 3 min to
  success → auto-advance to review.

### Lap-2 review landing (v32) — what vouches for lap 1

| Surface | Lap-scoped? | What it said on lap 2 with no lap-2 review |
|---|---|---|
| WHAT LANDED THIS LAP (`lapAccount`) | **yes** | "No review summary this lap" + #7 and #8 digests only — correct |
| review-agent row (`reviewOutcome`/`reviewChecks`) | **no** | green **no findings** — lap 1's review vouching for lap 2; `NO_REVIEW_ROW` can never fire again |
| tickets row | no | `8/8 done` |
| run row | no | `succeeded · 8/8 tickets done` |
| changes | n/a | `12 commits` (whole branch) |
| REVIEW WALKTHROUGH (`reviewWalkthroughUrl`) | **no** | lap 1's recording plays as this lap's walkthrough; `GET /api/reviews/:feature` carries no lap |
| next-step bar | no | "Test drive, then ship — Checks are in." |
| notes panel (`groupByLap`) | yes | `LAP 1 · 6 OPEN` and `LAP 2 · 1 OPEN` (v33); lap-1 `0:15` buttons jump whatever recording is mounted — on a lap with its own recording they would seek the wrong one |
| PlannedNextLapCard | n/a | not rendered (the fixture has no spec with `## Later laps`; code-read: `deferredScope(spec)` gates it) |
| Address notes | no | the dialog offers all 7 open notes across laps |

### Dead ends / gaps (laps)

1. **Cross-lap vouching confirmed live**: review row green and lap-1
   walkthrough shown on a lap that was never reviewed, while the block beside
   them is correctly lap-scoped — one card contradicts itself.
2. **Burn N counts the whole feature** and burns every pending ticket across
   laps; the run view has no lap grouping (research item 26 confirmed).
3. **Lap banner copy is a past-tense fiction on arrival** and "landed N"
   drifts as older laps' tickets burn later.
4. **Lap 1's fix tickets ride into lap 2 silently** — promoted on lap 1,
   burned in lap 2's run, counted in "Lap 1 landed 6".
5. **Notes for triage are not lap-scoped**: the dialog's "7 open notes from the
   drive" mixes laps.
