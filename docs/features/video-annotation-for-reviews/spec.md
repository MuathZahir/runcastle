# Video annotation for reviews

## Problem

When the human test-drives a review and watches the agent's walkthrough video, they spot problems visually — a misaligned panel, a wrong state, a flash of broken layout. Today the only way to report what they saw is to describe it in a single-line text note, and that lossy prose is all the fix agent gets. The human ends up writing paragraphs to describe what a circled screenshot would say instantly, and the fix agent burns time reconstructing what "the button looks off in the header" means.

## Approach

The walkthrough video in the review body becomes an annotation surface. The human scrubs, pauses on the offending frame, hits **Annotate**, draws freehand on the frame, types a note, and saves. The saved thing is an ordinary test note — same lifecycle, same list, same promotion path — that additionally carries the video timestamp and a baked PNG of the annotated frame. When that note is promoted and its fix ticket burns, the PNG rides along: it is copied into the burner's workspace and the ticket context tells the agent to Read it.

This is a thin lap 1: the whole capture → note → burn loop, minimally furnished (see Later laps).

Lap 2 repairs what the lap-1 review found — the attachment never reached the agent under the default burn mode off-Linux, and the git exclude line outlived the burn — cleans up five standards findings, and promotes one deferred item: jump-to-moment from an annotated note.

### Player

The bare native `<video controls>` walkthrough player is replaced with minimal custom controls: play/pause, a scrub bar, current time / duration. No volume, fullscreen, or playback-rate controls — walkthroughs are silent screencasts. Native controls are dropped because they occlude the frame and block pointer events where the annotation overlay draws.

### Annotation overlay

When the video is paused, an **Annotate** button enables a canvas overlay sized to the video frame. Drawing is freehand strokes in one high-visibility color — the palette's danger red, `#F85149` (lap 2; lap 1's one-off `#ff2b2b` was off-palette) — with undo-last-stroke and clear. The overlay carries a note-text input and a save button. Save composites the paused frame plus the strokes into one flat PNG client-side (the video element is same-origin, so canvas capture is untainted), then submits text + timestamp + PNG in one action. Stroke/vector data is not persisted — the baked PNG is the artifact.

### Data model

`test_notes` gains a single nullable `videoTimestamp` column (seconds into the walkthrough). Nothing else changes in the schema: there is no attachments table, and no record of which walkthrough was annotated (the frame is in the PNG; a source-video id would be dead weight). The wire type gains `videoTimestamp` plus a server-stamped, disk-derived screenshot indicator/URL when listing — following the walkthrough precedent where the file's presence on disk is the record.

### Storage and serving

Screenshots live at `~/.runcastle/annotations/<noteId>.png` — outside the repo (working tree stays clean for drives) and outside `reviews/<ticketId>/` (which is wiped on re-burn). The reviews HTTP surface gains two small routes: an upload endpoint that accepts the PNG for a note, and a GET that serves it with the right content type. The notes list in the review body shows a thumbnail on annotated notes.

Deleting an annotated note deletes its PNG in the same service call — the one delete path is the one cleanup hook.

The screenshot URL is spelled once, in `@runcastle/core`, and imported by the service that stamps it, the route that serves it, and the web client that uploads to it (lap 2; lap 1 hand-spelled it in three files held in step by a test).

### Jump to this moment (lap 2)

An annotated note's timestamp is a control, not just metadata: clicking it in the notes list seeks the walkthrough player to the note's `videoTimestamp` and pauses there. No schema or wire change — the timestamp is already on the note and the player is already custom.

### Riding into the burn

Two extensions carry the screenshot downstream:

1. **Rendered markdown view.** The `test-notes.md` view (the contract read by lap-kickoff and revisit sessions) gains a `(screenshot: <absolute path>)` suffix on annotated note lines, so host-side sessions can Read the image directly.
2. **Burn-time copy.** When a promoted note-ticket burns, the burner workflow copies each existing `~/.runcastle/annotations/<noteId>.png` host-side into the ticket's workspace under a well-known relative directory (`.runcastle-attachments/<noteId>.png`); the ticket context generated at promotion names that relative path and instructs the agent to Read it. In the **isolated** workspace mode (the `burnWorkspace: 'auto'` default on Windows/macOS, where the agent works in a `git clone` of the mounted workspace), the container setup additionally copies `.runcastle-attachments/` from the workspace into the clone after cloning — a git-excluded file cannot survive the clone on its own, and lap 1 shipped without this, so the context named a path the agent could not reach on every default off-Linux burn. With the copy, the relative path in the context resolves identically in both modes; only the images the ticket references ship, with no container mounts or network plumbing.

   The `.runcastle-attachments/` line the burner writes into the repo's `.git/info/exclude` (load-bearing while the agent commits) is removed again by the post-run cleanup, restoring the file as found — lap 1 left it in place forever, silently hiding any such directory from the human's own `git status` in every worktree. The attachment directory itself is cleared from the workspace after the run, before any merge.

A missing PNG at burn time (manually deleted, disk loss) degrades gracefully: the ticket burns on text alone, same as an unannotated note.

## Seams

- **Test-notes service + `notes.*` tRPC router** *(existing)* — extended add/list/delete behavior: `videoTimestamp` accepted and returned, screenshot indicator stamped from disk, PNG deleted with its note. Observable end to end via tRPC.
- **Reviews HTTP routes** *(existing surface, new endpoints)* — PNG upload and serving keyed by note id. Observable with plain HTTP: upload then GET round-trip, 404 for absent, content-type correct.
- **Rendered `test-notes.md` view** *(existing contract, extended)* — annotated lines carry the `(screenshot: <path>)` suffix. Observable by mutating notes and reading the rendered file.
- **Promotion → ticket payload** *(existing)* — a promoted annotated note's ticket context names the attachment path and the Read instruction. Observable from the stored ticket rows.
- **Burner workspace preparation** *(existing workflow, new step)* — attachment copy-in before the agent starts, cleanup before merge. Observable by inspecting the prepared workspace in a workflow test.
- **Review body player + overlay** *(existing component, rebuilt)* — custom controls and annotation mode. Observable via e2e drive of the review UI; the capture action's output is verified at the HTTP seam above.

## Out of scope

- Recording human test drives — the player targets the existing review-agent walkthrough only.
- Agent-authored screenshots — `add_test_note` (MCP) stays text-only; annotation is a human act.
- Any change to note lifecycle semantics (toggle, promote, address-notes) beyond the payload extensions above.
- Vector/stroke persistence or post-capture editing.

## Open questions

None blocking. Sizing details (canvas resolution vs. video intrinsic size, PNG size ceiling) are left to implementation judgment — the walkthroughs are screen-sized and short, so any reasonable choice fits.

## Later laps

- Shape, arrow, and text drawing tools; multiple colors.
- Recording human test drives (its own capture/consent/storage question).
- Post-capture stroke editing (requires vector persistence).
- Multiple screenshots per note.
- Player polish: fullscreen, playback rate, keyboard shortcuts.
- Orphaned-PNG cleanup when notes vanish by routes other than `deleteNote` (feature/project deletion leaves screenshots on disk — noted by ticket 1's digest).
- Attachments for conflict-resolver runs (the second `run()` in the burner resolves merges from ticket text alone).
