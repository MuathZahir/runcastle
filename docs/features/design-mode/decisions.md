# Decisions — design-mode

## 1. The whole feature in one lap, no thin first slice
**Decision:** Lap 1 specs everything the brief leaves open: the worktree and installs, the dev server's lifecycle and port, the pane beside the chat, how design commits land, the design guide (preview pages, Tweaks), the relation to *Plan preview*, and how the lead's tickets use what was designed. Nothing is parked in `## Later laps` up front.
**Why:** The human's call when offered a thin walking-skeleton lap 1. They know they want the whole thing; a later lap is still open for whatever the test drive turns up.

## 2. Design runs in the chat's own worktree; both guards lift for the planning chat
**Decision:** Design mode uses the feature's existing talk worktree on `feature/<slug>`. No second worktree. The edit guard and the install guard lift for the `chat` kind in planning, as they already do from Go on for the lead. The lift covers the whole checkout, not a guessed set of UI paths. The design guide keeps the agent to UI work: components, their preview pages and sample data. Data loading, API calls and behaviour stay in tickets. Installs are the project's own install, run on the host by the agent the first time it needs one. The package manager's normal global cache keeps them fast, and nothing is built for caching: ADR-0004's problem was bind mounts into burn containers, which this never meets. Installs are removed with the worktree, at ship or archive, as the lead's are today. This retires charter locked decision 6 ("docs-only talk worktrees"); the project session writes the ADR.
**Why:** One worktree means design commits land directly on the feature branch, with no new branch or landing path. A path-based lift would have to guess which files are UI in a given language, which breaks the charter's language-agnostic rule. The cost accepted: before Go, only the prompt stops a planning chat from writing non-UI code. Rejected: lifting the guards only while the pane is open, which is firmer but adds a state to track. Supersedes, for approved UI only, `the-feature-lead-runs-rounds` decision 7's rejection of editing code before Go ("nothing touches code before the human approves the plan").

## 3. Runcastle owns the design dev server; the agent supplies the command
**Decision:** Two new MCP tools for the planning chat:
- `start_design_server({ command })`: runcastle runs the agent's command in the talk worktree, in a runcastle-owned terminal, picks up the URL with the drive's existing URL sniffing, and returns it.
- `show_panel({ view: 'design', path })` (decision 5): opens the design pane beside the chat at that URL plus a path. It replaces the `show_design` tool first proposed here.

Runcastle picks a free port and injects it as `RUNCASTLE_DESIGN_PORT`; the agent puts it in its command (for example `--port $RUNCASTLE_DESIGN_PORT --strictPort`). Each feature gets one design server on its own port, with no per-project slot limit. The server stops when the chat session ends, or after 30 minutes with the pane closed (decision 10 dropped "when the feature passes Go"). Reopening restarts it.
**Why:** The agent knows the framework, so runcastle never has to understand Vite or Next.js. Owning the process lets runcastle stop it and keeps it from outliving the session. A frontend-only dev server is cheap, so ADR-0014's one-drive-slot-per-project rule, which exists because a whole app is expensive, doesn't apply. Rejected: the agent backgrounding the server in its own shell, which needs no tools but leaves an invisible process that runcastle cannot stop.

## 4. Design mode brings the one-page feature layout; Select area crops go to the chat
**Decision:** The feature page's Overview and Chat tabs are replaced by one page built around the chat. Decision 5 pins the layout. **Select area** in the design pane saves the crop as a PNG and sends its path, with the human's words, into the chat as a message. It does not write a test note. Moving the chat from a terminal to web components is out of scope: it is parked as its own draft feature, which depends on this one.
**Why:** Design mode needs the chat beside a live app anyway, and one page is simpler than splitting a tab. Building the layout first gives the later web chat a fixed column to fill, so swapping the terminal moves nothing else on the page. A design remark is a request to the agent now, not a finding for review. Rejected: splitting the Chat tab only while a design is open. That keeps the tabs, and they would be rebuilt when the web chat lands.

## 5. The page is the chat; one resizable panel opens beside it when needed
**Decision:** The feature page is chat-first. By default the chat fills the content panel, under the topbar and a slim **feature strip** (the stepper, the next-step sentence and the primary action), which never hides. Go and Merge are always one click away.

A single **panel** opens on the right and shows one view at a time:
- the phase's body (tickets, run lanes, review);
- the plan preview;
- the design pane;
- a test drive;
- the details (docs and timeline).

A switcher in the panel header lists the views available in the current state. The panel opens three ways:
- the human, from topbar buttons;
- the agent, through one MCP tool `show_panel({ view, path? })`, used when it is talking about the thing;
- runcastle, only as the result of the human's own click: Go opens the run, Test drive opens the drive.

Runcastle never opens a panel by itself otherwise.

Sizing is free:
- the divider drags either side down to nothing;
- double-clicking it toggles between a 50/50 split and the panel at full width;
- the panel can collapse to a strip;
- sizes are remembered per browser.

This replaces the "chat column beside the body" sketch: the chat leads and the panel is on the right. A draft feature, which has no chat, shows its body as the page.
**Why:** The human wants the chat as the page and everything else to appear when needed, with a layout that feels flexible. A strip that never hides keeps the human's only two clicks visible when the panel is closed. Letting runcastle open panels only after the human's own clicks means nothing jumps under them mid-sentence. If agent-opened panels prove noisy, `show_panel` is one tool to remove.

## 6. The agent commits approved designs; Go waits for a clean worktree
**Decision:** When the human approves a design, the planning chat commits it to `feature/<slug>` as `design: <what>`. The commit lands directly, because no run holds the branch during planning. Preview pages and their sample data are committed with the component. A Tweaks menu never is: the agent writes the chosen values into the code and deletes the menu before committing. Work the human has not approved stays uncommitted. Runcastle's docs checkpoints keep committing only `docs/features/**`. Go is disabled while the talk worktree has uncommitted changes outside the docs, with the reason "Uncommitted design work: ask the chat to commit or drop it."
**Why:** "What you approved is what ships": burns fork from the branch tip, so uncommitted work would be invisible to them, and auto-committing at Go would ship experiments nobody approved. Blocking Go fits the existing rule that Go waits for a finished plan.

## 7. The plan preview stays; designed screens open in design instead of being mocked
**Decision:** `preview.html` keeps its role: it is the page the human confirms the plan on, holding the decisions, the flows and what is left out. A screen designed in design mode is not drawn again by hand. Its place in the preview's show is a designed-screen entry:
- its name;
- one line saying what is real and what is sample data;
- an **Open in design** button.

The button asks the app to open the design panel at that screen's preview page, starting the dev server if needed. Its screen block names the committed component and preview page instead of holding a mock. Hand-drawn mocks remain for screens nobody designed live, and for what design mode cannot preview: server-built pages and native mobile. The ideate skill's preview rules (`references/preview.md`) gain this.
**Why:** Drawing a designed screen twice costs work, and the mock can drift from what the human approved. The preview's frame cannot load the live dev server, so it hands off to the panel instead. Non-UI features still need the page.

## 8. Tickets connect designed components; they never restyle them
**Decision:** A ticket that wires a designed screen names, in its context, the committed component and its preview page, and states that the look is approved. Its job is to connect: swap sample data for real queries, add behaviour, and change markup only where the wiring needs it. A visible change forced by the wiring, such as a field the design lacked, is called out in the burner's digest so the review sees it. No new checks: the project's typecheck keeps preview pages compiling and nothing else enforces them. This is a change to the tickets skill's text, not runcastle logic.
**Why:** A burner sees only its ticket. Without being told the look is approved, it may restyle or rebuild what the human chose. Rejected: a screenshot comparison against the approved design, which is visual diffing and a feature of its own.

## 9. The chat column has a session switcher; side sessions are their own feature
**Decision:** The chat column's header carries a session switcher from day one. In design mode it lists the feature chat and, while a drive errand is open ("New scenario", "Fix it"), the scenario chat. Opening an errand switches the column to the scenario chat. Closing it, or picking the feature chat, switches back. The drive stays alone in the panel at full height. More sessions per feature, forked from the main chat so each knows the feature and what was being discussed, are parked as the draft *Several sessions per feature*. That draft adds its sessions to this same switcher. The human plans to run it in parallel with this one, accepting merge conflicts in the chat column.
**Why:** One chat column showing one conversation at a time avoids a three-column squeeze (feature chat, app, scenario chat) on a laptop. Building the switcher now means side sessions arrive without another layout change. Side sessions reverse *one-chat-per-feature*'s "one live session per feature" rule. That raises questions about the lead, ticket writes, a shared worktree and landing that need their own grilling.

## 10. Design mode works in every phase, not only planning
**Decision:** The design server, `show_panel` and the design guide work for the feature's chat in all four states. After Go the chat is the lead, which already edits code and installs dependencies. A design it commits after Go lands through the lead's normal landing path (`the-feature-lead-runs-rounds` decision 7). In planning the chat commits directly, and Go waits for a clean worktree (decision 6). The design server stops when the chat session ends, after 30 minutes with the pane closed, or when the feature ships. "When the feature passes Go" is no longer a stop rule.
**Why:** The pain design mode answers is "I have to test-drive to see a state". It peaks in Review, when the human spots something off. Planning-only would send a Review design fix back to a test note and a next-lap ticket, which is the slow loop the feature exists to remove.

## 11. The project page takes the same chat-first shape
**Decision:** The project page uses the feature page's layout pieces. A live project chat fills the page. The project test drive opens in the same right-hand resizable panel. The project's past chats are listed in the chat column's session switcher (decision 9). With no chat running, the page shows the chat list and the New chat button as today.
**Why:** The human asked to change the whole layout, and two pages built differently would feel like two apps. Reusing the feature page's chat column, switcher and panel keeps the added work small. Rejected: changing the feature page only, which leaves the drive and chat behaving differently on the two pages.

## Revisited 2026-10-21 (after the first test drive)

## 12. One header row; Go moves to the tickets view; one collapsed sidebar state
**Decision:** The feature page has a single header row: the title, a quiet status ("Planning with you"), the session switcher, Merge & ship when it applies, the ⋯ menu and a panel toggle. Removed from the page:
- the feature strip (the stepper and the next-step row);
- the chat column's own header row: End session and the "one transcript" note move into the switcher's menu;
- the Plan and Design topbar buttons: the panel toggle opens the panel at its last view, and the panel header switches views.

Go is on the tickets view (the planning body), above the ticket list. When the plan is not finished it is disabled with the reason beneath it, and "Go anyway" becomes a small link under that reason. The project page follows the same one-header rule. The sidebar has one collapsed state, closed, and the icon rail is removed; a header button brings it back.
Supersedes: decision 5's "slim feature strip … which never hides; Go and Merge are always one click away", for Go. Merge stays in the header.
**Why:** The human, test-driving: "So many headers one after the other… why do we have the 'Plan' and 'Design' buttons at the top, it looks so bad… The minimized sidebar is useless." and "I don't want the 'Go', 'Go anyway..' buttons. The buttons should be on the tickets page since it starts the burn." On Merge: "The merge can stay (maybe move it and unify the bars)."
