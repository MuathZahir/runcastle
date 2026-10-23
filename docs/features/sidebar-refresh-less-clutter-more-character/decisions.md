# Decisions — Sidebar refresh: less clutter, more character

## 1. Feature rows become two-line rows
**Decision:** Each feature in the project sidebar is a two-line row: the title on the first line, then a quiet line beneath with the phase glyph, the state in words ("Waiting on you", "Run failed", "Building · 3/7", "Ready to test") and how long ago it last moved. A row that needs you or has an agent at work keeps one trailing mark on the title line. Selected is a filled, rounded block. DESIGN.md's sidebar row note (NavItem, 32px one-line) is amended to describe this row; the general rules are untouched.
**Why:** The human found the clutter in the components, not only the arrangement, and liked the T3 Code sidebar's look. Of three row directions shown side by side (refined one-line, plain words-only, two-line), they picked two-line. It spells the state out in words, so nothing rests on colour alone, at the cost of about 52px a row instead of 32px.

## 2. The two-line row's settings
**Decision:** The phase glyph sits small (12px) at the start of the second line, not leading the title. The second line ends with the age ("7m", "1h"). Rows are roomy (about 52px).
**Why:** A full-size leading glyph brings back the column of coloured icons that made today's rows busy; the age shows stale work at a glance; roomy matches the T3 Code reference, and folding drafts and shipped work leaves room for it.

## 3. "N running elsewhere" leaves the sidebar
**Decision:** The project sidebar no longer shows the "N running elsewhere" row (runs in other projects). The all-projects home still shows each project's activity.
**Why:** The human found it not useful; it spent a row on other projects' business.

## 4. The Orchestrator leads the sidebar
**Decision:** Today's "Project" nav row becomes the sidebar's lead row, named **Orchestrator** (it opens the project chat), with a new orchestrator icon (a hub joined to three nodes, added to the icon set) instead of the folder. Its second line says what it holds ("Waiting on you · 2 notes"), with an amber dot while the chat waits on the human. "Re-prepare project" moves into its "…" menu. How it looks is decision 8. No new hues anywhere in the sidebar.
**Why:** The human wanted the project's own door to feel more important and named for what it does. A gradient tile and coloured glow in off-palette colours, a slate card and a bare row were all tried and rejected on the way to decision 8.

## 5. The top of the sidebar
**Decision:** The head is the project switcher, then Search (an icon, Ctrl/⌘ K), New and Hide sidebar. The search field and its row are gone. Under the head, with room around it, sits the Orchestrator row.
**Why:** The search row between the project chat and the features read as awkward and crowded the top. Search is mostly reached by its shortcut, so an icon in the head is enough, and the freed space lets the project chat and the list breathe.

## 6. What needs you comes first, unheaded, and stopped work joins it
**Decision:** The feature list opens with the features that need the human, with no heading. Each keeps its trailing dot: amber when waiting on you, red when a run failed. Features that started but have no agent at work and nothing asked of the human (today's "In progress" lane) join this list below them. Their state line reads "Stopped" (with ticket progress, e.g. "Stopped · 4/6") and their dot is grey. There is no "In progress" lane. This is a sidebar regroup only: what counts as needing the human for notifications is unchanged.
**Why:** The human found "In progress" next to "Working" confusing and didn't want a whole lane for stalled work. A stopped feature waits on someone to restart it, so it belongs with what needs them. A coloured edge bar on these rows was tried and rejected, and the dot came back.

## 7. Working features sit in a bay; hover and selection are a shade off the canvas
**Decision:** Features with an agent at work sit together under a "Working" heading inside a bay: a panel barely lighter than the canvas, with a hairline outline that one thin accent light slowly travels around. Each working row's state words ("Building · 3/7") carry a slow passing shimmer. There is clear space above the shelf (Backlog, Shipped, Archived) below it. Hovered rows get only a faint fill a shade off the canvas (about 3.5% of the text colour), not today's light blocks; the selected row is a card (decision 8). All motion stops under reduced motion.
**Why:** The human wanted working and waiting work told apart at a glance, more creatively than a small sparkle. Waiting rows are still and dotted, working ones boxed and moving. Of bay, rail and plain heading, with ring, shimmer or nothing on the rows, they picked bay with shimmer. They found the light rounded fills on selection, hover and the project row heavy.

## 8. One card material, the Orchestrator card, and the shelves
**Decision:** The sidebar uses one card recipe: the theme's 10px radius, a fill about 2.5% of the text colour over the canvas, and a hairline edge. The selected row, the Working bay and the live test drive all wear it; rows inside a card take the 6px radius so the corners nest. The Orchestrator is the one accent-filled card: a dark accent wash from its icon side, a fine accent grid fading in from its far corner, the hub icon in a small accent tile, the name in semibold, the second line tinted toward the accent, and a chevron. At rest it is still; on hover the hub's nodes light in turn and one sheen crosses the card. Working is a shelf that starts open: an accent activity icon, "Working" and its count, then the bay. Backlog, Shipped and Archived are folded shelves: an icon (list, merge, archive), the name at 14px, the count in a small round well, a turning chevron, hairlines between them. Opened, they show the same two-line rows as every other lane; Shipped shows five, then "Show N more". The phase glyph stays inline on the state line. Behind the head, the line grid gives way to a fine static film grain fading out downward. DESIGN.md's sidebar notes record the card recipe, the Orchestrator's accent wash and the count well as sidebar-only exceptions to "no gradients" and "no pills".
**Why:** The human found the earlier version inconsistent: the bay and the selected row disagreed in radius and fill (the bay asked for a radius the theme lacks, so it drew square). They wanted the Orchestrator more distinct and more creatively made, and liked the shelves in a mock-up they generated. Two grids on top of each other looked wrong, and they kept the Orchestrator's. Leading row icons were offered and declined: they bring back the column of coloured icons.

## 9. "Backlog" replaces "Draft" in what the human reads and what agents say
**Decision:** Everywhere the human reads the word, a parked idea is in the **Backlog**: the sidebar shelf, the Create menu ("Add to backlog" for "Draft an idea"), the parking overlay, labels and tooltips. The runcastle skills that talk to the human say it the same way ("I've put it in the backlog"). Internal names stay as they are: the feature status `draft`, the `draft: true` option on creating a feature, code identifiers. CONTEXT.md's glossary is left to the project session, with a note.
**Why:** What the human reads should match the sidebar. Renaming the stored status means a migration and touching every agent tool, a lot of risk for a word nobody sees; it can be its own feature later.

## 10. Preparation, drives and the foot take the new shapes
**Decision:** While preparation is owed, "Prepare this project" is the first row of the needs-you list, on the two-line row with an amber dot and its count in words ("8 to establish"). Once done, "Re-prepare the project" lives in the Orchestrator's "…" menu. Live drives (Test drive, Project drive) sit in the foot as cards: a play disc, the label, and the feature's title (or the branch, for a project drive) instead of a truncated branch, with Stop on hover. The foot's last line is icons only: settings, theme, notifications on the left; the sandbox glyph and the server's health dot on the right, with the words in the tooltip. The all-projects home sidebar shares this line.
**Why:** The real sidebar carries these rows too, and each takes the shape of the design around it. The old drive row was mostly ellipsis because it fitted label, dot and branch on one line.

## 11. One lap
**Decision:** The feature is built in one lap: connect the live sidebar to the committed design pieces, swap in the new foot, rename Draft to Backlog in the app and the skills, and bring the sidebar tests in line. Then one test drive.
**Why:** Every part follows from settled decisions and a design already approved on a preview, so a thin first slice would teach nothing new. Anything that feels off with real data is a small second lap.
