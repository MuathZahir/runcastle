# Decisions — video-annotation-for-reviews

## 1. Lap 1 is thin: prove the whole loop, defer polish
**Decision:** Lap 1 ships the minimal end-to-end loop — pause the review video, draw freehand on the frame, attach a note, and have the captured annotated frame reach the fix-burn agent. Player polish, extra drawing tools, and multi-annotation ergonomics are consciously deferred to later laps.
**Why:** The unproven, risky part is the capture → note → burn plumbing (nothing today carries an image into a burn); the player itself is commodity. Test-driving the core loop early beats gold-plating a player around an unproven pipeline.

## 2. Lap 1 annotates the review agent's walkthrough video only
**Decision:** The annotation player targets the existing review-agent walkthrough (`~/.runcastle/reviews/<ticketId>/walkthrough.webm`). Human test drives remain unrecorded and out of scope.
**Why:** Walkthrough recording, storage, and range-request serving already exist end to end. Recording live human drives is its own sizeable feature (capture source, consent to record the human's browser, storage) and would swallow this one.

## 3. The annotated artifact is a baked PNG, one per note, with timestamp metadata
**Decision:** At capture, the client composites the paused video frame plus the drawing into one flat PNG — that image is the artifact. The video timestamp is stored alongside the note as metadata; stroke/vector data is not persisted.
**Why:** The consumers are the fix-burn agent (Reads an image) and the human (glances at a thumbnail). Vector storage would drag in a re-render pipeline for zero lap-1 value; post-capture stroke editing is a later-laps luxury. The timestamp is cheap and enables a future "jump to this moment".

## 4. Screenshots are copied into the sandbox workspace at burn time; stored note-keyed under ~/.runcastle/annotations/
**Decision:** PNGs live at `~/.runcastle/annotations/<noteId>.png` — outside the repo and outside the re-burn-wiped `reviews/<ticketId>/` dir — served to the web UI by a small new HTTP route. When a promoted note-ticket burns, the workflow copies that note's PNG into the ticket's workspace (e.g. `.runcastle-attachments/<noteId>.png`) and the ticket context tells the agent to Read it there.
**Why:** Copy-at-burn works identically under docker and noSandbox, ships only the images the ticket references, and needs no container mount or network plumbing. Note-keyed storage survives review re-burns (reviewDir is wiped) and keeps the working tree clean for drives.

## 5. Minimal data model: one nullable `videoTimestamp` column; screenshot existence is disk presence
**Decision:** `test_notes` gains a single nullable `videoTimestamp` column (seconds into the walkthrough). No attachments table. The screenshot's existence is `~/.runcastle/annotations/<noteId>.png` being on disk — the server stamps a computed `hasScreenshot`/URL onto the wire type when listing, following the walkthrough's no-DB-row precedent. The rendered `test-notes.md` view (contract read by lap-kickoff and revisit sessions) carries a `(screenshot: <absolute path>)` suffix on annotated note lines so host-side sessions can Read the image too.
**Why:** One screenshot per note is already locked, so the note id is a sufficient key; an attachments table would be generality we've deferred. Disk-presence matches the existing walkthrough pattern, and the markdown suffix extends the screenshot's reach to every downstream reader, not just the fix burn.

## 6. Minimal custom player controls; red freehand pen; save creates an ordinary test note
**Decision:** The walkthrough player gets minimal custom controls (play/pause, scrub bar, time/duration — no volume/fullscreen/rate). When paused, an Annotate button enables a canvas overlay sized to the video: freehand strokes in one high-visibility color (red), undo-last-stroke, clear. The overlay carries a note-text input; save composites frame + strokes into the PNG client-side and creates one ordinary human test note (current lap) with text + timestamp + screenshot, landing in the existing notes list with a thumbnail.
**Why:** Native `<video controls>` sit where you'd draw and block pointer events to an overlay. An annotated note being just a test note means toggle/promote/address-notes all work untouched. Arrows, boxes, text tools, multi-color are later-lap polish.

## 7. Edge cases: PNG deleted with its note; no source-video tracking
**Decision:** Deleting an annotated note also deletes `~/.runcastle/annotations/<noteId>.png` (hooked in the test-notes delete path). The note does not track which walkthrough video its timestamp refers to.
**Why:** Orphan cleanup is one line in the one delete path. The baked PNG is self-contained — the frame is in the artifact — so a timestamp going stale against a replaced/newer walkthrough costs nothing real; a source-video id would be dead weight.

## 8. Later laps (consciously deferred)
**Decision:** Deferred to later laps: shape/arrow/text drawing tools and colors; recording human test drives; "jump to this moment" from a note's timestamp; post-capture stroke editing; multiple screenshots per note; player polish (fullscreen, playback rate).
**Why:** Lap 1 proves the capture → note → burn loop; all of these are additive polish on a proven pipeline.

## Lap 2

Lap 1's review found the loop broken at its last link on the machines this repo is developed on, plus a permanent git-config side effect and five tidiness smells. The browser drive never ran (uncommitted files in the checkout), so the UI half of the loop is still unwitnessed. Lap 2 is a fix-and-verify lap, plus one cheap promotion from Later laps.

## 9. Isolated burns copy the attachments into the clone (supersedes the "identical under docker and noSandbox" claim in #4)
**Decision:** `buildIsolatedSetupCommand` copies `.runcastle-attachments/` from the mounted workspace (`/home/agent/workspace`) into the container-native clone (`/home/agent/repo`) after the `git clone`, when the directory exists. The relative path named in the ticket context then resolves identically in both workspace modes; the promotion wording stays mode-unaware.
**Why:** The lap-1 review proved the default Windows/macOS burn (`burnWorkspace: 'auto'` → `isolated`) git-clones the workspace, and an untracked, git-excluded PNG cannot survive a clone — the ticket context pointed the agent at a file that wasn't there on every default burn on this host. One extra copy command in the setup script keeps the path contract single-spelling; the alternative (mode-aware promotion wording) would leak a burn-time decision into promotion time.

## 10. The `info/exclude` line is removed at post-run cleanup (supersedes the open-ended exclude in lap 1's implementation)
**Decision:** The burner still writes `.runcastle-attachments/` into the repo's `.git/info/exclude` before copying attachments in, but the post-run cleanup (`clearAttachments`, which already runs after `run()` returns or throws) also removes that exact line, restoring the file as found. The concurrent-burn race (one burn's cleanup un-excluding another's live directory) is accepted — the worst case is the attachments dir briefly visible in `git status`, and annotated-note burns are rare.
**Why:** The exclude is load-bearing during the run (the agent commits, and sandcastle preserves dirty worktrees), but `info/exclude` resolves against the common git dir, so lap 1's never-removed line silently changed the human's own checkout — every worktree, forever. Symmetric add/remove keeps the protection and drops the pollution.

## 11. Lap-1 review tidiness is fixed as one cleanup pass; the pen red becomes palette `#F85149`
**Decision:** One cleanup ticket fixes the five standards findings: the burn copy destination built with `node:path` `join` instead of a hand-concatenated `\\`; the screenshot URL spelled once in `@runcastle/core` (the `attachmentRelPath` treatment) and imported by service, route, and web client; one seconds-to-clock formatter in core replacing the two divergent copies; one "has a screenshot?" predicate in the test-notes service; a shared lookup-or-undefined helper replacing the duplicated NotFound-catch in `routes/reviews.ts`. `STROKE_COLOR` changes from `#ff2b2b` to the palette's `#F85149`.
**Why:** All five are small, none behavioral, and bundling them keeps the lap's ticket count honest. The palette stays exhaustive rather than growing undocumented one-off hexes — `#F85149` is plenty visible over video frames.

## 12. "Jump to this moment" is promoted from Later laps
**Decision:** An annotated note's stored timestamp becomes a control: clicking it in the notes list seeks the walkthrough player to that `videoTimestamp` and pauses there. Everything else in Later laps stays parked.
**Why:** The two halves already exist — the timestamp is stored and the player is ours to command — so this is glue, not scope. It also makes lap 2's re-drive more useful: the drive that finally witnesses the player working can witness the seek too.

## 13. Lap 2's review must actually drive
**Decision:** The lap-2 review ticket requires the browser drive (lap 1's was refused over uncommitted files — the human commits or stashes `packages/server/src/services/git.ts` and `packages/server/test/project-session.test.ts` before Burn). The review ticket's runner instructions are corrected: the suite is vitest from the repo root, not `bun test` in `packages/server` (which hangs with no output).
**Why:** The player, the pen, the thumbnail, and now the timestamp-seek have never been seen working in a browser; tests cover the seams but not the experience. The wrong-runner instruction cost the lap-1 reviewer ten minutes of dead time.
