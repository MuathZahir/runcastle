# Test drive looks the part

## Problem

The test drive is where the human checks a feature by hand, and today it looks unfinished next to the restyled sidebar. In the feature page's side panel the app sits in a 16:9 box with an empty row above it and dead space below. A scenario's progress and errors sit above the frame, outside the thing they describe. The dev server, branch and address sit in a separate row under it. Picking a scenario is an action menu that, with many scenarios, ran down the whole screen. The foundation now caps it at about ten rows, but it still makes the human read a long list. The project's drive tells the same moments (starting, setup failed, nothing started) in a different layout from the feature's.

## Approach

**What the human sees.** A running drive is one window that fills the panel: a toolbar, the app, and a thin status line, all in one card (the app's shared material, a faint fill with a hairline edge). The toolbar's left side says what the app is on: the scenario, with a glyph for its run (green landed, spinner running, red failed), then App | API when some scenario has an API call. The right side holds the page tools: Select area, Reload, screen width, Open in a new tab. A running or failed scenario, and the "make it a scenario" hint, sit in a strip directly under the toolbar, inside the window. The status line under the app carries Dev server, the branch, the address and Output, which opens the dev server's output as a drawer between the app and the status line. On a project drive the checkout folder and identity also live there.

When there is no app to show (starting, setup failed, nothing started, waiting for an address, a dry run holding the drive), the same window shows the moment centred where the app will appear, with its state named in the toolbar row. The feature drive and the project drive draw these identically; only the way out of a failed setup differs (Fix drive, or Open preparation). The window never repeats Stop: the feature's header and the project drive's header already offer it, and the header's Stop is purpose-blind, so it also takes the wheel back from the review agent. While the review agent drives, the app stays visible and the toolbar says "Review agent driving".

Picking a scenario is one searchable list in all three places: the caret on the feature's Test drive button, the caret on the project's Test drive button, and the scenario control in a running drive's toolbar. It is grouped ("This feature" first, then the project's groups, then the ungrouped), marks the scenario the drive is on, and ends with Blank app and, on a running drive, New scenario. A search box heads it only past eight scenarios. A scenario with an API call says "API" beside its name.

The project drive's header is one line: "Driving main", its state, Stop drive, the notes toggle. Its notes stay the one aside beside the window. The project page's resting Test drive row keeps its layout; only its caret opens the new list.

**Shape.** All of this was designed in design mode against the real components, and the designs sit uncommitted in the worktree:

- A new scenario picker module: the list content (for a combobox the caller owns), the toolbar's scenario control, and the grouping function the list draws from. It is built on the shared searchable picker (Combobox) and reads the existing scenario menu derivation (`scenarioMenu`) unchanged.
- The shared split button gains an optional `picker` beside `menu`: given a combobox content, its caret opens that instead of an action menu. Both Test drive buttons pass the scenario list this way; the header action and next-step bar carry `picker` where they carried `menu`.
- The drive frame (`DrivePanel`) becomes the window: the card, a 44px toolbar (`leading`, `toolbar` on the left; page tools, then `trailing` on the right), plus three new slots: `strip` under the toolbar, `cover` in the page's place (the page kept mounted, its tools put away), and `footer` under the page. The design view uses the same frame; its server menu moves to `trailing`.
- The scenario drive passes its control and App | API as the toolbar, its progress and hint as the strip, and the API view as the cover. The API view loses its own frame and floating toolbar.
- A new shared drive stage takes a drive's server state and draws either the scenario drive in the window, the agent's drive, or the state window with the moment. The feature drive view renders it directly instead of borrowing the review's recording stage. The project drive view renders it with its own way out of a failed setup and its folder for the status line.
- The drive parts gain the state window and its centred moment; the footer becomes the window's status line with the output drawer; the setup failure report reads left-aligned inside the centred window; the feature's failure stops offering a second Stop.

**Left to build** (after the yes commits the designs): the review's recording stage keeps only its player, because its live-drive branches are no longer reachable (both remaining callers pass an idle drive); the live-drive tests move to the shared stage. The old action-menu rows for scenarios are deleted. The 13 tests that read the old menu and stage markup are updated, and the scenario picker and the shared stage get their own tests. DESIGN.md gains the drive window under the frame section and STYLE.md the split button's `picker` and the scenario picker.

## Seams

- **The scenario picker** (new): rendered with a scenario menu, it shows the groups in order, marks the current scenario, shows the search box only past eight, and calls back with a file or with null for Blank app. A real-DOM test (it portals).
- **The shared drive stage** (new): for each drive state, it renders the right window: the app with the scenario control, the agent's banner, or the centred moment with its words. Static-markup tests for the in-between states, a real-DOM test for the serving state. The live-drive cases of the existing stage tests move here.
- **The drive frame** (existing, `DrivePanel`): the toolbar's order (what the app is on, then tools, then trailing), the strip above and the footer below the page, and the cover hiding the page without unmounting it.
- **The split button** (existing): with `picker`, the caret opens the combobox content; with `menu`, the action menu as before.
- **The project drive workspace** (existing tests): the project drive's header line, its scenarios, and the failed-setup way out.

## Out of scope

- The review step and its recording player: the "The feature's right panel, step by step" feature owns them. Until it lands, the recording player keeps its 16:9 box.
- The shared theme and building blocks beyond the split button's additive `picker`, which is the foundation's.
- Any new drive behaviour: starting, stopping, scenarios running, notes and captures work as today.
- The notes aside's own look.

## Open questions

- What else about the drive looks wrong to the human, beyond what this plan guessed (decision 11). It is asked with the designs; the answer may reshape decisions 2 to 5.
- The drive window as a card inset in the panel, or flush with the panel's edges. Left as a Tweaks choice on both preview pages; the plan builds the card unless the human picks flush.
