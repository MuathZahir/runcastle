# Decisions — Test drive looks the part

Planned without the human (2026-10-29). Every decision below is marked
**Assumed** until the human confirms or changes it.

## 1. A scenario is picked from one searchable list, everywhere
**Decision:** Picking a scenario is one searchable list (the app's shared searchable picker, a search box over a list that scrolls), used in all three places a scenario is chosen: the caret on the feature's Test drive button, the caret on the project's Test drive button, and the scenario control on a running drive. The list is grouped ("This feature" first, then the project's groups), marks the scenario the drive is on, and ends with Blank app and New scenario. The search box shows only once there are more than eight scenarios; below that the list is plain rows, one click to pick.
**Why:** The foundation already stops every dropdown at about ten rows, but a capped menu still makes the human read down a long list; typing two letters finds a scenario in a list of forty. Most projects have a handful, where a search box is one more thing in the way. One picker in three places means one thing to learn.
**Assumed.** Alternative: keep today's action menu, now capped and scrolling, or a list of scenarios down the side of the drive.

## 2. The running drive is one window: toolbar, app, status line
**Decision:** A running drive is drawn as one framed window that fills the panel's height: a toolbar on top (the scenario on the left, the page tools on the right), the app under it taking all the remaining height, and a thin status line at the bottom (dev server, branch, address, Show output). Today's 16:9 box with an empty header row above it and a separate footer row below it goes.
**Why:** In the side panel the 16:9 box leaves the app short with dead space under it, and the three stacked bands read as three things. A browser-like window is what the human already knows how to read.
**Assumed.** Alternative: keep the 16:9 stage and only restyle its bands.
**Challenged:** The status line repeats facts the project header and drive state already show; put the address in the toolbar like a browser's and drop the status line, for two bands instead of three. (Kept: in a narrow side panel the toolbar has no room for an address, and the status line is where the dev server's output opens.)

## 3. The feature drive and the project drive share one stage
**Decision:** The feature's drive and the project's drive draw the same window and the same in-between states (starting the dev server, setup failed, nothing started, waiting for an address, a preparation dry run holding the drive): centred, quiet, one action at most, in the window where the app will appear. Only the way out differs (a feature drive offers Fix drive, a project drive offers Preparation). While the review agent drives, the app stays visible in the window as today; the toolbar says the agent is driving and offers Stop.
**Why:** Today the feature drive shows left-aligned prose in a box and the project drive shows centred empty states, for the same moments. One look reads as one product.
**Assumed.** Alternative: restyle each drive in place and keep their separate state layouts.

## 4. A scenario's progress is said in the toolbar and under it, inside the window
**Decision:** The scenario control in the toolbar carries the scenario's state (a spinner while it runs, a red dot when it failed). A running scenario's live output and a failed scenario's error with Fix it sit in a strip directly under the toolbar, inside the window, above the app. The "make it a scenario" hint sits there too.
**Why:** Today these strips sit above the whole frame, so the eye jumps out of the window to read about what is inside it. Inside the window they are read where the app is.
**Assumed.** Alternative: keep the strips above the frame.

## 5. The project drive's header is one line
**Decision:** The project drive's header becomes one line: "Driving main", its state, Stop drive and the notes toggle. The checkout's folder and the drive's identity move into the window's status line and tooltip.
**Why:** The second line repeats facts read once; the sidebar's calm comes from one line per thing. The facts stay one hover away.
**Assumed.** Alternative: keep the folder and identity on a second line under the title.

## 6. The design view's toolbar changes with the drive's
**Decision:** The design view draws its page in the same window and toolbar, because both use the same frame component. Its own controls (Back, the server menu) keep their places.
**Why:** Splitting the frame in two to keep the design view as it is would leave two looks for one thing. The change there is look only.
**Assumed.** Alternative: copy the frame so the design view keeps today's look.
**Challenged:** Restyling the design view goes beyond the brief, and it is the screen other features' designs are judged in; tell the human at the design checkpoint rather than assume it. (Kept, and put first among the decisions to check.)

## 7. The review's recording stage is left as it is
**Decision:** The recording player on the review step is not touched. The feature drive stops borrowing the review's stage and uses the shared drive stage from decision 3.
**Why:** The review step belongs to "The feature's right panel, step by step". Today the drive only reaches the review stage's code because the two once shared a canvas. Until that feature lands, the recording player (on the review step and on a shipped feature's page) keeps its 16:9 box and will look different from the drive window; that feature should match it.
**Assumed.** Alternative: restyle the recording stage here too.

## 8. The project page's Test drive row keeps its layout
**Decision:** On the project's resting page, the Test drive row (its button, its hint, the closed "Drive setup" section) keeps today's layout and takes the foundation's sizes. Only its caret changes, to the searchable picker of decision 1.
**Why:** The row already follows the page's grammar (one row like New chat's, setup read once behind a fold). What looked wrong was the menu, not the row.
**Assumed.** Alternative: redraw the row as a card with the scenarios listed in it.

## 9. Notes stay where they are
**Decision:** The project drive keeps its notes beside the window as the one right-hand aside, open by default. The feature drive keeps no notes column: what the human selects in its app becomes a test note of the feature, as today.
**Why:** This feature is look and layout. Where drive notes live was settled by the features that built them.
**Assumed.** Alternative: give the feature drive a notes aside too.

## 10. In a narrow panel the toolbar shrinks, never wraps
**Decision:** The toolbar stays one row at any width. As the panel narrows, the scenario's name shortens first (with the full name on hover), then the screen-width control shows only its number. The page tools never fold away.
**Why:** The drive usually sits in a side panel beside the chat, often 500px wide. A second toolbar row would cover the app's top; losing a tool would hide something the human used a moment ago.
**Assumed.** Alternative: fold the page tools into a "…" menu when narrow.

## 11. The human's other complaints are asked at the design checkpoint
**Decision:** The brief's open question (what else about the drive looks wrong) is put to the human with the designed screens, at the design checkpoint. Decisions 2 to 5 are this plan's guesses at it, and change if the human points elsewhere.
**Why:** Nobody was present to ask, and the working agreement already has the human look at each feature's designs before it builds.
**Assumed.** Alternative: wait to design until the human answers.
