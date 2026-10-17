# PhaseStepper

The feature's pipeline as a compact inline stepper in the page header: done steps show the check glyph, the current step its own glyph in `text`, future steps a dashed ring.

**Consumer provides** `phase` (current) and optional `viewing` (a past step being inspected, shown with `surface-selected`), optional `steps` to shorten the list.

**Do** place it once, in the page header, left-aligned under or beside the title. Clicking a past step opens it read-only in place; the stepper itself says which step you're viewing, so no "READ-ONLY" badge or "Back to …" link is needed beyond one ghost button.
