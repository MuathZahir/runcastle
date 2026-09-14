# Decisions — expandable-review-stage-with-persistent-side-notes

## 1. One lap, spec whole
**Decision:** The feature is specced whole as a single lap — no map, no thin walking-skeleton lap.
**Why:** Pure `apps/web` layout pass with a well-formed brief and settled constraints (decisions 21e/23 of `flow-redesign-build-review-and-ship`). The only residual uncertainty is visual feel, which the post-burn test drive evaluates better than a partial lap would.

## 2. Notes rail is permanent, via the existing twoPane pattern
**Decision:** The review page adopts `Workspace`'s `twoPane` mode permanently. The notes rail (the "open work" panel — notes + defects per decision 18c — plus the note composer) is always present, in both normal and expanded states, with its own scroll. The main column keeps alerts, stage, status strip, drive instructions, carried findings, and collapsed prose. No collapse toggle, no responsive breakpoints; narrow widths degrade via flex, same as the grill page.
**Why:** A sometimes-absent rail re-creates the "where are my notes" problem; permanence keeps the expanded state simple (same rail, bigger stage). Reuses the proven grill-page rail pattern (`GrillBody` + `ArtifactPane`) instead of inventing one. The app has zero breakpoints today and this is a desktop tool — a collapse mechanism would be feature-add in a layout pass.

## 3. Expanded state = CSS overlay with stage + rail only
**Decision:** The expanded state is a CSS overlay (`fixed inset-0`) covering the workspace, containing only the stage (flex-1) and the notes rail. Status strip, alert slot, drive instructions, carried findings, and app chrome are hidden while expanded. Not the native Fullscreen API. "Near-fullscreen" means browser chrome and the notes rail stay; everything else goes.
**Why:** `requestFullscreen` shows only the fullscreened element — the rail and the walkthrough transport bar would vanish, which is the current F-key's exact flaw (viewing mode, not working mode). A CSS overlay keeps the rail and React state mounted and gets Escape-to-exit for free. Any band inside the expanded state would shrink the stage, defeating the point; urgent events surface through existing async channels and collapsing back is one keypress. Annotation tools need nothing special: the drive toolbar is already an in-stage overlay, and the walkthrough transport rides along because the overlay wraps the whole player.

## 4. One expand mechanism at EvidenceStage level; F retargets, native fullscreen deleted
**Decision:** Expand/collapse is owned by `EvidenceStage`, identical for both the live drive and the walkthrough player — whatever the stage shows is what expands. One expand/collapse control on the stage plus the F shortcut, working the same on both sides. The walkthrough's `requestFullscreen` F-key behavior is deleted, not kept alongside. Expand state lives at the review-page level, so switching drive ↔ walkthrough while expanded stays expanded.
**Why:** Two different "fullscreens" on one stage is a trap, and native fullscreen is strictly worse for working (hides the transport, can't show the rail). Owning the state above both players means neither duplicates the mechanism and content-switching is free.

## 5. Rail width: own token, ~360px default, drag-resizable
**Decision:** The notes rail gets its own width token (`--notes-rail-w`), default ~360px, drag-resizable and persisted via the same rail machinery as the grill page's artifact pane. Same width applies in normal and expanded states.
**Why:** 360px fits the decision-23 note-row anatomy without starving the stage at typical window widths; resizable because note-heavy vs screenshot-heavy sessions want different widths, and the drag-rail machinery already exists — reuse, not feature-add.

## 6. Revision of flow-redesign decision 18 (recorded per the brief)
**Decision:** This feature revises decision 18 of `flow-redesign-build-review-and-ship`: the "open work" panel moves from a band below the stage to the permanent side rail. The rest of decision 18 stands — band contents, chip strip semantics, merged open-work anatomy (18c), and the remaining band order in the main column (alerts, stage, status strip, instructions, carried findings, collapsed prose). Decision 21(e)'s no-scroll principle now covers the live drive, and decision 23's note-row anatomy is unchanged — rows just live in the rail.
**Why:** The below-the-stage band put notes below the fold, forcing the exact scroll-away failure 21(e) forbade for the walkthrough player; extending that principle to the live drive is the brief's north star.
