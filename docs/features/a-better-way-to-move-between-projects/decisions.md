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

## 3. No hover card on the rail
**Decision:** Hovering a rail tile shows no card of the project's features. It shows only the project's full name, in the app's own small tooltip style. What is running elsewhere is no longer shown on the rail at all; the "All projects" page carries it. The rail's needs-you dot is unchanged. Supersedes the "running shows only in the hover card" part of 2.
**Why:** The human: the card's colour "doesn't match with anything", "it's pretty big and covers too much. I don't think we even need it." The name still has to be reachable, since two-letter tiles are ambiguous (runcastle and runcastle-demo).

## 4. The approved rail look
**Decision:** The human approved both design pages (`apps/web/preview/project-switching.html`, `apps/web/preview/all-projects.html`) as the look to build. Tiles show two letters (one for a one-word name) and the needs-you mark is a dot. Unselected tiles sit slightly left in a dimmer grey; the selected tile alone is bright, on a quiet filled surface that glides to the new tile on switch (~¼ s ease-out, instant under reduced motion); no edge bar. The focus ring shows for keyboard focus only. "All projects" is the rail's top icon; "+" (open a project) its foot. The "All projects" page gives a card only to projects with something waiting or running, and one line to each quiet project.
**Why:** Approved by the human in the Design tab after four passes (calmer tiles, receding unselected tiles with a gliding selection, no hover card).

## 5. Rail order: fixed, drag to reorder
**Decision:** The rail keeps a fixed order the human sets by dragging tiles, on desktop and on the phone strip. The order is saved on the server, per project, so every device shows the same order. A newly opened project goes to the end. The "All projects" page and the Ctrl+K palette's project group follow the same order.
**Why:** A rail is fast because each project stays in the same spot; recency would move tiles on every switch. The human chose drag over the insertion order so they can put the projects they use most on top.

## 6. Alt+1–9 jumps to a project
**Decision:** Alt+1 to Alt+9 switch to the first nine projects in the rail's order, from anywhere in the app (including while focus is in a chat). A tile's tooltip shows its shortcut beside the name (e.g. "clawflow  Alt+2"). There is no other new shortcut; the Ctrl+K palette stays the way to reach a project by name.
**Why:** Ctrl+1–9 is taken by the browser for its own tabs; Alt+digit is unused in runcastle, cheap, and the order the human drags becomes their keyboard map.
