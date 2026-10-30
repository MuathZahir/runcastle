# Test drive looks the part

## Problem

The test drive is where the human checks a feature by hand, and today it looks unfinished next to the restyled sidebar. In the feature page's side panel the app sits in a 16:9 box with an empty row above it and dead space below. A scenario's progress and errors sit above the frame, outside the thing they describe. The dev server, branch and address sit in a separate row under it. Picking a scenario is an action menu that, with many scenarios, ran down the whole screen. The foundation now caps it at about ten rows, but it still makes the human read a long list. The project's drive tells the same moments (starting, setup failed, nothing started) in a different layout from the feature's.

## Approach

**What the human sees.** While the human is on a drive, the drive is the page. Test drive changes the page at once, showing Starting where the app will appear. The app runs flush, with a 360px rail beside it that opens on Notes, Chat one tab away. The app's column has one head, level with the rail's tabs: the back arrow, what is being driven (the feature's title, or "Driving main"), the scenario with a glyph for its run, then App | API when a scenario has an API call, the page tools (Select area, Reload, screen width, Open in a new tab), Stop drive and the rail toggle. A running or failed scenario, and the "make it a scenario" hint, sit in a strip under that head. The status line under the app carries Dev server, the branch, the address and Output; on the Orchestrator the checkout folder and identity live there too.

The back arrow returns to the chat with the drive still running. The sidebar's drive card and a "Back to the drive" button in the page's header return to it. Stop drive goes back to the chat with one line saying how many notes are unsent, and a way to send them. New scenario and Fix it open the rail's Chat tab.

The feature's drive and the Orchestrator's share one notes rail. A note shows its picture across the rail, its words, its age, and Edit and Delete in the row. Edit works in place and can add or replace the picture; Delete asks in the row. New notes land at the bottom, beside the box. The box is the chat's composer, taking pasted and attached pictures, and Select area puts its crop there with the cursor ready. On a feature, Send appears over the box only while unsent notes exist, and sent notes fold into one line. In the Orchestrator there is no Send; earlier open notes sit above this drive's. The rail lists notes, not the review agent's findings, which stay on the Review step.

When there is no app to show (starting, setup failed, nothing started, waiting for an address, a dry run holding the drive), the app's column shows the moment centred, and the feature and Orchestrator draw these identically; only the way out of a failed setup differs (Fix drive, or Open preparation). While the review agent drives, the app stays visible and the head says so.

Picking a scenario is one searchable list in all three places: the caret on the feature's Test drive button, the caret on the project's Test drive button, and the scenario control in a running drive's toolbar. It is grouped ("This feature" first, then the project's groups, then the ungrouped), marks the scenario the drive is on, and ends with Blank app and, on a running drive, New scenario. A search box heads it only past eight scenarios. A scenario with an API call says "API" beside its name.

The project page's resting Test drive row keeps its layout; only its caret opens the new list.

**Shape.** All of this was designed in design mode against the real components, and the designs sit uncommitted in the worktree:

- Both workspaces (the feature page and the project page) swap their chat-and-panel split for the drive page while the panel's view is the drive. The view is already in the address, so a reload returns to it. DESIGN.md's chat-first rule gains this exception.
- A new notes module holds the rail's list, its row and the Send line: plain props in, callbacks out, wired once to feature notes and once to project notes. The chat's composer gains optional labels, a send icon, a single-file attach and a ref to its field.
- A new scenario picker module: the list content (for a combobox the caller owns), the toolbar's scenario control, and the grouping function the list draws from. It is built on the shared searchable picker (Combobox) and reads the existing scenario menu derivation (`scenarioMenu`) unchanged.
- The shared split button gains an optional `picker` beside `menu`: given a combobox content, its caret opens that instead of an action menu. Both Test drive buttons pass the scenario list this way; the header action and next-step bar carry `picker` where they carried `menu`.
- The drive frame (`DrivePanel`) becomes the window: a 44px toolbar (`leading`, `toolbar` on the left; page tools, then `trailing` on the right), plus three new slots: `strip` under the toolbar, `cover` in the page's place (the page kept mounted, its tools put away), and `footer` under the page. The design view uses the same frame; its server menu moves to `trailing`.
- The scenario drive passes its control and App | API as the toolbar, its progress and hint as the strip, and the API view as the cover. The API view loses its own frame and floating toolbar.
- A new shared drive stage takes a drive's server state and draws either the scenario drive in the window, the agent's drive, or the state window with the moment. The feature drive view renders it directly instead of borrowing the review's recording stage. The project drive view renders it with its own way out of a failed setup and its folder for the status line.
- The drive parts gain the state window and its centred moment; the footer becomes the window's status line with the output drawer; the setup failure report reads left-aligned inside the centred window; the feature's failure stops offering a second Stop.

**Left to build** (after the yes commits the designs): the drive page in both workspaces, the rail wired to both note stores, and the captured crop routed to the note box; the review's recording stage keeps only its player, because its live-drive branches are no longer reachable (both remaining callers pass an idle drive); the live-drive tests move to the shared stage. The old action-menu rows for scenarios are deleted. The 13 tests that read the old menu and stage markup are updated, and the scenario picker and the shared stage get their own tests. DESIGN.md gains the drive window under the frame section and STYLE.md the split button's `picker` and the scenario picker.

## Seams

- **The scenario picker** (new): rendered with a scenario menu, it shows the groups in order, marks the current scenario, shows the search box only past eight, and calls back with a file or with null for Blank app. A real-DOM test (it portals).
- **The shared drive stage** (new): for each drive state, it renders the right window: the app with the scenario control, the agent's banner, or the centred moment with its words. Static-markup tests for the in-between states, a real-DOM test for the serving state. The live-drive cases of the existing stage tests move here.
- **The drive notes** (new): for a list of notes it shows pictures, words and ages; Edit and Delete call back; Send shows only with unsent notes. Static-markup tests, plus a real-DOM test for edit and delete.
- **The panel model** (existing, `lib/feature-ui/panel.ts`): which page shows for the drive view, and that a Test drive click lands on it.
- **The drive frame** (existing, `DrivePanel`): the toolbar's order (what the app is on, then tools, then trailing), the strip above and the footer below the page, and the cover hiding the page without unmounting it.
- **The split button** (existing): with `picker`, the caret opens the combobox content; with `menu`, the action menu as before.
- **The project drive workspace** (existing tests): the project drive's header line, its scenarios, and the failed-setup way out.

## Out of scope

- The review step and its recording player: the "The feature's right panel, step by step" feature owns them. Until it lands, the recording player keeps its 16:9 box.
- The shared theme and building blocks beyond the split button's additive `picker`, which is the foundation's.
- Any new drive behaviour: starting, stopping, scenarios running, notes and captures work as today.
- The Notes inbox on the Orchestrator's page and the Review step's notes, including its "all good" wording.
- Several pictures on one note.

## Open questions

- What else about the drive looks wrong to the human, beyond what this plan guessed (decision 11). It is asked with the designs; the answer may reshape decisions 2 to 5.
