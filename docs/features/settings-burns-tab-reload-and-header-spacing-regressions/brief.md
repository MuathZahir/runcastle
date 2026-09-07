# Settings Burns tab reload and header spacing regressions

## Ticket 1

Clicking the "Burns" tab in the settings panel triggers a full page navigation/reload instead of switching the tab, so the tab is unreachable. Likely an <a href> without preventDefault or a routing bug in the settings panel (apps/web/src/components/settings/). Fix it so the tab switches in place like the others; check the other settings tabs for the same pattern.

## Ticket 2

Feature header alignment regressions (apps/web feature header + pipeline stepper): the status tag (draft/shipped, rendered in mono) is not baseline-aligned with the feature title next to it — it sits visibly high; and the pipeline stepper row is indented so its first item does not start on the title's left edge. Align the tag to the title baseline and the stepper to the title's left edge. Screenshots from the human show both on shipped and draft features.

## Ticket 3

The Quick change / Park a draft dialog has uneven vertical rhythm: the gap above the Title field label is much larger than the gaps between subsequent fields, and the footer row (branch info + Cancel/Create) sits tight against the divider. Even out the spacing using the theme scale (see apps/web/STYLE.md).
