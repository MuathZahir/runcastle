# A better way to move between projects

## Purpose
The human has disliked the project selector for a while: it is "very basic" and "annoying to switch between many projects". Today the switcher (`apps/web/src/components/ProjectSwitcher.tsx`, top-left of the sidebar) is a dropdown: two clicks every time, a fixed order (not recency), each row shows only a name with no sign of whether anything there is running or needs the human, and "All projects" / "Open a project…" sit at its foot. The "All projects" page (`PortfolioHome.tsx`) is a list of open projects with a live bay on top for what is running or waiting; it has to be visited deliberately and does little once there. The human uses runcastle across ~7 projects (runcastle, runcastle-demo, terminal-wait-game, JanaLearn_Updated, clawflow, jev-browser-extension, jewellery-system) and hops between them often.

This feature rethinks how the human moves between projects, **the switcher and the "All projects" page together**, on **desktop and phone**.

## Decided with the human (orchestrator intake, 2026-11-09)
- **Try several directions, designs first.** The lead renders each direction as real screens in design mode with fake data (desktop and phone, plus what "All projects" becomes under each). The human clicks through them side by side, picks one or mixes parts, and **only the winner gets built**. If two directions end up too close to call, build the cheaper one first and come back for the other rather than building both.
- **Phone is in scope**: every design shows its phone version (today the phone's switcher lives in `PhoneListHead`), and the winner is built for both.

## Directions the orchestrator put on the table (starting points, not decisions)
1. **Better dropdown**: keep the switch model; order by recency, show a needs-you / running mark per project, type to filter, Ctrl+1..9 jumps; "All projects" becomes a real overview.
2. **Project rail**: a thin always-visible column of project icons at the far left (Slack-workspace / Discord-server style) with live badges; one click switches; "All projects" becomes the rail's top entry or goes away. On phone it needs its own form (top strip, swipe-in rail…). The orchestrator leaned toward this one: the pain is moving often between several live projects, and the rail makes that one click while always showing which project wants the human. The cost is ~50px of permanent width.
3. **No switching**: one sidebar showing every project's features grouped by project. Nothing to switch; risks crowding at 7+ projects.
The human said "we can try different things": the lead should feel free to add or merge directions.

## Must not swallow
- The Ctrl+K command palette, beyond adopting whatever ordering/badges the new design introduces.
- "Open a project…" flow and first-project onboarding (the onboarding-and-project-chooser redesign owns those).
- The sidebar's per-project content (features list, Orchestrator row) beyond what the chosen direction needs to make room.

## Open (for the grill in this feature's chat)
- Which direction wins, and what "All projects" becomes under it.
- What counts as a project "needing you" vs "running" for a badge (reuse what the sidebar's Needs-you and the tab-title count already use, from the you-always-know-what-s-waiting feature).
- Project identity in a compact form (icon/initial/colour), ordering (recency vs pinned), keyboard shortcuts.
- Phone form of the winner.

## Prior art to read
- `docs/features/sidebar-refresh-less-clutter-more-character/decisions.md` (the sidebar head is the switcher, then Search/New/Hide).
- `docs/features/flow-redesign-project-shell-and-navigation/decisions.md` (URLs, palette groups, titlebar).
- `docs/features/flow-redesign-onboarding-and-project-chooser/decisions.md` (switcher's repo-folder subtitle, PortfolioHome framing).
- `docs/features/you-always-know-what-s-waiting/decisions.md` (cross-project needs-you count).
- `apps/web/STYLE.md` and `apps/web/DESIGN.md` before any styling.
- CONTEXT.md lists "Multi-project, the full parallel multi-project UI (GH #12)" as a deferred thread; this feature is a step toward it, not the whole of it.

## Ordering
Standalone; nothing waits on it and it waits on nothing.

## Working agreement
**Check-in when ready.** The design choice is the human's in this chat's grill. Once built and reviewed, the orchestrator presents it to the human and merges only on their word.

Planning mode: grill with you — it decides how a new way of getting around the app looks and works, and the human wants to compare directions themselves.
