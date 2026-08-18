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
