# Why this feature exists

The automatic review workflow (shipped in `improve-workflow`) records a walkthrough video of the agent's browser review, and test notes already drive the whole fix loop. But watching the video and writing notes are disconnected acts: the human sees a problem at 0:42, then has to describe it in prose from memory. This feature closes that gap — annotate directly on the video, and the annotation becomes a test note carrying visual evidence.

**The full loop is in scope (the human's explicit call):** the annotated screenshot travels into the fix burn. When a note is promoted to a fix ticket, the burner agent gets the image — "this button, circled, at 0:42" is worth more to a fix agent than prose. Annotation that dies at the human's screen is half the value.

# What is already true (verified against code and docs — build on it, don't re-decide it)

- **Videos are per review ticket**, streamed from `/api/reviews/ticket/:ticketId/walkthrough.webm` (`packages/server/src/routes/reviews.ts`). The file under the ticket's `reviewDir` (`~/.runcastle/reviews/<ticketId>/`) IS the record — no DB row. The listing endpoint returns `{ticketId, seq, hasVideo, videoUrl}` per ticket.
- Today there is **one review ticket per feature** — "multiple review tickets covering different areas" was explicitly deferred in `docs/features/improve-workflow/` (later laps). This feature must handle multiple videos *structurally* (the player takes the per-ticket listing) but build no multi-video UX polish.
- **The no-video case is already settled** (`docs/features/improve-workflow/decisions.md` #8): non-browser reviews produce no video; absence is a normal state, not an error; notes remain the deliverable. Inherit this: when there is no video, the annotation surface simply doesn't render and the existing notes-only review layout stays. Do not invent artifacts for non-UI reviews.
- **Test notes are the vehicle** (`decisions.md` #1): notes already feed promote note → fix ticket → burn. Annotations must ride this existing pipeline — a new note field/attachment, not a new concept. The `add_test_note` MCP tool and the test-notes schema (`packages/core/src/db-schema.ts`) are the surfaces to extend.
- The current player is a bare native `<video controls preload="metadata">` in `apps/web/src/components/bodies/ReviewBody.tsx` — the custom player is genuinely new work, and a different review-screen layout is expected (video-first with a notes rail, or similar; design call for ideation).

# The shape

1. **Custom player** in the review screen: scrub, pause, draw/mark on the paused frame (canvas overlay), attach note text.
2. **Capture**: saving composites the paused frame + drawing into a screenshot (canvas), stores it, and creates a test note carrying the image reference and the video timestamp.
3. **Full loop**: promoting that note to a fix ticket makes the image readable by the sandboxed burner agent and referenced in the ticket prompt. Open design question for ideation: where the image lands so the sandbox can read it (reviewDir is host-side; the burner runs in a sandbox — mount, copy-in, or serve; decide there, mindful of ADR-0004/0005 workspace rules).
4. **Layout**: the review screen likely needs a rethink to be video-first when a video exists — that design belongs to ideation, informed by the existing ReviewBody structure.

# What this feature must NOT swallow

- The deferred "multiple review agents / review tickets per feature" work — structural support only, no UX for it.
- Any change to how the review agent records (agent-browser record start/stop stays as-is).
- General video-editing features: trimming, exporting, clipping, speed controls beyond a normal player.
- Redesigning the review workflow or its outcomes (Merge / Fix / Rethink stay untouched).
- The test-drive notes UX beyond what attaching an image requires.
