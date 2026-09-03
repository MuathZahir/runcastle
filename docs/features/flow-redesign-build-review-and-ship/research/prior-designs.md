# Reconciling the prior designs and audit findings with what is built

> Waypoint 1 (research) of `flow-redesign-build-review-and-ship`. Read before the
> walk waypoints: this is the list of things the walk should *look for*, and the
> list of things it does not need to re-derive.

## Answer

Almost everything the seven prior designs promised is in the code — the gaps are
narrow and specific, not broad. The annotation loop in particular is
**mechanically complete and witnessed working in a browser** (video-annotation
lap 2, 2026-08-20), so the human's "doesn't work well and isn't very user
friendly" is an *ergonomics* complaint about a working loop, not a broken one:
the player sits sixth down a seven-card page, the pen is one red freehand line
with no shapes or eraser, a drawing cannot be saved without typing a one-line
note, and the jump-back control scrolls nowhere. Of the audit findings, F3, F8,
F21, F22, F23 and F25.1 are genuinely closed in code and F12 is closed except
its "expected duration" half. All three `ux-issues` "left undone" items are
**confirmed still open**, and this research found two further live defects in
the same family (an orphaned fix ticket makes its defect vanish from the review
page; three ReviewBody cards ignore `readonly`).

---

## 1. `video-annotation-for-reviews` — the deepest treatment

Shipped 2026-08-20 over two laps. Docs: `brief.md`, `decisions.md` (13),
`spec.md`, `outcome.md` (7 tickets + 2 review sections), `test-notes.md`.

### 1.1 What the design promised

| # | Promise | Where |
|---|---|---|
| 1 | Custom player: play/pause, scrub, time/duration. No volume, fullscreen or rate. | dec. 6, spec §Player |
| 2 | Annotate only on a paused frame; canvas overlay sized to the frame; freehand red only; undo-last-stroke; clear. | dec. 6 |
| 3 | Save composites frame + strokes into one flat PNG client-side; stroke/vector data not persisted. | dec. 3 |
| 4 | The saved thing is an **ordinary test note** — same list, same toggle/promote lifecycle — plus a timestamp and a thumbnail. | dec. 1, 6 |
| 5 | Data model: one nullable `videoTimestamp` column; no attachments table; screenshot existence *is* disk presence, stamped onto the wire type. | dec. 5 |
| 6 | PNGs at `~/.runcastle/annotations/<noteId>.png` — outside the repo and outside the re-burn-wiped `reviews/<ticketId>/`. Two HTTP routes (upload, serve). | dec. 4, spec §Storage |
| 7 | `test-notes.md` annotated lines carry a ` (screenshot: <absolute path>)` suffix. | dec. 5 |
| 8 | Promotion names `.runcastle-attachments/<noteId>.png` and tells the agent to Read it; the burner copies the PNG in, and copies it again into the clone in isolated mode; the `info/exclude` line is unwound at cleanup. | dec. 4, 9, 10, spec §Riding into the burn |
| 9 | Deleting an annotated note deletes its PNG. No source-video tracking — the timestamp is not tied to a walkthrough. | dec. 7 |
| 10 | Jump to this moment: clicking a note's timestamp seeks the player and pauses. | dec. 12 |
| 11 | Deferred to later laps: shapes/arrows/text/colours, recording human drives, post-capture stroke editing, multiple screenshots per note, fullscreen/rate/keyboard, orphan-PNG cleanup on feature/project delete, attachments for conflict-resolver runs. | dec. 8, spec §Later laps |

### 1.2 The annotation data model, as built

**Storage of a frame/timestamp/drawing/note — the whole chain:**

1. **Drawing** lives only in React state while the overlay is open:
   `Stroke = readonly Point[]`, `Point` in the video's *intrinsic* pixel space
   (`apps/web/src/lib/walkthrough.ts:18-24, 32`). `framePoint()` maps client
   coordinates back through the CSS downscale (`walkthrough.ts:84-99`). Pen is
   one constant, `STROKE_COLOR = '#F85149'` (palette danger red, lap 2) at
   `STROKE_WIDTH = 4` frame pixels (`walkthrough.ts:30-38`). **Strokes are never
   persisted** — as designed (dec. 3).
2. **Frame + drawing → PNG**: `captureAnnotation()` sizes an off-screen canvas
   to `videoWidth/videoHeight`, `drawImage`s the paused frame, repaints the
   strokes with the *same* `paintStrokes()` the overlay uses, and `toBlob`s
   `image/png` (`walkthrough.ts:128-155`). Same-origin video, so the canvas is
   untainted.
3. **Note first, PNG second**: `saveAnnotatedNote()` creates the note, then
   uploads — the PNG is keyed by the note id so the order is forced. A failed
   upload is reported, never rolled back (`walkthrough.ts:167-188`).
4. **Timestamp** rides `notes.add` as `videoTimestamp: video.currentTime`
   (`WalkthroughPlayer.tsx:216`), validated `z.number().nonnegative().optional()`
   (`trpc/routers/test-notes.ts:33-42`), stored in a `real` column (migration
   0027 — sub-second scrub survives), returned on the wire as
   `TestNote.videoTimestamp` (`packages/core/src/schemas.ts:354`).
5. **PNG bytes** POST raw to `/api/reviews/note/:noteId/screenshot`
   (`lib/reviews.ts:53-61` → `routes/reviews.ts:205-217`). The route rejects a
   body whose first 8 bytes are not the PNG signature (400) because the GET
   labels its response `image/png` unconditionally. `attachScreenshot()` writes
   the file, emits `note.screenshot`, re-renders `test-notes.md`.
6. **Existence is disk presence**: `rowToNote()` stamps
   `screenshotUrl: existsSync(annotationPath(row.id)) ? noteScreenshotUrl(id) : undefined`
   (`services/test-notes.ts:48-62`). No row, no reconciliation. One `stat` per
   note per list call — a known, unfixed efficiency observation.
7. **Path safety**: both routes resolve the file path from the *looked-up row's
   own id*, never from the URL segment (`routes/reviews.ts:190-192, 231-241`);
   traversal ids 404. Verified live by the lap-2 reviewer.
8. **URL spelled once**: `packages/core/src/routes.ts` holds
   `NOTE_SCREENSHOT_UPLOAD_ROUTE`, `NOTE_SCREENSHOT_ROUTE` and the two builders;
   route, service and web client all import them.

**Rendering:**

- Thumbnail: `note.screenshotUrl` → an `<a target="_blank">` wrapping an `<img>`
  in the note row (`ReviewBody.tsx:527-540`), capped `max-height: 34px /
  max-width: 60px` (`styles.css:2299-2309`). Clicking opens the full PNG in a
  browser tab — there is no in-app viewer.
- Timestamp: rendered `fmtClock(moment)` as a `<button class="note-at">` when a
  player is on the page and a plain `<span>` when not
  (`ReviewBody.tsx:545-563`). Clicking calls the player's published `jumpTo`
  through a ref held by `ReviewBody` (`ReviewBody.tsx:157`, published at
  `WalkthroughPlayer.tsx:143-151`); `seekTarget()` returns `null` while
  annotating or before anything is loaded, and otherwise clamps into
  `[0, playableDuration]` (`walkthrough.ts:67-81`).

**Downstream:** `noteLine()` appends ` (screenshot: <absolute path>)`
(`services/test-notes.ts:404-412`); `promotionTicket()` adds a third context
paragraph naming `.runcastle-attachments/<id>.png`, the Read instruction and the
`m:ss` clock (`services/test-notes.ts:270-303`); the burner scans that path back
out of `ticket.context` (`attachmentSources`), copies via
`hooks.host.onWorktreeReady` with a platform-branched command, re-copies and
re-excludes inside the clone in isolated mode
(`workflows/ticket-burner.ts:1171-1178, 1400-1461, 3306-3320`), and unwinds the
`info/exclude` line on both the return and throw paths.

### 1.3 Where the code diverges from its spec

**It does not diverge much.** Every numbered promise above is in the code, and
the lap-2 review drove it and verified the pen colour at the pixel, the undo
stroke count, the 302KB PNG, the round-trip, the seek-and-pause, the delete
cascade and the promoted ticket's wording (`test-notes.md` lap 2, note 38-40).
The divergences are these:

| Divergence | Detail |
|---|---|
| Two deliberate additions the ticket did not name | `playableDuration()` falls back to `seekable.end()` because a live-recorder WebM reports `duration: Infinity` until fully read; and Annotate is gated on `loadeddata`/`canplay` because `drawImage` of a video with no decoded frame silently bakes a blank PNG. Both documented in `outcome.md` §3. |
| Upload returns JSON, not 204 | The client needs `screenshotUrl` back to render the thumbnail without a refetch. Documented. |
| Clone-side re-exclude is undocumented | `buildIsolatedSetupCommand` also writes `.runcastle-attachments/` into the *clone's* `.git/info/exclude`. Neither dec. 9 nor spec §Riding into the burn mentions it. (lap-2 review finding, still open — a docs amendment.) |
| `unstageable` claim is overstated | `excludePath`/`unexcludePath` resolve `info/exclude` against the **common** git dir, so concurrent mounted-mode burns share one line and the first to finish strips the other's only protection mid-run. dec. 10 calls the worst case "briefly visible in `git status`"; it is actually "an agent's `git add -A` can commit the PNGs". Isolated mode (the Windows/macOS default) is immune. Still open; the honest fix is wording. |
| `unexcludePath` is not byte-for-byte | A file with no trailing newline comes back with one. Its own doc comment promises otherwise. Low severity, still open. |
| `walkthroughUrl` is still hand-spelled | `routes/reviews.ts:35` builds `/api/reviews/ticket/${id}/walkthrough.webm` against a route registered separately at `:161`; `apps/web/src/lib/reviews.ts:39` re-spells `/api/reviews/${featureId}`. `core/src/routes.ts`'s own header names the walkthrough and then omits it. Still open. |
| Exclude *pattern* spelled four times | `${ATTACHMENTS_DIR}/` re-derived at `ticket-burner.ts:1178, 1384, 1461, 3316` — one of them inside a shell string a typechecker cannot see. Still open. |
| `findNote` is a pure pass-through | Since `lookupOrUndefined` was extracted, `routes/reviews.ts:190-192` adds nothing. Still open. |
| Dead `basename` import | `ticket-burner.ts:2`. Still open. |
| Conflict-resolver runs get no attachments | Parked in spec §Later laps; unchanged. |
| Orphan PNG cleanup | Deleting a feature or project leaves its notes' PNGs on disk. Parked in spec §Later laps; unchanged. |

### 1.4 Where the loop breaks down as an *experience* — the redesign's real material

None of these is a spec violation. All of them are why the human says the flow
"isn't very user friendly", and each is a decision this flow's design owes an
answer to.

1. **The video is the sixth thing on the page.** `ReviewBody` renders, in order:
   SessionPanel → ConflictCard → DriveFailureCard → the Summary/Test-drive grid
   → OpenDefects → PlannedNextLapCard → DrivePane → **WalkthroughCard** →
   NotesPanel (`ReviewBody.tsx:160-247`). The card the human is meant to
   *annotate from* is below everything. `brief.md` for the annotation feature
   explicitly anticipated a "video-first" layout as a design call for ideation;
   nobody made it.
2. **Jump-to-moment can jump off-screen.** The note list is below the player, so
   clicking a timestamp on a long list seeks a player the human cannot see. The
   ticket-7 author flagged this deliberately: "the player does not scroll into
   view… stealing the viewport is the kind of thing worth deciding on purpose"
   (`outcome.md` §7 Left undone). Still undecided.
3. **A drawing cannot be saved without text.** Save is
   `disabled={!text.trim() || saving}` (`WalkthroughPlayer.tsx:337`). Circling a
   thing and saving is not a path; the human must always type.
4. **The note is a single-line `<input>`; Enter saves.** No multi-line
   observation is possible at capture time (`WalkthroughPlayer.tsx:307-320`).
5. **Annotate is disabled, not explained.** While playing, the button is greyed
   with a `title` tooltip ("pause on the frame you want to draw on") —
   `annotateHint()` at `WalkthroughPlayer.tsx:54-58`. A disabled control whose
   only explanation is a hover is exactly the "randomly not existing" pattern
   `ux-issues` dec. 10 removed elsewhere.
6. **One pen, one colour, no eraser, no redo.** Undo-last-stroke and clear-all
   only. dec. 8 parks shapes/arrows/text/colours; the human's complaint is the
   evidence that lap 1's "thin" pen is now the friction.
7. **No frame-accurate control.** Scrub `step={0.05}`, no keyboard shortcuts, no
   frame step, no fullscreen. Picking the exact frame of a flicker is hard.
8. **Cancel silently discards.** `stopAnnotating()` clears strokes and text with
   no confirmation (`WalkthroughPlayer.tsx:165-169`), and `Escape` in the note
   input fires it (`:316`).
9. **Stroke state is copied per `pointermove`.** `extendStroke` rebuilds the
   stroke array on every move event and re-renders (`WalkthroughPlayer.tsx:181-186`);
   the outcome names a ref + imperative paint as the fix if more tools land.
10. **Annotated notes lose their evidence at triage.** `AddressNotesDialog`
    renders `note.text` and an author chip only — no thumbnail, no timestamp
    (`AddressNotesDialog.tsx:96-107`). The picture that justified the note is
    invisible at the moment the human decides what to do with it.
11. **A note's timestamp is not bound to a video (dec. 7), and the player is not
    lap-scoped.** From lap 2 the page shows the *last* walkthrough with a
    recording across all laps (see §7), so clicking a lap-1 note's `0:42` seeks
    lap 2's video to 0:42 — a frame that has nothing to do with the note. The
    baked PNG is still correct; the jump is not. dec. 7 traded this away when
    one video per feature was the only case.
12. **A review-drive database starts empty.** The lap-2 reviewer had to
    hand-seed the throwaway drive DB (projects, feature, tickets, a real
    `walkthrough.webm`) before there was anything to annotate — "the reason a
    UI-only feature went two laps unwitnessed" (`test-notes.md` lap 2, note 37).
    Not this flow's code, but it is what the redesign's own review will hit.

---

## 2. `review-findings-are-fixed-in-run` (shipped 2026-08-28, lap 1)

**Promised:** typed `defect`/`observation` findings via a new `report_finding`
MCP tool (review sessions only, `add_test_note` withdrawn); defects mint fix
tickets at report time, capped at 8, `blockedBy` the review ticket; the burner
admits them mid-run so one run finishes once; the human arrives to digest +
computed counts line + only still-open defects with per-row Dismiss; the
next-step primary is "Fix N open defects"; human notes render compact and are
never touched by agents.

**Built:** all of it. `review_findings` table + service with `AUTO_FIX_CAP`;
`report_finding` run-scoped; `burnTickets` re-reads the feature's tickets when a
review ticket goes terminal and folds in newly-pending ones; `WorkflowCtx` gained
optional `listTickets`/`updateFinding`; `findings` tRPC router with
`listByFeature`/`dismiss`/`fixOpenDefects`; `FindingsSummaryBlock` +
`OpenDefectsCard` in `ReviewFindings.tsx`; the `fixDefects` branch of
`resolveReview` sits immediately after the conflict branch
(`next-step/review.ts:95-129`); `headline()` gives every note a one-line
disclosure.

**Gaps:**

- **An orphaned fix ticket makes its defect vanish** — the defect its own review
  reported and nobody fixed. `defectState()`
  (`services/review-findings.ts:191-198`): a finding at `fixing` whose ticket is
  `failed` or `cancelled` falls through to
  `finding.status === 'open' || 'failed' ? 'open' : 'fixing'` → `'fixing'`, so
  it is counted out of both `open` and `fixed` and dropped from `openDefects`.
  `sweepOrphanedBurning()` (`services/tickets.ts:260-278`) marks the ticket
  `failed` through `updateTicket` directly and never mirrors onto the finding.
  The review that shipped the feature reproduced this and called it out
  ("a count that quietly drops a defect is worse than the wall of prose this
  feature replaced"); the code is unchanged.
- **Nothing renders a `fixing` defect.** While a fix wave burns, the counts line
  says only "N defects found". Acknowledged in `outcome.md` §3; unchanged.
- **The cap of 8 lives twice** — `AUTO_FIX_CAP` and the review prompt's prose.
- **Findings order is not stable** (`createdAt` ms + random nanoid id), so two
  findings reported in the same millisecond swap places between refetches.
- **`findings.listByFeature` polls on every phase**, not only at review.

---

## 3. `laps` / ADR-0010 + SPEC §15

**Promised:** three verbs from review (Fix / Rethink / Merge, later renamed
Iterate in copy); `lap` counter + columns, no laps table; G3 scoped to the
current lap; a lap kickoff `revisit` session; test-drive notes per lap; a lap
chip / lap trail.

**Built:** the loop is complete. `rethink()` guards phase, active run, live
session and active test drive, then bumps the lap;
`rethinkAndLaunch()` rolls the flip back and emits `lap.aborted` when the launch
throws (`services/features.ts:768-834`). The bar's three verbs live in
`resolveReview` (`next-step/review.ts`), labelled **Iterate** with the internal
`rethink` kind kept for timeline continuity. `lapBanner()` renders from lap 2
(`feature-ui/laps.ts`), `groupByLap` + `LapSections` group notes and the ticket
ledger, `isLapDivider` renders `lap.started` as a feed divider
(`lib/activity.ts:110-122`). `lapAccount(tickets, feature.lap)` is lap-scoped.

**Gaps:**

- **The review row is not lap-scoped while the block below it is** — see §7.
  This is the single largest lap gap and the one the brief named.
- **`## Later laps` in laps' own spec, item "Trail"** asked for a per-lap burn
  summary ("lap 2: 4 tickets, 4 done"). `lapBanner.landed` gives the *previous*
  lap's done count only; the run/burn view (`RunBody`) has no lap grouping of
  lanes at all.
- SPEC §15.6 named a **notes box on the test-drive panel**; it lives on the
  review body instead — a deliberate change (`test-drive-improvements` dec. 4)
  and correct, but SPEC §15.6 was never amended.
- SPEC §15.6's **per-note "→ ticket"** was deliberately removed by `ux-issues`
  dec. 11 in favour of the Address-notes dialog; SPEC §15.6 still describes the
  old shape.

---

## 4. `make-test-drive-clear` (brief only — no spec, decisions or outcome)

**Promised:** one short explanation on the review phase page of what a test drive
actually does, differing on whether preparation has run.

**Built, and better than asked.** `testDriveExplainer(caps)`
(`lib/vocabulary.ts:75-104`) composes the sentence from the project's real
capabilities — checkout always, then "runs the test-drive setup command" and/or
"starts the dev server with an Open app link" if configured, then what Stop
restores (teardown command or not). With no commands set it says so and points at
Preparation. `driveCapabilities()` reads the three settings keys
(`lib/prep-findings.ts:113-124`). Rendered in the Test-drive card
(`ReviewBody.tsx:210-213`).

**Gaps:** the explainer only renders in the *idle* branch — once a drive is live
the card shows `DriveStatus` and the explanation is gone. Nothing says the drive
holds a singleton slot shared with preparation's dry run until you are refused.

---

## 5. `test-drive-improvements`

**Promised:** notes as DB rows with `test-notes.md` as a rendered view; capture
available for the whole review phase; open ⇄ done, promoted frozen; mechanical
one-click promotion; an informational "N open notes" line in the merge
confirmation; **no embedded browser**.

**Built:** all of it. `services/test-notes.ts` owns the lifecycle, emits per
mutation, and regenerates `test-notes.md` under ascending `## Lap N` headings;
`assertOpen` enforces the freeze; `promotionTicket()` is the mechanical template
(provenance + doc pointers + the note verbatim + one acceptance criterion);
`mergeSummary` pushes `${open} open test-drive note(s)` as a warning
(`feature-ui/summary.ts:145-147`). No iframe anywhere.

**Gaps:**

- **dec. 5's one-click per-note promotion is gone** — superseded on purpose by
  `ux-issues` dec. 11 (batch triage in one dialog). `promoteNote` survives for
  the MCP wire. Worth recording that dec. 5 is *history*, not a live contract.
- **dec. 2 "checklist render in the review UI" is now lap-grouped**, and the
  lap-trail visual dec. 2 deferred is still deferred.

---

## 6. `fix-merge-conflict-system`

**Promised:** resolve sessions may write while `MERGE_HEAD` exists; a
`merge.resolved` event emitted at session end when the base is now an ancestor;
Merge & ship never disabled (an enabled "Retry Merge & ship"); Burn reachable
during a conflict; both launch sites carry the resolve purpose.

**Built:** all four. `routes/hooks.ts:329` emits `merge.resolved`;
`unresolvedMergeConflict` clears on `burn.started` **or** `merge.resolved`
(`feature-ui/gates.ts:85-96`); the conflict branch of `resolveReview` keeps
Resolve primary and offers `Retry Merge & ship` + Burn + drive + Address notes +
Iterate as enabled secondaries (`next-step/review.ts:69-91`); both the review
card (`use-resolve-conflict.ts`) and the run lane (`RunBody.tsx:341-360`) pass
`purpose: 'resolve-conflict'` with a `mergeFrom`/`mergeInto` pair.

**Gaps:**

- **A successful merge does not clear the conflict.** `feature.merge` emits
  `feature.shipped` via `setPhase` on success (`routers/feature.ts:245-247`) —
  neither `burn.started` nor `merge.resolved` — so `unresolvedMergeConflict`
  keeps returning the old conflict forever on a shipped feature. This is the
  mechanism behind the `ux-issues` "conflict card in the shipped view" item
  (§7.2): the card is not merely rendered in a read-only view, its state is
  *never* retired.
- The spec's own note — that the ticket-landing probe must check the branch pair
  the session was launched about — is honoured via `purposeData`; no gap found.

---

## 7. `ux-issues` "left undone" — confirmed or refuted

### 7.1 Cross-lap review pick — **CONFIRMED**

`reviewOutcome()` picks `tickets.filter(kind === 'review').at(-1)` with no lap
filter (`feature-ui/review.ts:100`); `reviewChecks()` passes the whole batch
through it (`:171-186`); `reviewWalkthroughUrl()` takes the last artifact with a
video (`:128-130`). `lapAccount(tickets, feature.lap)` **is** lap-scoped
(`feature-ui/laps.ts:64-76`). So from lap 2, until that lap's own review runs,
the summary row says "ran · N findings" about lap 1 while the block under it
correctly renders nothing — and `NO_REVIEW_ROW` ("no review ran this lap", the
row `ux-issues` dec. 9 exists to make loud) can never fire again once any lap has
reviewed. `Workspace.tsx:114` feeds the same unscoped `reviewOutcome` into the
merge dialog's status line, so the last catch inherits the blindness.

*Blocker for the fix:* the artifacts wire type carries no lap —
`ReviewTicketArtifacts` is `{ ticketId, seq, hasVideo, videoUrl }`
(`routes/reviews.ts:39-46`). The ticket rows behind it **do** carry `lap`, so
adding `lap` to that listing is a one-line server change, not a schema change —
cheaper than the ticket-11 author assumed.

### 7.2 Conflict card live in the read-only shipped view — **CONFIRMED**

`ReviewBody` renders `{conflict && <ConflictCard …/>}` at line 169 with no
`readonly` guard, and `ConflictCard`'s "Resolve with agent" button is
unconditional (`ReviewBody.tsx:796-859`). A shipped feature viewed at the review
step gets `readonly = true` (`pipeline.ts:99-101`) and still reaches this branch
(`Workspace.tsx:701`). Combined with §6's finding that a successful merge never
clears the conflict, a feature that once conflicted and then shipped shows a red
"Merge conflict" panel with a live agent-launching button in its history view,
forever.

**Two more of the same family, not previously recorded:** `DriveFailureCard`
(`ReviewBody.tsx:178`) and `StopReviewDrive` (`:217`) also render without
consulting `readonly`, while `SessionPanel`, `OpenDefects`, `PlannedNextLapCard`,
`NotesPanel` and `WalkthroughPlayer` all honour it. The prop is threaded
inconsistently through one component.

### 7.3 Batch-promote does not append a review ticket — **CONFIRMED**

`ux-issues` dec. 9: "Every lap's ticket batch includes a review ticket… 'No
review happened' stops being a silent state." `quickReviewTicket()` enforces it
on the quick-change door in code (`services/features.ts:305-352`, the only
`kind: 'review'` mint in the server). `freezeAsTickets()` — the body behind both
`promoteNote` and `promoteMany` — calls `storeTickets` with
`promotionTicket()` per note and nothing else
(`services/test-notes.ts:319-352`), so the Address-notes "quick fixes" road
produces a batch that burns and returns to review having never been reviewed.
`promoteOpenDefects()` (`services/review-findings.ts:262-292`) has the same
shape, which is arguably fine — those tickets came *from* a review — but it is
the same hole in the same invariant, and the flow's design should say which
reading it takes.

---

## Still open — the list this flow inherits

**Correctness (server + derivations)**

1. `reviewOutcome` / `reviewChecks` / `reviewWalkthroughUrl` are not lap-scoped
   while `lapAccount` is. Needs `lap` on `ReviewTicketArtifacts` and a decision
   about what the row says on a lap whose review has not run. *(§7.1)*
2. An orphaned or cancelled fix ticket leaves its finding at `fixing`, so the
   defect disappears from both the counts line and the open list.
   `defectState` / `sweepOrphanedBurning`. *(§2)*
3. A successful merge emits neither `burn.started` nor `merge.resolved`, so a
   resolved-and-shipped conflict is never retired from the event derivation.
   *(§6)*
4. `promoteMany` (and `promoteOpenDefects`) mint fix batches with no review
   ticket, against `ux-issues` dec. 9. *(§7.3)*
5. `readonly` is honoured by five of eight ReviewBody cards; ConflictCard,
   DriveFailureCard and StopReviewDrive ignore it. *(§7.2)*
6. Mounted-mode concurrent burns share one `info/exclude` line; the first
   cleanup strips the other burn's only protection. Docs overstate the safety.
   *(§1.3)*

**Annotation-loop ergonomics (this flow's stated priority)**

7. The walkthrough card is sixth on the page; no video-first layout was ever
   designed. *(§1.4.1)*
8. Jump-to-moment does not bring the player into view. *(§1.4.2)*
9. A drawing cannot be saved without typed text; the note field is one line.
   *(§1.4.3-4)*
10. Annotate is disabled-with-a-tooltip while playing. *(§1.4.5)*
11. One red freehand pen; no shapes, arrows, text, colours, eraser or redo.
    *(§1.4.6)*
12. No frame-accurate seeking, keyboard shortcuts or fullscreen. *(§1.4.7)*
13. Cancel discards strokes silently; `Escape` fires it. *(§1.4.8)*
14. `AddressNotesDialog` shows neither thumbnail nor timestamp. *(§1.4.10)*
15. A note's timestamp is not bound to a walkthrough, and the player is not
    lap-scoped — cross-lap jumps land on the wrong frame. *(§1.4.11)*
16. Stroke state is copied per `pointermove`. *(§1.4.9)*

**Tidiness / docs**

17. `walkthroughUrl` and the feature-listing URL still hand-spelled in two files
    each, in the module that claims to spell them once. *(§1.3)*
18. `${ATTACHMENTS_DIR}/` re-derived in four places, one of them in a shell
    string. *(§1.3)*
19. `findNote` is a pure pass-through; `basename` import is dead. *(§1.3)*
20. `unexcludePath` adds a trailing newline its doc promises it will not. *(§1.3)*
21. The clone-side re-exclude is real and documented nowhere. *(§1.3)*
22. `AUTO_FIX_CAP` is spelled in code and in the review prompt's prose. *(§2)*
23. Findings order is unstable within a millisecond. *(§2)*
24. `findings.listByFeature` and `notes.list` poll on every phase, not only
    review. *(§2)*
25. `RunBody` lanes show no per-ticket digest, though `the-work-record-gets-thick`
    dec. 9 names both `TicketsBody` **and** `RunBody`. Only `TicketsBody`
    renders one (`TicketsBody.tsx:221-225`); `RunBody` shows the run-level
    aggregate (`RunBody.tsx:110`, `RunDigest`) and nothing per lane. *(§8 below)*
26. `laps` spec §Later laps "per-lap burn summary" and lap grouping of run lanes
    are unbuilt. *(§3)*
27. SPEC §15.6 still describes the notes box on the test-drive panel and the
    per-note "→ ticket", both superseded. *(§3)*
28. `testDriveExplainer` disappears once a drive is live. *(§4)*

**Not gaps — verified closed, do not re-litigate**

The player's mechanics (controls, pen colour at the pixel, undo, capture,
upload, thumbnail, delete cascade, seek-and-pause, promotion wording,
`test-notes.md` suffix, isolated-mode copy) were all driven and confirmed in a
browser by the lap-2 review. The walk waypoints should spend their time on the
*ergonomics* list, not on re-proving these.

---

## Audit findings — closed or not (checked in code, not by ticket status)

`identify-random-issues-throughout-the-system` shipped its fixes as its own
tickets (dec. 1). There is no `outcome.md` for it, so every verdict below is read
off the current code.

| Finding | Verdict | Evidence |
|---|---|---|
| **F3** Iterate during a test drive wedges the feature | **Closed, all four sub-fixes** | (a) `rethink()` refuses while `git.activeTestDriveFeatureId() === featureId` (`services/features.ts:789-793`); (b) `rethinkAndLaunch()` restores lap + phase and emits `lap.aborted` on launch failure (`:815-834`); (c) the bar disables Iterate with "Stop the test drive first — the branch is checked out" (`next-step/review.ts:38-48`); (d) `ensureTalkWorktree` re-checks-out a registered-but-detached worktree before falling back to `worktree add` (`services/git.ts:487-495`), and `addWorktree` retries through `prune` + `reclaimOrphanedWorktree`. |
| **F8** Next-step recommends Merge & ship over a live conflict | **Closed** | The conflict branch runs first and makes Resolve the primary; Merge drops to "Retry Merge & ship" (`next-step/review.ts:56-91`). The card carries `recorded {relTime} ago` with an exact-datetime tooltip (`ReviewBody.tsx:826-831`) — the missing timestamp half of the finding. Both the bar and the card read one derivation (`unresolvedMergeConflict`), which is what makes the contradiction unrepresentable. |
| **F12** Burn copy explains "what" not the mechanics | **Closed except duration** | `BURN_EXPLAINER` = "Burning runs each ticket as its own sandboxed agent, in parallel, committing to the feature branch." (`lib/vocabulary.ts:51-55`), rendered in `TicketsBody` and the `RunBody` empty state. Parallel ✓, sandboxed ✓, commits on the feature branch ✓. The finding also asked for "expected duration" — nothing says it anywhere. |
| **F21** Merge & ship is one unconfirmed click | **Closed** | `MergeFeatureDialog` (`components/MergeFeatureDialog.tsx`) renders `mergeSummary()`'s rows (commits, run, drive, review) plus one warning line per gap — unknown/zero commits, no run or a non-succeeded run, never test-driven, a review that could not run, N open notes, deferred `## Later laps` scope (`feature-ui/summary.ts:98-162`). Deliberately lighter than the delete dialog: friction is reading, not typing. |
| **F22** Test drive fakes success with no dev command | **Closed** | `DriveStatus` has three states; with no `devPaneId` it says "checked out — nothing started" and, when `devConfigured` is false, "no server was started: this project has no dev command. Set one in Settings…" (`ReviewBody.tsx:718-760`). `DrivePane` returns null without a real `devPaneId`, so the pulsing chip cannot exist over a process that was never spawned (`:936-938`). `testDriveExplainer` says the same before the click. |
| **F23** Review SUMMARY shows wrong data in green | **Closed** | Commits come from `feature.commitCount` (git `rev-list`), not ticket commit rows (`ReviewBody.tsx:86-90`, `services/git.ts:1046`). `commitRow` reports `idle` for unknown and `warn` for zero (`feature-ui/review.ts:47-55`); `ticketRow` gives 0/0 `idle` not `ok`; `runRow` gives "no run recorded" `idle`. "Checks are in" only when `run` exists (`next-step/review.ts:176-186`). `ui.tsx:728` — "absence is grey, never green". |
| **F25.1** "Burn 0 tickets" as an enabled primary | **Closed** | `resolveImplementation` returns a `WAITING` / "No tickets to burn" step at `t === 0`, whose primary opens or resumes a session instead (`next-step/implementation.ts:17-41`). |

---

## Sources

- Repo docs read in full: `docs/features/{video-annotation-for-reviews,
  review-findings-are-fixed-in-run, laps, make-test-drive-clear,
  test-drive-improvements, fix-merge-conflict-system, the-work-record-gets-thick,
  ux-issues, identify-random-issues-throughout-the-system}/*.md`;
  `docs/SPEC.md` §15; `apps/web/STYLE.md`.
- Code read: `apps/web/src/components/{WalkthroughPlayer,AddressNotesDialog,
  MergeFeatureDialog,Workspace}.tsx`, `components/bodies/{ReviewBody,RunBody,
  ShippedBody,TicketsBody}.tsx`, `apps/web/src/lib/{walkthrough,reviews,
  vocabulary,activity,use-resolve-conflict,prep-findings}.ts`,
  `apps/web/src/lib/feature-ui/{review,laps,summary,gates,pipeline,
  next-step/*}.ts`, `apps/web/src/styles.css`;
  `packages/core/src/{routes,format,paths,schemas}.ts`;
  `packages/server/src/{routes/reviews,services/test-notes,
  services/review-findings,services/features,services/tickets,services/git,
  trpc/routers/{feature,test-notes},workflows/ticket-burner}.ts`.
- The `duration: Infinity` behaviour `playableDuration()` works around is a known
  property of browser-written WebM (metadata written first, no duration in the
  header), with the `seekable`/`currentTime` workarounds documented at
  [Mozilla bug 1385699](https://bugzilla.mozilla.org/show_bug.cgi?id=1385699),
  [Chromium 642012](https://bugs.chromium.org/p/chromium/issues/detail?id=642012)
  and [addpipe: Duration in WebM videos produced by Chrome](https://blog.addpipe.com/duration-in-webm-videos-produced-by-chrome/).
  No other external source was needed — this question is entirely about
  reconciling this repo's own designs with its own code.

## Open questions

- **Was `identify-random-issues-throughout-the-system` ever merged as one
  feature?** It has no `outcome.md`, so its ticket-by-ticket record is not on
  disk. Every verdict above is read off current code, which is what the waypoint
  asked for, but if a ticket "closed" a finding by a route other than the code
  cited here, this doc cannot see it.
- **Does `playableDuration`'s `seekable` fallback actually fire for
  agent-browser recordings?** The lap-2 drive measured a finite 909.5s span from
  a *copied, fully-written* `.webm`, so the `Infinity` branch is unwitnessed.
  A walk should open a review whose recording was just written.
- **Does `preload="metadata"` reliably reach `loadeddata`?** The `ready` gate on
  Annotate depends on it; the lap-2 drive got there, but on one browser only. If
  it does not, the first click on Annotate is a disabled button — worth one
  explicit check in the walk.
- **Which reading of `ux-issues` dec. 9 does this flow take?** "Every lap's
  ticket batch includes a review ticket" — literally (batch-promote appends
  one), or "every batch an *agent* emits" (quick-change is the exception that
  already needed code)? A design call, not a research one.
- Not chased, worth their own waypoints if the flow wants them: the empty
  review-drive database (§1.4.12) and the `styles.css` retirement inventory
  (153 of 719 top-level selectors match this flow's prefixes — a count, not an
  audit).
