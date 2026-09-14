## Why this feature exists

The review page's current layout (designed by `flow-redesign-build-review-and-ship`, decision 18) stacks everything vertically: stage on top, then alert slot, status strip, the merged "open work" notes/defects panel, and collapsed prose. The consequence the human hit in practice: the notes panel lives below the fold, so annotating and triaging during a test drive means scrolling the stage out of view — the exact failure decision 21(e) declared dead for the walkthrough player ("annotating never requires scrolling the frame out of view") but which was never extended to the live test-drive stage.

Two connected asks, one layout change:

1. **Expandable stage.** The integrated test-drive component (the live embedded drive with annotation tools) can expand to near-fullscreen. Annotation tools, and the notes rail, must remain visible and usable in the expanded state — expansion is for working, not just viewing. The walkthrough player already has an F-fullscreen key (decision 21a); whether the live drive shares that mechanism or gets its own expand affordance is a design question for the grill.
2. **Notes always on the side.** On the review page the notes panel ("open work" — notes and review-agent defects share it per decision 18c) moves from a below-the-stage band to a persistent side rail. The human should never scroll down to reach notes while driving or watching. The UI should stay clean and simple — this is a layout pass, not a feature-add.

## What is already settled

- This **revises decision 18** of `flow-redesign-build-review-and-ship` (band ordering: open work below the stage). Record the revision explicitly in this feature's decisions; the rest of decision 18 (what the bands contain, chip strip semantics, merged open-work anatomy) stands.
- Decision 21(e)'s principle — stage + controls fit the viewport together, annotation never scrolls the frame away — is the north star and now applies to the live drive too.
- Decision 23's note-row anatomy (thumbnail, timestamp jump, edit-in-place, lightbox) is unchanged; rows just live in the rail.

## Design questions for the grill (not settled here)

- What "almost fullscreen" means: does the expanded state keep the status strip / alert slot visible, or hide everything but stage + rail + annotation tools?
- Is the side rail permanent at all times, or does it collapse at narrow widths / normal (non-expanded) state?
- Does the walkthrough player's stage get the identical expand treatment as the live drive (they likely share stage layout code)?
- Where the annotation toolbar docks in expanded mode.

## What this must NOT swallow

- The walkthrough player's transport/scrub internals (decision 21 a–d).
- Notes triage semantics — promote/"to ticket", defect lifecycle, lap carry.
- Anything server-side. This is `apps/web` layout and stage sizing only.

## Adjacency warning

`project-level-test-drive` is in flight (ideation). If it reuses the review stage / drive component, the second of the two to land eats the merge conflict on that surface — coordinate landing order.
