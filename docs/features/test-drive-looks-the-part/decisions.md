# Decisions — Test drive looks the part

Planned without the human (2026-10-29); the human looked at the designs and
confirmed the plan on 2026-10-30. A decision still marked **Assumed** was made
after that confirmation.

## 1. A scenario is picked from one searchable list, everywhere
**Decision:** Picking a scenario is one searchable list (the app's shared searchable picker, a search box over a list that scrolls), used in all three places a scenario is chosen: the caret on the feature's Test drive button, the caret on the project's Test drive button, and the scenario control on a running drive. The list is grouped ("This feature" first, then the project's groups), marks the scenario the drive is on, and ends with Blank app and New scenario. The search box shows only once there are more than eight scenarios; below that the list is plain rows, one click to pick.
**Why:** The foundation already stops every dropdown at about ten rows, but a capped menu still makes the human read down a long list; typing two letters finds a scenario in a list of forty. Most projects have a handful, where a search box is one more thing in the way. One picker in three places means one thing to learn.

## 2. The running drive is one window: toolbar, app, status line
**Decision:** A running drive is drawn as one framed window that fills the panel's height: a toolbar on top (the scenario on the left, the page tools on the right), the app under it taking all the remaining height, and a thin status line at the bottom (dev server, branch, address, Show output). Today's 16:9 box with an empty header row above it and a separate footer row below it goes.
**Why:** In the side panel the 16:9 box leaves the app short with dead space under it, and the three stacked bands read as three things. A browser-like window is what the human already knows how to read.

## 3. The feature drive and the project drive share one stage
**Decision:** The feature's drive and the project's drive draw the same window and the same in-between states (starting the dev server, setup failed, nothing started, waiting for an address, a preparation dry run holding the drive): centred, quiet, one action at most, in the window where the app will appear. Only the way out differs (a feature drive offers Fix drive, a project drive offers Preparation). While the review agent drives, the app stays visible in the window as today; the toolbar says the agent is driving and offers Stop.
**Why:** Today the feature drive shows left-aligned prose in a box and the project drive shows centred empty states, for the same moments. One look reads as one product.

## 4. A scenario's progress is said in the toolbar and under it, inside the window
**Decision:** The scenario control in the toolbar carries the scenario's state (a spinner while it runs, a red dot when it failed). A running scenario's live output and a failed scenario's error with Fix it sit in a strip directly under the toolbar, inside the window, above the app. The "make it a scenario" hint sits there too.
**Why:** Today these strips sit above the whole frame, so the eye jumps out of the window to read about what is inside it. Inside the window they are read where the app is.

## 5. The project drive's header is one line
**Decision:** The project drive's header becomes one line: "Driving main", its state, Stop drive and the notes toggle. The checkout's folder and the drive's identity move into the window's status line and tooltip.
**Why:** The second line repeats facts read once; the sidebar's calm comes from one line per thing. The facts stay one hover away.

## 6. The design view's toolbar changes with the drive's
**Decision:** The design view draws its page in the same window and toolbar, because both use the same frame component. Its own controls (Back, the server menu) keep their places.
**Why:** Splitting the frame in two to keep the design view as it is would leave two looks for one thing. The change there is look only.

## 7. The review's recording stage is left as it is
**Decision:** The recording player on the review step is not touched. The feature drive stops borrowing the review's stage and uses the shared drive stage from decision 3.
**Why:** The review step belongs to "The feature's right panel, step by step". Today the drive only reaches the review stage's code because the two once shared a canvas. Until that feature lands, the recording player (on the review step and on a shipped feature's page) keeps its 16:9 box and will look different from the drive window; that feature should match it.

## 8. The project page's Test drive row keeps its layout
**Decision:** On the project's resting page, the Test drive row (its button, its hint, the closed "Drive setup" section) keeps today's layout and takes the foundation's sizes. Only its caret changes, to the searchable picker of decision 1.
**Why:** The row already follows the page's grammar (one row like New chat's, setup read once behind a fold). What looked wrong was the menu, not the row.

## 9. Notes stay where they are
**Decision:** The project drive keeps its notes beside the window as the one right-hand aside, open by default. The feature drive keeps no notes column: what the human selects in its app becomes a test note of the feature, as today.
**Why:** This feature is look and layout. Where drive notes live was settled by the features that built them.

## 10. In a narrow panel the toolbar shrinks, never wraps
**Decision:** The toolbar stays one row at any width. As the panel narrows, the scenario's name shortens first (with the full name on hover), then the screen-width control shows only its number. The page tools never fold away.
**Why:** The drive usually sits in a side panel beside the chat, often 500px wide. A second toolbar row would cover the app's top; losing a tool would hide something the human used a moment ago.

## 11. The human's other complaints are asked at the design checkpoint
**Decision:** The brief's open question (what else about the drive looks wrong) is put to the human with the designed screens, at the design checkpoint. Decisions 2 to 5 are this plan's guesses at it, and change if the human points elsewhere.
**Why:** Nobody was present to ask, and the working agreement already has the human look at each feature's designs before it builds.

## 12. The drive window is flush with its surroundings
**Decision:** The drive window loses the inset card: no margin, edge or corners. The app and its toolbar run to the edges around them.
**Why:** The human looked at both on the preview and said flush seems better (2026-10-30).

## 13. The drive takes over the page, with notes and chat in one rail
**Decision:** While the human is on a drive, the drive replaces the page's chat, on a feature and in the Orchestrator alike. The app runs flush beside a 360px rail that opens on Notes, with Chat one tab away; New scenario and Fix it open that tab. The toolbar is the head of the app's column, level with the rail's tabs, so there is no second band. Test drive changes the page at once and shows Starting in place. The back arrow returns to the chat with the drive still running; the sidebar's drive card and a "Back to the drive" button in the page's header return to it. Stop drive goes back to the chat, with one line saying how many notes are unsent. Supersedes: 5, 9, and the panel part of 2.
**Why:** The human picked this from three clickable directions. Today a feature's note box is in the Review view, so writing a note means leaving the app, and the side panel leaves the app about half the width. While a feature's drive runs the agent cannot start a round, so the chat is mostly quiet then.

## 14. One notes rail for both drives, evidence first
**Decision:** The feature's drive and the Orchestrator's draw the same notes: a picture across the rail's full width, the words under it at row size, the note's age, and Edit and Delete in the row, always visible and quiet until the pointer is on the note. Edit works in place and can add or replace the picture. Delete asks in the row, not in a dialog. New notes land at the bottom, beside the box. Sent notes fold into one line.
**Why:** The human said the notes looked bad and had no delete. The app's own were uneven: a feature's keep edit and delete in a menu, and the Orchestrator's drive rail has neither.

## 15. The note box is the chat's composer
**Decision:** Notes are written in the same box as the chat: it grows with the text and takes a pasted, attached or selected picture. Select area puts its crop in this box with the cursor ready, in place of the panel that floated over the app.
**Why:** The human found the input basic and could not add images. One box for the whole app means nothing to learn and nothing to keep in step.

## 16. Nothing in the rail says "all good"
**Decision:** The rail offers Send only while unsent notes exist. With none, there is no button and nothing is sent.
**Why:** The human does not want it. The Review step's own wording belongs to "The feature's right panel, step by step".

## 17. A note keeps one picture
**Decision:** A note carries one picture; adding another replaces it, and many pictures are many notes.
**Why:** The server stores a note's picture under the note's id, so more would need a storage change, which this look-and-layout feature does not take on.

## 18. The rail holds only notes
**Decision:** There is no chat beside the drive: the rail is Notes alone, under a plain "Notes" heading. New scenario and Fix it, which open a chat, go back to the chat page with the drive still running. Supersedes the Chat tab in 13.
**Why:** The human, on seeing the rail: remove the chat panel next to the drive.

## 19. Send to the agent goes back to the chat
**Decision:** Pressing Send to the agent sends the notes and moves the human to the feature's chat page at once, where the agent answers.
**Why:** The human asked for it. Sending hands the work to the agent, so the chat is where the human looks next.

## 20. Send leaves the drive running
**Decision:** Send does not stop the drive. The chat page says that the agent cannot start a round or land its edits while the drive runs, with Stop drive beside it.
**Why:** The human asked to move to the chat, not to stop; stopping also ends the dev server and whatever state the app was in. The line keeps the agent from waiting unnoticed.
**Assumed.** Alternative: Send also stops the drive, so the agent can act at once.

## 21. In the Orchestrator, Stop still lands on the Notes inbox
**Decision:** Stopping a project drive opens the Notes inbox beside the chat, as it does today, instead of the one-line notice a feature gets. Narrows 13.
**Why:** The inbox already shows the notes and the way to sort them, so a second door to it would say the same thing.
**Assumed.** Alternative: the same one-line notice as a feature.
