# A better way to move between projects

## Problem
The human runs runcastle across about seven projects and hops between them often. The project switcher is a dropdown at the top of the sidebar: two clicks every time, projects in whatever order the database returns them, and each row a bare name with no sign of whether anything there needs them. The "All projects" page has to be visited on purpose and does little once there. On the phone it is the same dropdown.

## Approach
**What the human gets.** A calm **project rail**: a thin column of project tiles at the far left of the window, left of the sidebar, always visible on desktop (it stays when the sidebar is hidden with Ctrl+B). On the phone the same tiles run as a row across the top of the list screen. One click or tap switches project. Each tile is one or two monochrome letters; the project you are in is the only bright tile, on a quiet filled surface that glides to the new tile when you switch; the others sit slightly left in a dimmer grey. The only mark is a small amber dot on a project that needs you (never on the current one). Hovering a tile shows the project's full name and its shortcut, nothing more. The rail's top icon opens "All projects" (and is the selected tile while you are there); its foot "+" opens a project. Tiles keep a fixed order the human sets by dragging (long-press then drag on the phone), saved on the server so every device agrees; a newly opened project goes to the end. Alt+1 to Alt+9 jump to the first nine projects in that order from anywhere, including while focus is in a chat. The sidebar's dropdown switcher goes away: the sidebar head shows the current project's name. The "All projects" page gives a card only to projects with something waiting or running, listing what waits on you and what is running, and one line to each quiet project, in rail order. The Ctrl+K palette's project group follows the rail order.

The look is approved and committed as design pages: `/preview/project-switching.html` (states: Busy, Quiet, Mid-switch, 14 projects) and `/preview/all-projects.html` (Busy, Quiet, 14 projects), built from `apps/web/preview/project-switching/`. The build connects that look to real data; it does not restyle it. Initials follow the mock's rule (two letters from the name's first two words, splitting on `-`, `_`, spaces and camelCase; one letter for a one-word name).

**Shape.**
- **Server order.** The `projects` table gains an integer position column, backfilled by a migration so today's order (insertion order) is kept. The `Project` contract carries it. Listing open projects returns them by position. Opening a new project, or reopening a closed one, puts it at the end. A new `project.reorder` mutation takes the full ordered list of open project ids, writes their positions, and emits a `project.reordered` event (so every open window's rail updates at once). An id list that does not match the open projects exactly is refused.
- **Who needs you.** A project needs you when any of its features does, by the same rule the sidebar's Needs-you section and the tab-title count already use (the you-always-know-what-s-waiting feature). The rail reads the per-project feature lists the tab title already fetches for every project, so it adds no new polling.
- **Rail data.** A pure helper turns the ordered projects, their feature lists and the current project into the rail's tiles: id, name, initials, needs-you (false for the current project), and shortcut number (1–9 or none). A second pure helper moves one id to a new index in an ordered list, for the drag.
- **Layout.** The desktop rail mounts in the shared frame as a sibling before the sidebar, so it shows on both the project screen and the All projects page (which has no sidebar and asks the frame for the rail on its own) and survives the sidebar closing. The phone row mounts at the top of the phone list screen.
- **Shortcut.** One window-level key handler, mounted once for the whole shell, maps Alt+Digit1..9 (by physical key code, so macOS Option works) to the nth project and enters it. The chat terminal's key mapper must intercept Alt+digit and send nothing to the terminal, so the event reaches the window handler instead of becoming ESC+digit in the session.
- **Focus.** The rail's focus ring shows for keyboard focus only, in the app's standard 2px style fitted to the tile; the global focus rule is unlayered, so the rail needs a small, scoped exception rather than `!important` scattered through it.
- **Retired.** The dropdown switcher component and its test go; the All projects page loses its own sidebar: on desktop it is the rail and then the cards (decision 7).

## Seams
- **`project.list` / `project.reorder` (tRPC, existing router; `reorder` is new).** Observe: the order `list` returns before and after a reorder, a new and a reopened project landing at the end, a mismatched id list refused, and the `project.reordered` event in the project's event log. Tested through the router caller in the server's existing projects test.
- **Rail tiles helper (new, pure, web lib).** Observe: initials for the human's real project names (runcastle, runcastle-demo, JanaLearn_Updated, clawflow, jev-browser-extension…), needs-you per project and never on the current one, shortcut numbers 1–9 then none.
- **Move-in-list helper (new, pure).** Observe: the resulting order for moves up, down, to the ends, and no-op.
- **Alt+digit → project (new, pure key mapper beside the existing hotkey helpers).** Observe: Alt+1..9 by code map to indexes 0..8; with Ctrl/Meta/Shift, or digits 0, nothing.
- **Terminal key mapper (existing).** Observe: Alt+digit is intercepted with no bytes; other Alt keys unchanged.
- **Frame, phone shell, All projects page (existing component tests).** Observe: the rail renders with the sidebar open and closed; the phone row on the list screen; the All projects page's cards and quiet rows in rail order. The old switcher's test is removed with it.

## Out of scope
- "Open a project…" flow and first-project onboarding: the rail's "+" calls the existing open flow unchanged.
- The Ctrl+K palette beyond following the rail order (no dots or shortcuts in it).
- The sidebar's per-project content (Orchestrator row, features list) beyond swapping the dropdown for the project name.
- Showing what is running on the rail (decision 3); per-project colours or icons (decision 2).
- The full parallel multi-project UI (CONTEXT.md's deferred thread).

## Open questions
None.
