# Expandable review stage with persistent side notes

## Problem

During a test drive or walkthrough on the review page, annotating means working the "open work" panel — but that panel sits in a band below the stage, below the fold. Every note written or triaged scrolls the stage out of view, which is exactly the failure decision 21(e) of `flow-redesign-build-review-and-ship` forbade for the walkthrough player ("annotating never requires scrolling the frame out of view") but never extended to the live drive. The walkthrough's existing F-fullscreen makes it worse, not better: it native-fullscreens only the video frame, hiding the transport bar, markers, and Annotate button — a viewing mode when the human needs a working mode.

## Approach

From the user's side: notes are always beside the stage, and the stage can grow to almost the whole window without losing them. Two connected layout changes, no new features:

**Permanent notes rail.** The review page stops being one centered scrolling column and adopts the workspace's existing two-pane mode (the same pattern the grill page uses: fixed-width side pane beside a flex-1 main pane, each with its own scroll). The rail holds the merged "open work" panel — notes and review-agent defects per decision 18c, note-row anatomy per decision 23 unchanged — plus the note composer, and is present at all times. The main column keeps the remaining bands in their decision-18 order: alerts, stage, status strip, drive instructions, carried findings, collapsed prose. This is a recorded revision of decision 18's band ordering; everything else in decision 18 stands. The rail gets its own width token (`--notes-rail-w`, default ~360px) and is drag-resizable and persisted through the same rail machinery the other workspace rails use. No collapse toggle and no responsive breakpoints; narrow widths degrade via flex as the grill page does.

**Expandable stage.** One expand/collapse mechanism, owned by the evidence-stage layer above both players, identical for the live drive and the walkthrough — whatever the stage currently shows is what expands, and switching sides while expanded stays expanded. Expanded state is a CSS overlay (`fixed inset-0` over the workspace), not the native Fullscreen API: it contains only the stage (flex-1, no aspect-ratio/max-height clamp) and the notes rail; status strip, alerts, instructions, carried findings, and app chrome are hidden. The affordance is an expand/collapse control on the stage bar plus the F shortcut; Escape also collapses. The walkthrough player's `requestFullscreen` F-key behavior is deleted — F retargets to the shared expand, behind the same guards as today (not while annotating, not while typing). Annotation tools need no special handling: the drive's toolbar is already an overlay inside the stage, and the walkthrough's transport rides along because the overlay wraps the whole player, not just the video frame.

**Consequential cleanups the layout change forces.** The two cross-jump behaviors that assume a single page scroller (note row → stage, stage marker → note row) must target the correct scroll container each now lives in — the note-to-stage jump largely dissolves since the stage is always visible; the stage-to-note jump scrolls within the rail. The duplicated 16:9 wrapper (same aspect/max-height class string on both the walkthrough frame and the drive wrapper) should unify in the stage layer as part of moving expansion there, so the expanded-state sizing exists once.

A validated interactive mockup of both states lives at `docs/features/expandable-review-stage-with-persistent-side-notes/prototypes/review-stage-prototype.html` (built with the real theme tokens; the human approved the layout from it). It is a reference for look and interaction, not code to port.

## Seams

- **Review page render tree** (existing) — the component-test seam for layout: rail present in both states, open-work panel and composer inside it, main-column band order preserved, no open-work band below the stage.
- **Stage expand state** (new, but at the existing evidence-stage boundary) — observable as DOM state: expanded shows stage + rail only; collapse restores the full page; expand survives switching drive ↔ walkthrough; entered/exited via control click, F, and Escape.
- **Keyboard handler of the walkthrough player** (existing) — F now toggles the shared expand and no calls to the native Fullscreen API remain; existing guards (annotating, typing) still bail; the rest of the transport keys are untouched.
- **Rail width machinery** (existing) — `--notes-rail-w` participates in the same drag/persist mechanism as the other workspace rails.
- **Cross-jump behaviors** (existing) — note-row activation still seeks/stages the right recording; marker-to-note spotlight scrolls the rail, not the page.

## Out of scope

- Walkthrough transport/scrub internals (decision 21 a–d) beyond retargeting the F key.
- Notes triage semantics — promote/"to ticket", defect lifecycle, lap carry.
- Note-row anatomy (decision 23) — rows move, they do not change.
- Anything server-side; this is `apps/web` layout and stage sizing only.
- Responsive breakpoints or a rail collapse mechanism.

## Open questions

- Landing-order coordination with `project-level-test-drive` (in ideation): if it touches the review stage / drive component, the second feature to land absorbs the merge conflict. Not blocking; noted for the human.
