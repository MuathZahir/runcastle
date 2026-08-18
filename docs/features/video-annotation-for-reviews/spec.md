# Video annotation for reviews

## Problem

When the human test-drives a review and watches the agent's walkthrough video, they spot problems visually — a misaligned panel, a wrong state, a flash of broken layout. Today the only way to report what they saw is to describe it in a single-line text note, and that lossy prose is all the fix agent gets. The human ends up writing paragraphs to describe what a circled screenshot would say instantly, and the fix agent burns time reconstructing what "the button looks off in the header" means.

## Approach

The walkthrough video in the review body becomes an annotation surface. The human scrubs, pauses on the offending frame, hits **Annotate**, draws freehand on the frame, types a note, and saves. The saved thing is an ordinary test note — same lifecycle, same list, same promotion path — that additionally carries the video timestamp and a baked PNG of the annotated frame. When that note is promoted and its fix ticket burns, the PNG rides along: it is copied into the burner's workspace and the ticket context tells the agent to Read it.

This is a thin lap 1: the whole capture → note → burn loop, minimally furnished (see Later laps).

### Player

The bare native `<video controls>` walkthrough player is replaced with minimal custom controls: play/pause, a scrub bar, current time / duration. No volume, fullscreen, or playback-rate controls — walkthroughs are silent screencasts. Native controls are dropped because they occlude the frame and block pointer events where the annotation overlay draws.

### Annotation overlay

When the video is paused, an **Annotate** button enables a canvas overlay sized to the video frame. Drawing is freehand strokes in one high-visibility color (red), with undo-last-stroke and clear. The overlay carries a note-text input and a save button. Save composites the paused frame plus the strokes into one flat PNG client-side (the video element is same-origin, so canvas capture is untainted), then submits text + timestamp + PNG in one action. Stroke/vector data is not persisted — the baked PNG is the artifact.

### Data model

`test_notes` gains a single nullable `videoTimestamp` column (seconds into the walkthrough). Nothing else changes in the schema: there is no attachments table, and no record of which walkthrough was annotated (the frame is in the PNG; a source-video id would be dead weight). The wire type gains `videoTimestamp` plus a server-stamped, disk-derived screenshot indicator/URL when listing — following the walkthrough precedent where the file's presence on disk is the record.

### Storage and serving

Screenshots live at `~/.runcastle/annotations/<noteId>.png` — outside the repo (working tree stays clean for drives) and outside `reviews/<ticketId>/` (which is wiped on re-burn). The reviews HTTP surface gains two small routes: an upload endpoint that accepts the PNG for a note, and a GET that serves it with the right content type. The notes list in the review body shows a thumbnail on annotated notes.

Deleting an annotated note deletes its PNG in the same service call — the one delete path is the one cleanup hook.

### Riding into the burn

Two extensions carry the screenshot downstream:

1. **Rendered markdown view.** The `test-notes.md` view (the contract read by lap-kickoff and revisit sessions) gains a `(screenshot: <absolute path>)` suffix on annotated note lines, so host-side sessions can Read the image directly.
2. **Burn-time copy.** When a promoted note-ticket burns, the burner workflow looks up the ticket's source note(s), copies each existing `~/.runcastle/annotations/<noteId>.png` into the ticket's workspace under a well-known relative directory (e.g. `.runcastle-attachments/<noteId>.png`), and the ticket context generated at promotion names that relative path and instructs the agent to Read it. Copy-at-burn works identically under docker and noSandbox and ships only the images the ticket references — no container mounts, no network plumbing. The attachment directory is cleaned out of the workspace before commit/merge so it never lands in the repo.

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
- "Jump to this moment" — seeking the player from a note's stored timestamp.
- Post-capture stroke editing (requires vector persistence).
- Multiple screenshots per note.
- Player polish: fullscreen, playback rate, keyboard shortcuts.
