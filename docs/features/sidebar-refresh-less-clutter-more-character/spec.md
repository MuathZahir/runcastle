# Sidebar refresh: less clutter, more character

## Problem

The project sidebar is busy and flat at once. Every feature is a one-line row of glyph, truncated title, dot and a fraction like "3/7", so what a feature is doing has to be decoded from marks. Six lane headings (Inbox, Agent working, In progress, Drafts, Shipped, archived) split the list, and "In progress" next to "Agent working" reads as the same thing twice. The project's own door is a plain "Project" row with a folder icon, no more important than a feature. The search field takes a row of its own. The foot spends rows on other projects ("1 running elsewhere") and on a test-drive row that is mostly ellipsis. Selection and hover are light blocks that sit heavily on the dark canvas. Nothing in the sidebar tells working features from waiting ones at a glance, and nothing in it feels alive.

## Approach

**What the human sees.** From the top: the project switcher with Search (an icon, ⌘/Ctrl K), Create and Close beside it, over a faint static film grain. Under the head sits the **Orchestrator** card, the project's door to its chat. It is the sidebar's one accent card: a dark accent wash, a fine accent grid in its far corner, a hub icon in a small accent tile, "Orchestrator" in semibold, and a second line saying what it holds ("Waiting on you · 2 notes"), with an amber dot while the chat waits on the human. On hover the hub's nodes light in turn and a sheen crosses the card. Its "…" menu holds "Re-prepare the project".

Below it, with no heading, comes what needs the human. First "Prepare this project" while preparation is owed. Then the features waiting on the human (amber dot, red for a failed run, whose words "Run failed" also go red). Then the stopped features: started, with no agent at work and nothing asked of the human. They read "Stopped · 4/6" with a grey dot.

Then **Working**, a shelf that starts open, headed by an accent activity icon, its name and its count. Its rows sit in the bay: a card whose hairline edge carries one slowly travelling accent light. The rows' state words ("Building · 3/7") shimmer.

Then the folded shelves **Backlog**, **Shipped** and **Archived**, each a row of icon, name, count in a small round well and a turning chevron, with hairlines between them. Opened, they show the same rows as every other lane. Shipped shows five, then "Show N more".

The foot holds live drives (Test drive, Project drive) as cards: a play disc, the label, and the feature's title (the branch for a project drive), with Stop on hover. Below them is one line of icons: settings, theme and notifications on the left, the sandbox glyph and the server's health dot on the right, with the words in the tooltip.

Every feature row is two lines. The first is a 14px title with at most one trailing dot. The second is the 12px phase glyph, the state in words, and the age. One card material runs through the sidebar: the theme's 10px radius, a fill of about 2.5% of the text colour over the canvas, and a hairline edge. The selected row, the Working bay and drive cards wear it. Rows inside a card take the 6px radius so the corners nest. Hover is a 3.5% fill. All motion (shimmer, travelling light, the Orchestrator's hover beat) stops or flattens under reduced motion.

**"Backlog" for "Draft".** Wherever the human reads the word, a parked idea is in the Backlog. That covers the shelf, the Create menu ("Add to backlog" for "Draft an idea"), the park overlay and its button, and labels, tooltips and empty-state copy. The runcastle skills that talk to the human say it the same way. Internal names stay: the feature status `draft`, `create_feature`'s `draft: true`, code identifiers, CSS tokens such as the draft phase colour, and the draft ring glyph.

**The shape.** The design is already committed as props-only pieces in the web app's sidebar parts module, with a preview page that composes them over sample features. The pieces are `OrchestratorCard`, `SidebarFeatureRow`, `PrepRow`, `WorkingShelf`, `Shelf`, `ShelfCount`, `DriveCard`, `SidebarStatusLine`, `SidebarGrain` and `featureStateWords`. Also committed are the theme's motion utilities (`text-shimmer`, `orbit-light`, `orchestrator-beat`, `film-grain`), the `IconOrchestrator` icon, and DESIGN.md's sidebar notes. **The pieces are not restyled by this work.** The work is connecting them:

- `Sidebar` keeps its queries (feature list, prep view, open-note count, talk state) and composes the parts the way the preview page does. Its row menus (Copy link, Archive / Unarchive, Delete) and the delete dialog stay. The search launcher field, the "Project" nav row, the Preparation nav row, `InboxLane` / `WorkLanes` and the one-line `FeatureRow` go. So do the "running elsewhere" row and the cross-project feature-list queries that fed only it. The lane grouping still comes from `sidebarLanes`, and the stopped lane (`inProgress`) is drawn after the needs-you rows. This is a sidebar grouping only: what counts as needing the human for notifications is unchanged. Selection keeps today's rule (the row is selected while its feature page is the current view). The Orchestrator is current while the project view is open.
- Archived features must reach the Archived shelf whether or not it is open, since its count shows while folded. The show-archived preference stored in the browser becomes whether the Archived shelf starts open.
- `SidebarFootChrome` keeps its contract (health, origin, sandbox, notify, theme, settings, rows above). It renders drive cards in its rows and `SidebarStatusLine` as its last line, with the health word and origin carried in the tooltip. The all-projects home sidebar shares it and changes with it.
- The loading skeleton for the feature list takes the two-line row's metrics.
- The Backlog wording is a copy sweep across web copy and the runcastle skills' human-facing prose, plus the lane label in the feature-ui lane model.

## Seams

- **`Sidebar` rendered with faked tRPC (existing).** It shows the composed sidebar for a given feature list, prep view, note count, talk state and drive. You can observe: the Orchestrator's status line and dot; that the needs-you list orders prep, waiting, then stopped rows with their dots and words; that Working holds the agent-working features; that the shelves' counts include archived features; that "Show N more" appears after five shipped; that no search field, Project row, lane headings or "running elsewhere" remain; and that row menus still archive, unarchive and delete. The existing sidebar test files (`sidebar-inbox`, `sidebar-lanes`, `sidebar-row`, `sidebar-delete`, `sidebar-foot`, `project-note-badge`, `content-skeletons`, `consistency-pass` and the others that render the sidebar) move to this shape.
- **`SidebarFootChrome` as markup (existing).** You can observe the icon-only status line, the health tone with its words in the tooltip, drive cards with Stop, and the portfolio home's foot rendering through the same chrome.
- **The sidebar parts module (new, committed).** Rendered directly, each piece shows its states: a row's words, dot and shimmer by lane; a shelf folded and opened; the Orchestrator's waiting dot. Tests may sit here for the row-level rules (`featureStateWords` across lanes) so the `Sidebar` tests need not enumerate them.
- **The preview page `/preview/sidebar.html` (new, committed).** The visual reference the live sidebar must match. It is not a test seam.
- **Copy (existing).** A text search of web copy and the runcastle skills for the human-facing words "draft" / "Draft an idea" / "Park draft", with status and identifier uses excepted.

## Out of scope

- Renaming the stored `draft` status, `create_feature`'s `draft` option, or any identifier. That would be its own feature.
- CONTEXT.md's glossary. The project session owns the charter; it is left a note to say "Backlog".
- Other pages, the content panel, and the general design rules outside DESIGN.md's sidebar notes.
- New sidebar data or behaviour: no new queries, no live activity text, no persistence for the Working or Backlog / Shipped fold state.
- Restyling the committed parts. A visual change found while wiring is a note for the test drive, not an edit.

## Open questions

- None blocking. The light theme was not reviewed in the preview. The parts use theme tokens throughout, so it should hold, but it is worth a glance on the test drive.
