# PhaseIcon

A feature's pipeline phase as a 16px progress glyph — shape first, hue second.

Draft is a dashed ring, ideation an empty ring, spec a quarter, tickets a half, implementation three-quarters, review a ring with a centre dot, shipped a filled check. Hue follows the `phase-*` tokens (neutral → `warning` → `accent` → `success`), so the phases stay distinct without colour.

**Consumer provides** `phase` (`draft · ideation · spec · tickets · implementation · review · shipped`) and optional `size`. It labels itself for screen readers.

**Replaces** the coloured phase pills, the "shipped" mono tag before titles, and the per-row check-circle buttons in the sidebar.
