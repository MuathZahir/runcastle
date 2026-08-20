# Outcome — Video annotation for reviews

A custom review-video player where the human scrubs, draws on a paused frame, and attaches a note — the annotated frame is captured as a screenshot that rides the test note all the way into the fix burn.

- Shipped: 2026-08-20
- Lap: 2

## 1. Annotated-note storage: videoTimestamp column, annotation paths, PNG upload/serve routes

# Ticket 1 — Annotated-note storage

## What was done

`test_notes` gained a nullable `video_timestamp` column, typed `real` rather than
`integer` so a sub-second scrub position survives (migration `0027`, generated with
`bun run db:generate` and applied by the existing boot migrator). Core's `TestNote`
wire type gained `videoTimestamp` and a server-stamped `screenshotUrl`; `paths.ts`
gained `annotationsDir()` / `annotationPath(noteId)`.

The test-notes service now stamps `screenshotUrl` inside `rowToNote`, so every read
path picks up disk presence with no row to keep in sync; `addNote` takes an optional
5th `videoTimestamp` param; `deleteNote` unlinks the PNG (`rmSync(..., {force:true})`
swallows the common absence); and a new `attachScreenshot(ctx, noteId, png)` writes
the file, emits `note.screenshot`, and re-renders `test-notes.md`. `noteLine` appends
` (screenshot: <absolute path>)`, after the `(→ ticket N)` reference on promoted lines.
The reviews HTTP router gained `POST /api/reviews/note/:noteId/screenshot` and
`GET /api/reviews/note/:noteId/screenshot.png`, both resolving the path from a
looked-up row's own id — never from the URL segment. The `notes.add` tRPC input takes
an optional non-negative `videoTimestamp`. The MCP `add_test_note` tool was not touched.

Two deviations from the ticket's description. First, the upload rejects a body whose
first eight bytes are not the PNG signature (400): the GET labels its response
`image/png` unconditionally, so accepting arbitrary bytes would make it a
serve-anything-as-an-image endpoint. Second, POST returns the stamped note as JSON
rather than an empty 204 — the client needs `screenshotUrl` back to render the
thumbnail without a refetch.

## Surprises

The URL the service stamps and the route that serves it are in different files with
no shared constant, and there is no natural place to put one (a service importing
from a route inverts the dependency). Instead of a shared constant, there is a test
that reads the *stamped* URL off `notes.list` and issues a real request against it,
so a drift fails as a 404 rather than as a silently broken thumbnail.

`packages/server/test/dev-pane.test.ts > "kills the child process tree so the
port-holder is not orphaned"` fails in this sandbox. It is **not** mine and not in the
stated baseline: I proved it by checking out the pre-ticket commit `7153ecd` in a
scratch `git worktree` and running that one file there, where it fails identically.
It spawns a real PTY and asserts a process group is reaped within 400ms — this
container has no process reaper. Everything else is green: 1883 passed, 1 failed,
4 skipped; `bun run typecheck` is 0 errors.

`test-notes.test.ts` did not previously redirect `RUNCASTLE_DATA_DIR`, so the new
annotation tests live in a nested `describe` with their own `useDataDir` temp tree —
otherwise they would have written PNGs into the developer's real `~/.runcastle`.

## Left undone

The `.runcastle/` drive scripts were deliberately not edited: this ticket adds no
service, required env var, seed, or extra process, and the new column rides the
existing idempotent boot migration while the annotations dir is created lazily on
first upload. Hermetically checked that `drive-setup.ts` still parses (only
missing-`@types/node` diagnostics from the ad-hoc `tsc` invocation, no syntax errors);
nothing was executed, per the sandbox rule.

Nothing cleans up orphaned PNGs for notes that vanish by a route other than
`deleteNote` — deleting a feature or a project leaves its notes' screenshots on disk.
Out of scope here (the ticket names the one delete path), but a real leak worth a
later ticket. Also untouched, and belonging to later tickets in this feature: the
burn-time copy of the PNG into `.runcastle-attachments/`, the promotion payload naming
that path, and the player/overlay UI itself.

## 2. Screenshot rides the fix burn: promotion context + burn-time copy into the workspace

# Ticket 2 — screenshot rides the fix burn

## What was done

`promotionTicket` (server/services/test-notes.ts) now appends a third paragraph when
`annotationPath(note.id)` is on disk at promotion time: it names
`.runcastle-attachments/<noteId>.png`, tells the agent to Read it, and folds in the
`videoTimestamp` as a `m:ss` clock time when the note carries one. A note with a
timestamp but no PNG gets nothing extra — the paragraph exists to point at a file.
The path spelling lives once, in core's new `ATTACHMENTS_DIR` / `attachmentRelPath`.

The burner reads it straight back out of `ticket.context` (`attachedNoteIds` →
`attachmentSources` in workflows/ticket-burner.ts) rather than querying `test_notes`
by `ticketId`, which the ticket suggested — see Surprises. Copy-in is wired to
sandcastle's `hooks.host.onWorktreeReady`, which runs on the host after
`git worktree add` and before the sandbox starts; `buildAttachmentCopyCommands`
emits one mkdir plus one copy per file, branched on `process.platform` (`cp` vs
`copy /Y`, because `cmd.exe` has no `cp`). A new `excludePath` in services/git.ts
adds `.runcastle-attachments/` to `info/exclude` before the first copy, and
`clearAttachments` removes the directory right after `run()` returns or throws,
before any landing.

## Surprises

- **The workspace-prep seam the ticket describes does not exist.** There is no
  host-side worktree prep in the burner: sandcastle creates the worktree *inside*
  `run()`, and `RunOptions` exposes no JS callback for that moment — only
  `hooks.host.onWorktreeReady`, which takes shell command strings. That is why the
  copy is a built command rather than a `copyFileSync`, and why the platform branch
  exists at all. `copyToWorktree` was not usable: it only takes paths relative to
  the host repo root, and the PNGs live under `~/.runcastle/`.
- **`WorkflowCtx` has no db handle.** `ctx` gives the workflow `updateTicket` /
  `emitEvent` / `resolveWaypoint` and nothing else, so "look up `test_notes` rows
  whose `ticketId` equals the burning ticket's id" is not reachable without widening
  the core-owned contract. The ticket also says the path convention in the context
  *is* the contract, so the burner scans the context for it — self-contained, and
  it round-trips through the same `attachmentRelPath`.
- **`info/exclude` is not per-worktree.** Verified against real git: a linked
  worktree's `.git` is a *file*, and git resolves `info/exclude` against the
  **common** git dir — a write to `.git/worktrees/<name>/info/exclude` is ignored
  entirely. So `excludePath` asks git (`rev-parse --git-path`) instead of assembling
  the path, and one write covers every burn worktree including ones not yet created.
  This also matters more than "tidiness": sandcastle *preserves* a worktree whose
  tree is dirty, so an unexcluded attachments dir would leave leftovers behind.
- **`dev-pane.test.ts` "kills the child process tree" fails in this sandbox** —
  deterministically, standalone and in the full run, and it is not in the stated
  baseline. It asserts a pty's process group is reaped after `stopDevPane`; nothing
  in this diff touches pty, signals, or `src/pty/dev-pane.ts`. I read it as an
  environment fault (process-group reaping in this container), not mine.
  Full suite otherwise: **1897 passed, 4 skipped, 1 failed**. `bun run typecheck`: 0 errors.

## Left undone

- **Isolated workspace mode.** On win32/darwin hosts `burnWorkspace: auto` resolves
  to `isolated`, where the agent works in a container-native *clone* at
  `/home/agent/repo`. `git clone` does not carry excluded files, so the attachment
  is reachable only at `/home/agent/workspace/.runcastle-attachments/<id>.png`, not
  at the bare relative path. The agent is told where the mirror is by
  `buildWorkspaceNotes`, so it can find it — but a future lap may want
  `buildIsolatedSetupCommand` to copy the directory into the clone, or the promotion
  wording to be mode-aware.
- **Conflict-resolver runs get no attachments.** The second `run()` in
  `realExecuteTicketRun` (the resolver) was left alone; it resolves a merge by
  intent from the ticket text, and nothing asked for the image there.
- `.runcastle/drive-setup.ts` / `drive-stop.ts` were read and deliberately not
  changed — this ticket adds no service, env var, seed, or long-running process.
  I did not run them (the sandbox is hermetic); `bun run typecheck` covers them only
  via `scripts/tsconfig.json`, which does not include `.runcastle/`, so they were
  checked by reading alone.

## 3. Annotation player UI: custom controls, canvas overlay, capture-to-note

# Ticket 3 — annotation player UI

**What was done.** The review body's bare `<video controls>` is now a hand-built
player (`apps/web/src/components/WalkthroughPlayer.tsx`): play/pause, scrub bar,
time readout, and an Annotate mode that mounts a canvas over the frame while the
video is paused. Strokes are recorded in the recording's *intrinsic* pixel space
(the canvas is sized to `videoWidth/videoHeight` and scaled down by CSS), red
only, with undo-last-stroke and clear; play and scrub are dead while annotating.
Save composites frame-then-strokes onto one off-screen canvas, `toBlob`s a PNG,
creates the note through `notes.add` with `videoTimestamp = currentTime`, then
POSTs the PNG to `/api/reviews/note/:id/screenshot`. A failed upload leaves the
note standing and raises a toast. Notes carrying `screenshotUrl` show a
thumbnail in the list that opens the full PNG in a tab; plain rows are untouched.
The logic that is testable without a DOM lives in `apps/web/src/lib/walkthrough.ts`
(scrub span, frame-space mapping, stroke painting, capture, the two-step save)
with `apps/web/test/walkthrough.test.ts` driving it through faked canvas/video/fetch;
`fmtClock` went into `lib/format.ts` beside the other formatters.

**Deviations from the ticket.** Two additions the ticket did not name. (1) The
scrub bar cannot trust `video.duration`: a WebM written by a live recorder — which
is exactly what agent-browser produces — reports `Infinity` until the whole file
is read, so `playableDuration` falls back to `seekable.end(...)`. (2) Annotate is
disabled until `loadeddata`/`canplay`, because `drawImage` of a video with no
decoded frame silently draws nothing, and `preload="metadata"` gives dimensions
long before pixels — without the gate, hitting Annotate on a freshly opened
review would have baked a blank PNG. Both are one-liners, both are load-bearing.

**Surprises.** The SSE path already covers the thumbnail: `attachScreenshot`
emits `note.screenshot`, and `lib/live.ts`'s `resyncAll` invalidates all of
`notes` — so no server-side change was needed for criterion 6. The explicit
`utils.notes.list.invalidate` after save is kept anyway, so the thumbnail does
not depend on the stream being up at that moment. Also: `apps/web` has no DOM
test environment and no testing-library, and `apps/web/tsconfig.json` only
includes `src` — so tests are neither typechecked nor able to render a tRPC-wired
component. That is why the seam tests sit under `lib/` and the component is kept
to wiring; the component itself was verified by typecheck plus the Vite build,
not by a driven browser (this sandbox has no app to drive).

**Test state.** `bun run typecheck` clean; `bun run --filter '@runcastle/web' build`
clean; `apps/web` suite 520 passed. The full suite has one failure —
`packages/server/test/dev-pane.test.ts > kills the child process tree` — which is
a server PTY/process-group test, unrelated to this web-only diff and failing at
the ticket's baseline commit too (its source last changed several commits before
this branch started). It is not in the listed baseline, so flagging it here.

**Drive scripts.** No change needed and none made: this ticket adds no service,
env var, seed or extra process, and `.runcastle/drive-setup.ts` already runs
`bun install` plus the SPA build unconditionally. No new dependencies were added.
I did not run the scripts (hermetic sandbox, as instructed); I read `drive-setup.ts`
to confirm the trigger list does not apply.

**Left undone.** The stored `videoTimestamp` is only shown as a tooltip on the
thumbnail — "jump to this moment" from a note is an explicit later lap. Stroke
state is `useState` copied per pointermove, which is fine for short freehand marks
but would want a ref + imperative paint if more tools land. Editing a note still
cannot replace or remove its screenshot; re-uploading for the same note id
overwrites server-side, but no UI reaches that path.

## 4. Review: annotation loop end to end

The review walkthrough is no longer just something you watch. The video in the review body now has its own controls — play, pause, a scrub bar and a clock — and once you pause on a frame that looks wrong, an Annotate button turns that frame into a drawing surface. You scribble on it in red, undo a stroke or clear the lot, type what you saw, and save. What you get back is an ordinary test note: it lands in the same list as anything you type by hand, toggles and promotes the same way, and carries two extra things — a thumbnail of the frame you drew on, and the moment in the video it came from.

The point of all that is what happens next. When you promote an annotated note, the fix ticket's context now names the picture and tells the agent to read it before starting, along with the timestamp it was taken at. The image itself is stashed outside the repo, keyed to the note, so it survives a review being re-run and never dirties your working tree. It also shows up as a path on the note's line in the feature's test-notes file, which means the lap-kickoff and revisit sessions can look at it too, not just the fix agent. So instead of writing three paragraphs describing a misaligned panel, you circle it.

The honest caveat is that the last link of that chain is broken on your machine. Copying the picture into the agent's workspace was built for the burn mode Linux hosts get; on Windows and macOS the default mode clones the workspace before the agent starts, and the picture — which is deliberately kept invisible to git — doesn't survive the clone. So on a default burn here, the ticket will confidently tell the agent to read a file that isn't there, and it will fall back to your text. It degrades rather than crashes, but the feature's whole reason for existing doesn't reach the agent yet. That's the one thing worth fixing before you trust the loop.

Beyond that, the notes cover a handful of tidiness issues from the code review — the screenshot's URL is spelled out by hand in three different files, there are two clock formatters that disagree past an hour, and the pen's red isn't the red in the design palette. None of them will bite you today.

Worth knowing about this review specifically: I could not drive the app. You have uncommitted work sitting in the checkout, and the drive refuses to switch branches over it, which is the right call — but it means nobody has actually watched the player scrub, the pen draw, or a thumbnail appear in a browser. The tests around all of it pass, and they are good tests: the upload and fetch round-trip, the picture being deleted along with its note, the exact wording of the promoted ticket, and the workspace copy all have real coverage, and the whole suite plus typecheck and build are green. But the parts a person has to see — the controls, the drawing, the thumbnail — are still unwitnessed. Commit or stash those two files and re-run this review if you want that closed.

## 5. Attachment survives the isolated burn; the info/exclude line is removed at cleanup

# Ticket 5 — attachments survive the isolated burn; the exclude line is unwound

**What was done.** `buildIsolatedSetupCommand` gained a step, right after the
`git clone`, that copies `.runcastle-attachments/` from the mounted workspace
into the container-native clone and re-writes the `.runcastle-attachments/`
line into the clone's own `.git/info/exclude`. The whole step sits inside an
`if [ -d ... ]; then ...; fi`, so the overwhelming majority of burns (no
attachments) run it as a no-op instead of a failure. The copy is
`cp -r <src>/. <dst>/` into an `mkdir -p`'d destination rather than
`cp -r <src> <dst>/`, which would nest if the destination ever existed. The
re-exclude in the clone is what stops the images riding the isolated mode's
landing path: that mode lands work by pushing the clone's commits back to the
workspace, and a clone does not inherit `info/exclude`.

On the cleanup side, `git.ts` gained `unexcludePath` — the symmetric
counterpart of `excludePath`, removing only whole lines equal to the pattern
and writing everything else back byte-for-byte (comments, the human's own
entries, CRLF endings), tolerating both an absent line and an absent file.
`clearAttachments` now takes the repo path as well as the workspace path and
calls it, so the exclude is undone on both the return and the throw path of the
burn. Both functions now ask git where `info/exclude` lives through one shared
`excludeFilePath` helper.

**Deviation from the ticket.** One extra change the ticket did not name but the
goal requires: `excludePath` was called at the top of `realExecuteTicketRun`,
before the conflict-resume branch that can return *without ever starting an
agent* — so on that path the line was added and never removed, i.e. exactly the
bug being fixed. The call moved to immediately before `run()`, where
`clearAttachmentsFor` already brackets it.

**Surprises.** The attachment-copy hook and the isolated setup script are on
opposite sides of a boundary the tests did not cross: the host hook is
platform-branched (cmd.exe vs sh) while the setup script is always sh, because
it runs in the linux container. The new "driven for real" tests exercise the
setup script by substituting its two hardcoded container paths
(`/home/agent/workspace`, `/home/agent/repo`) with temp dirs and running it —
which also means pointing `HOME`/`GIT_CONFIG_GLOBAL` at the temp dir, since
step 1 of the script does a real `git config --global` write. That block is
`describe.skipIf(win32)` (a Windows host has no sh); a platform-free assertion
on the built command covers the shape everywhere.

**Verification.** `bun run typecheck` clean. Full suite (`env -u GIT_ASKPASS
bun run test`, vitest from the repo root): 1924 passed, 4 skipped, **1 failed**
— `packages/server/test/dev-pane.test.ts > kills the child process tree so the
port-holder is not orphaned`, which asserts a spawned process group has been
reaped. It fails identically on a targeted run, is untouched by this diff, and
shares no import with it (pty/dev-pane vs. git/ticket-burner); it reads as this
container's process-reaping behaviour, not a regression. It is not in the
ticket's baseline list, which is otherwise stale in the other direction too
(baseline says 118 files/1768 tests, the branch now has 124/1929).

**Drive scripts.** No edit needed and none made: this ticket adds no service,
env var, seed, or long-running process — it changes a command string the burn
container runs. Per the hermetic rule I ran nothing under `.runcastle/`.

**Left undone.** Two things noticed and deliberately skipped. (1) The
conflict-resolver run still gets no attachments at all — already parked in
spec.md "Later laps". (2) `clearAttachments` on the throw path is awaited
without a guard: if the git call ever rejected there it would replace the
original run error. Left as-is because the surrounding catch already awaits
other git calls the same way; a guard belongs to a broader look at that handler.

## 6. Lap-1 review cleanup: single URL builder, one formatter, one predicate, node:path, palette red

# Ticket 6 — lap-1 review cleanup

## What was done

All five standards findings from the lap-1 review are fixed, plus the pen colour.

Two new modules landed in `@runcastle/core`, both in the isomorphic barrel rather than
beside `attachmentRelPath` in `paths.ts` — the ticket suggested either, but `paths.ts` is
Node-only and reached through a subpath export precisely so the browser never pulls
`node:os`/`node:path` in, and the web client is one of the three parties that has to import
the screenshot URL. `core/src/routes.ts` holds the route pattern once
(`NOTE_SCREENSHOT_UPLOAD_ROUTE`, and the GET route derived from it by appending `.png`) plus
two builders that fill `:noteId` into it; `core/src/format.ts` holds the surviving
hours-aware `fmtClock`. The Hono routes now register from the patterns, the service stamps
from `noteScreenshotUrl`, and the web upload posts to `noteScreenshotUploadUrl`.

In `services/test-notes.ts`, the hour-losing `clockTime` is deleted in favour of core's
`fmtClock` (so a 3700-second note reads `1:01:40` in the promoted ticket's context, matching
the player), and `screenshotParagraph` now reads the stamped `note.screenshotUrl` instead of
stat-ing the disk a second time — `rowToNote` is the single place presence is decided, and
its doc comment says so. Every note reaching `screenshotParagraph` comes through `getNote`,
so it does go through `rowToNote`; that is traced in the comment rather than left implicit.

`routes/reviews.ts` gained one generic `lookupOrUndefined` helper that both `findReviewTicket`
and `findNote` delegate to. The security property is untouched: the path is still
`annotationPath(note.id)` from the DB row, and the existing traversal tests (`..%2F..%2Fetc`
as `:noteId`) still 404.

`buildAttachmentCopyCommands` builds its destination with `node:path`. **Deviation worth
flagging:** the ticket said `join(dir, basename(src))`, but that function takes `platform` as
a *parameter*, so a plain `join` would answer with the host's separator — a forward slash in
a `cmd.exe` copy command whenever the suite runs on Linux, which is always here. It uses the
target platform's namespace instead (`win32.join` / `posix.join`, and their `basename`), which
removes the literal separator from *both* branches (the posix branch had a hardcoded `/` too)
and keeps the emitted command truthful about the shell it is written for. The consequence is
that the joined form equals the previous spelling exactly, so the test's expected literals did
not change — I sharpened its name and added a comment saying the literals are the target
platform's join output, rather than recomputing the expectation the way the code does.

`STROKE_COLOR` is now the palette's `#F85149`. The stroke test asserted the constant against
itself, which would let any future off-palette hex through, so it now asserts the literal.

One self-review fix on top: `REVIEWS_BASE` was exported from core but used only inside it —
a dead export guarding a drift it did not actually close, since `server/src/index.ts` still
mounted `'/api/reviews'` by hand. The mount reads the constant now.

## Surprises

- `packages/server/test/dev-pane.test.ts` › "kills the child process tree so the port-holder
  is not orphaned" **fails in this sandbox and is not mine**. It asserts a spawned PTY's
  process group is reaped within 400ms of `stopDevPane`. I confirmed it by checking out
  `675d756` (the pre-ticket commit) and running that one file: identical failure. It is not
  in the ticket's listed baseline, which was written against a smaller suite (118 files /
  1768 tests; the branch is now 126 / 1932). Everything else is green.
- Hono's route typing survives a route registered from a template-literal `const`
  (`NOTE_SCREENSHOT_ROUTE`) — TypeScript keeps the literal type, so `c.req.param('noteId')`
  still typechecks. That was the one risk in registering routes from constants.
- The `fmtClock` tests moved from `apps/web/test/format.test.ts` to
  `packages/core/test/format.test.ts` and gained the 3700-second case the finding was about.

## Left undone

- **The same duplication one function up in the same file.** `walkthroughUrl` in
  `routes/reviews.ts` hand-builds `/api/reviews/ticket/${id}/walkthrough.webm` while the route
  beside it registers `/ticket/:ticketId/walkthrough.webm` — exactly the shape of finding 1,
  and `core/src/routes.ts` is now the obvious home for it. The ticket named three files and
  the screenshot URL specifically, so I left it. It is a five-line follow-up in the module
  this ticket created. The feature listing URL (`/api/reviews/:featureId`, spelled in
  `apps/web/src/lib/reviews.ts`) is a third instance.
- The `rowToNote` per-row `existsSync` the lap-1 reviewer noted as an efficiency observation
  (one stat per note on every poll of `listByFeature`) is unchanged — converging the predicate
  onto the stamped field, as this ticket asked, does not remove that stat, it just stops a
  second one happening at promotion time.

## Verification

`bun run typecheck` clean across core, server, web, design-system and scripts. Full suite
(`env -u GIT_ASKPASS bun run test`, vitest from the repo root): 126 files, 1927 passed,
4 skipped, 1 failed — the pre-existing `dev-pane` failure above. Web build (`bun run
--filter '@runcastle/web' build`) succeeds. No `.runcastle/` drive-script change was needed:
this ticket adds no service, env var, seed or long-running process; I grepped
`drive-setup.ts` / `drive-stop.ts` for any coupling to the screenshot URL, annotations dir,
clock or pen and found none. I did not run them — the sandbox is hermetic, as intended.

## 7. Jump to this moment: an annotated note's timestamp seeks the player

# Ticket 7 — Jump to this moment

## What was done

An annotated note's stored timestamp is now a control. `seekTarget(seconds, {playable, annotating})`
in `apps/web/src/lib/walkthrough.ts` answers the whole question in one place: it returns `null` when
the human is mid-annotation (the frame must not move under a drawing) or when nothing is loaded to
seek within, and otherwise clamps the moment into `[0, playable]`, where `playable` is the existing
`playableDuration` — so a live-recorded WebM reporting `Infinity` is bounded by its seekable range,
and a timestamp past the end of a replaced recording lands on the last frame. Seven tests for it in
`apps/web/test/walkthrough.test.ts`, following lap 1's lib pattern.

The wiring is one hop, as the ticket described: `ReviewBody` holds a
`useRef<SeekWalkthrough | null>`, `WalkthroughPlayer` publishes its `jumpTo` into that ref in an
effect while mounted (and nulls it on unmount), and `NotesPanel` gets an optional `onJump` prop that
calls whatever is in it. `jumpTo` pauses first, then sets `currentTime` — the point of the jump is
to look at the frame. No new dependency, no context provider, no `useImperativeHandle`; the
`useCallback` + ref idiom matches `apps/web/src/lib/*.ts`. Styles are one `.note-at` rule in
`styles.css`, sized like the sibling `.note-ticket`.

Two small deviations from the letter of the ticket. First, the timestamp renders as a `<span>`
rather than a `<button>` when the page has no walkthrough player — annotated notes outlive their
recording (`reviews/<ticketId>/` is wiped on re-burn, `annotations/<noteId>.png` is not, decision
#4), so that state is real and a dead button there would be a lie. Second, self-review removed the
`, at 0:42` half of the thumbnail's tooltip: the ticket's own goal says the timestamp should stop
being tooltip metadata, and leaving it would have printed the same moment twice in one row.

## Surprises

The full suite has one failure that is not mine and not in the prompt's baseline:
`packages/server/test/dev-pane.test.ts > "kills the child process tree so the port-holder is not
orphaned"` — `expect(pidAlive(-pgid)).toBe(false)` gets `true`. It fails the same way on a targeted
run of that one file. This ticket's diff is five files, all under `apps/web/`, and that test
exercises the server's PTY teardown, so it cannot be reached from here; it reads as this sandbox's
process-group behaviour rather than a regression. Everything else is green: 124 files / 1934 tests
passed, typecheck clean across all four packages, `@runcastle/web` build succeeds.

No `.runcastle/` drive-script change was needed or made — this ticket adds no service, env var, seed
or long-running process, and the standing instruction's triggers are all structural. I did not run
those scripts (the sandbox has no docker, no host, no app) and did not need to read them beyond
confirming the triggers do not apply.

## Left undone

Nobody has watched this in a browser — the same gap lap 1's review left (its drive was refused over
uncommitted files). The seek is covered at the logic seam only; the ref handoff, the pause, and the
new row control are unwitnessed, and decision #13 makes the lap-2 drive the place that changes.

Deliberately not done: the player does not scroll into view when a note below it is clicked, so on a
long notes list the jump can happen off-screen. It is a real ergonomic gap and a one-liner
(`scrollIntoView` on the stage), but the ticket asked for a seek, not for scroll behaviour, and
stealing the viewport is the kind of thing worth deciding on purpose.

Also untouched: the scrub bar's own `seek` still guards `annotating` inline instead of going through
`seekTarget`. The two are not quite the same operation (the scrub is already bounded by the range
input's `max` and the control is disabled while annotating), and folding them together was more
surgery than this ticket asked for.

## 8. Review: lap 2 — burn path fixed, cleanup landed, and the loop finally witnessed in a browser

This is the lap where the annotation loop was finally watched working, in a browser, end to end — and it does work.

You can now pause the review walkthrough on the frame that bothers you, draw on it, type a sentence, and save. What lands is an ordinary test note that happens to carry a picture of the problem and the moment it happened. The player is yours now rather than the browser's: play, pause, a scrub bar that goes exactly where you put it, and a running clock. The pen draws in the palette's danger red — I sampled the pixels to be sure, because lap 1 had quietly invented its own shade. Undo takes back one stroke at a time. The thumbnail shows up in the notes list the instant you save, with no refresh, and the picture behind it is the real frame with your drawing baked in, not a reconstruction.

New this lap: a note's timestamp is a control. Click it and the walkthrough jumps to that moment and holds there — which turns a note from a description of something you saw into a way back to it. Sensibly, it stays inert while you are mid-drawing, so you cannot knock your own frame out from under you.

The important repair is one you will never see. Lap 1's screenshot never actually reached the fix agent on Windows or macOS, which is to say on the machine this is built on: the burn clones the workspace, and a deliberately-hidden image cannot survive a clone. That is fixed, and the fix goes one better by making sure the copied images cannot accidentally be committed on the other side either. The stray line the burner used to leave in your repository's git config — the one that would have quietly hidden any folder of that name from your own `git status`, forever — is now taken back out when the run ends, including when the run fails. Alongside that, five small tidiness items from the last review were cleared.

What is worth your attention. Nothing here is broken, and every finding I filed is small: two are documentation that has drifted from what the code now does, and the rest are tidiness. The one with any teeth is a race between two burns happening at once — they share a single line of protection, so the first one to finish takes it away from the other. It cannot bite you in the default mode on this machine, only on Linux, and the honest fix is probably to write down what actually happens rather than to build coordination for it.

Two things I did not do. I did not set off a real burn to watch the screenshot arrive inside a container — that would have started a second agent on your machine unattended, so I verified that path by reading it and by exercising its seams against a real repository instead. And getting to the point of driving at all took some doing: a review drive hands you an empty database, so a feature that only exists inside a review screen has nothing to show until you populate it by hand. That is very likely why this feature went two laps without anyone seeing it work, and it will catch the next reviewer the same way.

The suite, the typecheck and the web build are all green.
