# Decisions — A better way to move between projects

## 1. Three directions get mocked up
**Decision:** Design mode renders three directions with fake data, each as a choice (a Tweak) on the same design pages — desktop sidebar, "All projects", and phone width — so the human flips between them on one screen:
1. **Better dropdown** — same spot; most recent first, a needs-you / running mark per project, type to filter, Ctrl+1–9 to jump.
2. **Project rail** — a thin always-visible strip of project initials/icons at the far left with live badges; one click switches; on phone a strip across the top.
3. **Accordion sidebar** — every project lives in the one sidebar; only the current one is open, the rest are one line each with their badge.

The brief's "every project's features shown at once" form is dropped: at seven projects it is a wall of rows, and the accordion keeps what is good about it.
**Why:** The human wants to compare directions themselves before anything is built; one page per screen with the direction as a switch keeps the comparison side by side.

## 2. The project rail wins, and it is calm
**Decision:** Build the project rail: a thin always-visible column of project tiles at the far left, left of the sidebar; on phone a row of the same tiles across the top of the list screen. It is calm, not Slack-like: tiles are monochrome letters on the sidebar's own background (no per-project colours, no count bubbles); the only mark is a small amber dot on a project that needs you, and none on the current project; what is running elsewhere shows only in the hover card. The current project is the one prominent tile.
**Why:** The human liked the rail (one click to switch, every project's state always in view) but found the first mock "very cluttered with many colors, many bubbles, many notification indicators"; the sidebar before was "very clean, professional", and the rail has to keep that.
