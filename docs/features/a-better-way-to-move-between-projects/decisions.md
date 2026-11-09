# Decisions — A better way to move between projects

## 1. Three directions get mocked up
**Decision:** Design mode renders three directions with fake data, each as a choice (a Tweak) on the same design pages — desktop sidebar, "All projects", and phone width — so the human flips between them on one screen:
1. **Better dropdown** — same spot; most recent first, a needs-you / running mark per project, type to filter, Ctrl+1–9 to jump.
2. **Project rail** — a thin always-visible strip of project initials/icons at the far left with live badges; one click switches; on phone a strip across the top.
3. **Accordion sidebar** — every project lives in the one sidebar; only the current one is open, the rest are one line each with their badge.

The brief's "every project's features shown at once" form is dropped: at seven projects it is a wall of rows, and the accordion keeps what is good about it.
**Why:** The human wants to compare directions themselves before anything is built; one page per screen with the direction as a switch keeps the comparison side by side.
