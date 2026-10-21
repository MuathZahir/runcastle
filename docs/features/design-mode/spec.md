# Design mode

## Problem

To see how a screen looks in a given state, the human has to test-drive the whole app and click their way to that state. Then they describe what is wrong in words, wait for a burn, and drive again. In their own words: "I wanted to iterate with the agent on specific components/screens/states without having to test drive every time, reach that state, then see how it looks. This was my main issue."

Until then, the closest thing to seeing a UI before it is built is the plan preview's hand-drawn HTML mock. It only approximates the real components and design system. What the human approves there is redrawn by a burner, and can drift.

The feature page also splits the conversation from what it talks about. The Overview tab holds the work and the Chat tab holds the agent, so the human flips between them.

## Approach

### What the human sees

The feature page becomes **the chat**.
- Under the topbar there is a slim **feature strip**: the stepper, the next-step sentence and the one primary action (Go, Merge…). It never hides.
- Below the strip, the feature's chat fills the page.
- One **panel** opens on the right when there is something to show. It holds one view at a time:
  - **body**: the phase's body as today (planning panes and tickets, run lanes, review evidence, shipped outcome);
  - **preview**: the plan preview;
  - **design**: the live design preview;
  - **drive**: a test drive;
  - **details**: the docs and the activity timeline, today's inspector aside.

  A switcher in the panel's header lists the views available in the current state, and topbar buttons open each one.
- The divider drags freely, either side down to nothing. Double-clicking it toggles between a 50/50 split and the panel at full width. The panel can collapse to a strip. Sizes are remembered per browser, in local storage, wrapped so a missing store is harmless.
- Below roughly 1100px of content width, the panel becomes an overlay over the chat.
- A draft feature has no chat, so its body is the page.

The panel opens three ways:
1. the human, from the topbar;
2. the agent, through the `show_panel` MCP tool;
3. runcastle, only as the direct result of the human's own click: Go opens the run body, and Test drive opens the drive.

Nothing else opens a panel on its own.

The chat column's header holds a **session switcher**.
- Today it lists the feature chat, and, while a drive errand is open ("New scenario", "Fix it"), the scenario chat. Opening an errand switches the column to the scenario chat.
- Picking the feature chat, or closing the errand, switches back. The drive keeps the whole panel.
- The parked feature *Several sessions per feature* adds its side sessions to this same switcher. It runs in parallel and reconciles the column at merge.

The **project page** takes the same shape:
- a live project chat fills the page;
- the project drive opens in the same panel;
- past project chats are listed in the session switcher;
- with no chat running, the page shows the chat list and New chat, as today.

### The design loop

The agent opens a design when it judges a design moment, or when the human asks to see something, in any phase.
1. **First use in a project.** The agent installs dependencies with the project's own install, then works out how to serve a preview page with the project's own frontend dev server. In a Vite app that is an extra entry. In Next.js it is a dev-only route kept out of production builds.
2. **A preview page per state.** It mounts either a piece directly with made-up props, or the whole screen with the server faked (queries and named mutations answered at the `fetch` edge). States behind clicks are reached by the page performing those clicks after load. In runcastle's own repo the fakes under `.runcastle/preview/` (fake tRPC, shell fakes, the `App`-at-an-address helper, a silent event stream) are the starting point.
3. **`start_design_server({ command? })`.**
   - Runcastle picks a free port and runs the command in the feature's talk worktree, in a terminal it owns. The port is injected as `RUNCASTLE_DESIGN_PORT`, and the agent puts it in the command.
   - It finds the URL with the drive's existing URL sniffing and returns it.
   - The command is recorded in the project's `.runcastle/design.json`, committed with the designs. Later calls, other features, and the plan preview's **Open in design** can then start the server without the agent re-deriving it, which is why the argument is optional once the file exists.
   - There is one design server per feature, and no per-project slot.
4. **`show_panel({ view: 'design', path })`** opens the design view at the server's URL plus the path. The pane reuses the drive panel's iframe and toolbar (Reload, Select area, Open in a new tab) plus Close.
5. **Iterate.**
   - The human talks.
   - The human points with **Select area**. In the design view a crop is saved as a PNG under runcastle's data dir, never in the repo, and runcastle types its path and the human's words into the live chat as a message. It does not write a test note.
   - For a genuinely open choice, the agent adds a collapsible **Tweaks** menu to the preview page: three or four controls at most, showing their current values as one copyable line.
   - The project's hot reload updates the pane.
6. **Approve.** The agent writes any tweak values into the real code and deletes the Tweaks menu. It then commits the component, its preview page and sample data as `design: <what>`.
   - In planning the commit lands directly on `feature/<slug>`, since nothing else holds the branch then.
   - After Go the chat is the lead, and its commit takes the lead's normal landing path.
   - Unapproved work stays uncommitted.

**Stopping the design server.** It stops when the chat session ends, when the feature ships, or after 30 minutes without a heartbeat from a visible design view. The web client sends that heartbeat while the design view is on screen, so a closed tab counts as closed. Reopening restarts it from `.runcastle/design.json`.

### Permissions

- The edit guard and the install guard lift for the `chat` kind in **every** phase. From Go on they already lift for the lead, and now they also lift in planning. The lift covers the whole checkout, with no guess at which paths are UI.
- The design guide keeps the agent to UI: components, preview pages and sample data. Data loading, API calls and behaviour stay in tickets.
- The planning chat's injected rules change with this: "talk sessions do not write code" becomes "the planning chat may write UI for design; everything else rides a ticket".
- Before Go the planning chat stays in its asking permission posture. The human is present.
- Other talk kinds keep their guards.
- This retires the charter's locked decision that talk worktrees are docs-only. The project session writes the ADR.

### Go waits for a clean worktree

`go()` refuses while the talk worktree has uncommitted changes outside `docs/features/`, with the reason "Uncommitted design work: ask the chat to commit or drop it". The next-step bar shows Go disabled with that reason. Unlike "the plan is not finished", this refusal has no override. Burns fork from the branch tip and could never see the work.

### The plan preview and the tickets

- **The plan preview stays** as the page the plan is confirmed on. A screen designed in design mode is not mocked again. Its place in the show is a designed-screen entry: name, one line saying what is real and what is sample data, and an **Open in design** button.
  - The button posts a message out of the preview's sandboxed frame. The preview panel answers by opening the design view at that preview page, starting the server first if needed.
  - Its screen block names the committed component and preview page instead of holding markup.
  - Hand-drawn mocks remain for undesigned screens, server-built pages and native mobile.
- **Tickets connect; they never restyle.** A ticket wiring a designed screen names the committed component and its preview page in its context, and states the look is approved. It swaps sample data for real data, adds behaviour, and changes markup only where wiring requires it. A visible change forced by wiring is called out in the burner's digest. No new check exists beyond the project's own typecheck.

### Skills

- A new **design guide** skill in the runcastle pack holds the loop above, the two ways to reach a state, Tweaks, commit-on-approval, and the honest limits: server-built pages are previewed by their client pieces only, live content is canned, and native mobile has no browser to render in.
- The chat's entry skills point to the guide: ideate, revisit and lead.
- The ideate preview rules gain designed-screen entries.
- The tickets skill gains the connect-don't-restyle rule.
- The self-planning path, with no human present, never opens a design.

### Events

Every mutation emits:
- `design.server_started` (url, port);
- `design.server_stopped` (reason: session-ended / idle / shipped / failed);
- `panel.show` (view, path) from `show_panel`;
- a chat-delivery event for a typed crop.

The UI opens panels and refreshes from these over the existing stream.

## Seams

- **Edit and install guards** (existing, pure). The guard functions take kind, phase, path and command and return allow or deny. They observe that a planning `chat` may edit outside `docs/features/<slug>/` and install, and that other talk kinds still may not.
- **Design server service** (new, the main server seam). Start with a command or the recorded one, get the URL and port. Then stop, heartbeat, and query liveness per feature. It is built on the existing dev-pane runner (start, stop, liveness) and URL sniffing. It observes the returned URL, `.runcastle/design.json` written, one server per feature, the stop rules firing (session end, ship, heartbeat lapse), and the events emitted. The MCP `start_design_server` tool and the tRPC calls the web uses (start for Open in design, heartbeat, stop) are thin over it.
- **`show_panel` MCP tool** (new). It observes a `panel.show` event with view and path on the bus, refuses unknown views, and refuses `design` while no server runs and none is recorded.
- **`go()`** (existing). It observes the refusal and its reason while the talk worktree has uncommitted non-docs changes, and success once clean. The status-line function that decides Go versus gated Go observes the same reason, so bar and refusal agree.
- **Crop to chat** (new tRPC mutation). Takes a PNG and text. It observes the file saved under the data dir, the path and text written to the feature's live chat terminal, and a clear failure when no chat is live.
- **Panel state** (new, pure, in the web). The function that lists available views from the feature's state and the reducer for open, close, switch, resize and full-width. It observes which views each phase offers, that runcastle-initiated opens only follow Go and Test drive, and size persistence. Component tests per `apps/web/STYLE.md`'s tiers cover the chat-first page, the switcher and the project page.
- **Preview message** (new, small). The preview panel's handler for the "open design" message from the sandboxed frame. It observes that the design view opens at the given path.
- **Skills text** (existing pack). The design guide exists and is referenced by the chat entry skills. The preview and tickets rules carry the new text.

## Out of scope

- Turning the chat terminal into web components. Parked as *Chat as web components*, which depends on this feature.
- Several sessions per feature (forked side sessions). Parked as *Several sessions per feature*, running in parallel.
- Visual diffing or screenshot comparison against approved designs.
- Runcastle rendering, parsing or understanding components. It runs a command and shows a URL.
- Previewing server-built pages whole, live streams beyond canned content, and native mobile.
- Design from the project chat. The project page changes layout only, and design mode belongs to a feature's chat.
- Prepare-time setup for design mode. First use is the agent's job in the chat.
- The ADR retiring docs-only talk worktrees, which the project session writes.
- Storybook, the map, and the stories catalogue, already removed elsewhere.

## Open questions

None open. The 30-minute idle window, the ~1100px overlay breakpoint and the `.runcastle/design.json` file name are tunable details, not decisions.

## Later laps

None deferred (decision 1). A later lap holds whatever the test drive turns up.
