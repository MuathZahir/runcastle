# Decisions — The feature's right panel, step by step

Planned without the human (2026-10-29). Each decision below is the planner's
own recommendation, accepted so the plan could be finished; the human confirms
or changes them on the plan preview. One independent challenger read the brief
and these decisions; where it disagreed, its reason is kept.

The panel today, seen in the real app on sample data at every step
(`apps/web/preview/feature-panel.html`): every view repeats the feature's title,
branch and age as a full page header; the views sit in a centred page column
built for a whole window; the plan preview is a framed box with its own
scrollbar inside a scrolling page; decisions, spec and every other doc open in a
dialog over the whole app, hiding the chat; and while a round runs, the Work
view lists the same tickets twice.

## 1. This feature is the panel's frame, the plan and the docs; the round, review and shipped views become their own feature
**Decision:** This feature reworks what every view shares (the panel's header, its view switcher, the way a view's body is laid out) and the two views about documents: Plan (the preview, decisions and spec) and Details (the feature's facts, its docs and the doc reader). The insides of Work (the tickets and the running round), Review and Shipped move to a new backlog feature, "The panel's round, review and shipped views", parked as a draft that waits on this one. Those views still pick up the new frame here.
**Why:** The brief asked for a split if the job was too wide, and it is: Work, Review and Shipped are about 4,000 lines of their own (run lanes, transcripts, evidence, rounds) with problems unlike the documents' ones. The frame has to be settled once before any view is redrawn, and the docs view is the one the human named first.
**Assumed.** Alternative: one feature with all six steps, a ticket per step.
**Challenged:** The brief asked the planner to propose the split so the orchestrator could make the cut; the planner parked the follow-on as a draft itself. The cut is easy to undo: delete the draft and widen this feature.

## 2. A view no longer repeats the feature's title, branch and age
**Decision:** The panel's views drop the page header they each open with today (the 22px feature title, the branch and "Started 1d ago"). The page's one header row already names the feature. A view starts with its own content.
**Why:** The design guide's "say it once": the title appears twice on screen, and the repeat costs about 170px at the top of every view in a half-width panel.
**Assumed.** Alternative: keep a small one-line title in each view.

## 3. The views switch by tabs in the panel's header
**Decision:** The panel's header shows the views the feature offers as tabs (icon and word: Plan, Work, Review, Details, and Design or Drive while they run), with fold and close on the right. When the panel is too narrow for every word, the tabs other than the open one keep only their icon, with the word as a tooltip; there is no second, menu-shaped switcher. The preview's Tweaks menu also shows today's menu, for comparison.
**Why:** The design guide says views of one object switch with tabs, and today the views hide behind a menu, so a view that appears (Review, when the feature is ready) goes unseen. Shrinking to icons keeps one design at every width.
**Assumed.** Alternative: keep today's menu, restyled.
**Challenged:** Tabs were taken out of the feature page's header row once before (that row has "no button per panel view, no tabs"), so the human may want the menu kept. This is the panel's own header, not the page's, but it is worth the human's look.

## 4. A view is a panel column, not a page
**Decision:** A view's body fills the panel with 24px sides instead of a centred page column with 48px of air on top. Sections inside a view keep the guide's 16px headings, separated by space. A view that switches between parts of its own (only Plan, here) does it with small tabs on one 40px bar at the top of the view, its facts and actions on the right of that bar; the doc reader uses the same bar for its way back.
**Why:** The page column was made for a whole window; in a panel it leaves narrow content floating in padding. Keeping the second row of tabs to the one view that needs it stops the top of a narrow panel filling with tabs.
**Assumed.** Alternative: keep the page column and only tighten its padding.

## 5. The plan preview fills the Plan view
**Decision:** Under the Plan view's bar, the preview fills the rest of the panel, edge to edge, with one scrollbar: its own. The "Preview" heading, the bordered box and the fixed 60%-of-the-screen height go. The bar keeps "updated 40m ago" and the open-full-window button.
**Why:** Today the preview is a framed box inside a scrolling page, so two scrollbars sit side by side and the human scrolls the wrong one. The preview is the one page the human reads the plan by; it should have the room.
**Assumed.** Alternative: keep the framed box, taller.

## 6. Decisions and spec are read inside the Plan view
**Decision:** The Plan view's bar has three tabs: Preview, Decisions (with its count) and Spec. Decisions and Spec show the document as prose in the panel, not in a dialog. Before a preview exists, the bar has only Decisions and Spec; the live "Updating" mark while the agent writes the spec stays.
**Why:** The plan is these three documents. Opening two of them in a dialog that covers the chat breaks the chat-beside-panel layout the page is built on, and today's two monospace file-name buttons read as code, not as the plan.
**Assumed.** Alternative: keep the buttons, opening the documents in the dialog.
**Challenged:** Decisions and spec become readable in two places, the Plan view and the docs list. The docs list's rows for them could switch to the Plan view's tab instead, so each doc has one reader.

## 7. Every doc opens in the panel, never in a dialog
**Decision:** A doc opened anywhere in the panel (the docs list, the ticket list's Docs menu, the shipped record's outcome link) is read inside the view it was opened from: the view's body gives way to the reader, with a way back to that view, the doc's title, its path and age as one quiet line, then the doc as prose at a reading width. An open-full-window button on the reader's bar gives a wide doc (tables, diagrams) the whole window. The chat stays beside the panel. The doc dialog is retired; nothing outside the panel used it.
**Why:** The brief names how docs are shown first. A dialog hides the chat the human is talking to about that very doc, and the panel already is the reading surface. Reading in place means the way back returns where the human was.
**Assumed.** Alternative: keep the dialog, restyled.

## 8. The docs list reads as documents, not files
**Decision:** The docs list shows each doc by its title with its age ("40m ago") on the right, the plan's documents first (brief, decisions, spec), then the others with their folder as a quiet second line. The file name moves into the reader's path line.
**Why:** The monospace file name on every row repeats the title in code type; the age says what changed recently, which is what the human looks for.
**Assumed.** Alternative: keep the file name on the right of each row.

## 9. Details is one column: the feature's facts, its docs, then its activity
**Decision:** The Details view drops its Knowledge and Activity tabs and becomes one column. At the top, a short two-column list of what the dropped header carried that the page's header row does not: the branch (a click copies it), when the feature started or merged, the features it waits on and the ones waiting on it. Then the docs. Then the activity feed, closed under an "Activity" heading the human opens when they want it; the feed's rows are unchanged.
**Why:** Those facts are looked up, not read every time, and Details is where the feature's record lives; dropping them would lose the only place the branch can be copied from. One column keeps a second row of tabs off a narrow panel, and the activity feed is read rarely, so it stays closed.
**Assumed.** Alternative: keep the two tabs, with the facts above them.

## 10. Work, Review and Shipped get the frame only
**Decision:** Here, the Work, Review and Shipped views change only at their top and edges: no repeated header (decision 2), the panel column (decision 4), and their doc links opening in the panel (decision 7). Everything inside them, including the running round listing its tickets twice, is left to the follow-on feature.
**Why:** It keeps the cut in decision 1 clean: the follow-on redraws those views inside a frame that is already settled, and this feature's designs stay small enough to judge in one sitting.
**Assumed.** Alternative: also fix the doubled ticket list here, since it is the most visible fault of the round view.

## 11. Where things open counts as layout, not new behaviour
**Decision:** Tabs in place of a menu, docs read in the panel instead of a dialog, and Details' activity moved under a closed heading change where things appear, not what the app does. They are in this feature's scope. Nothing new is added: no new view, no new action, no new data.
**Why:** The brief rules out new behaviour. These moves are layout by that reading, but the line is the human's to draw, so it is said here rather than assumed silently.
**Assumed.** Alternative: keep every way of reaching a thing exactly as today and change only how each looks.

## 12. Design and Drive get their tab only
**Decision:** The Design and Drive views gain their place in the header's tabs and nothing else. The test drive's look belongs to "Test drive looks the part", and the design view is a frame around the design server's page.
**Why:** Both are frames around another app; the brief keeps the test drive out of this feature.
**Assumed.** Alternative: give the Design view the panel column too.

---

*The human looked at the designs on 2026-10-29 and asked to simplify much further:
no Review view, the notes in the drive, Work renamed and reduced to one simple list
of tickets that looks like the sidebar. Decisions 13 to 19 record that. Where a
detail below is the planner's reading of it, the decision is marked assumed.*

## 13. This feature takes the round, review and shipped views back
**Decision:** The whole panel is this feature's again: the Tickets view (decisions 17 to 19), the retirement of Review (decisions 14, 15) and the notes in the drive (decision 16) are built here, together with the frame, the plan and the docs. The parked follow-on "The panel's round, review and shipped views" is no longer needed and should be deleted. Supersedes: 1, 10.
**Why:** The human's simplification removes most of what made those views big: one of them goes, and the other becomes one list. What is left fits beside the frame.

## 14. The Review view is retired
**Decision:** The panel has no Review view. Its tab, its body and the shipped record it became after merge are gone; the views are Plan, Tickets and Details, with Design and Drive while they run.
**Why:** The human: "Do we need the review panel?" The status line already says when the feature is ready and what to drive; everything else it held either belongs with the drive, belongs with the tickets, or is read rarely enough to go (decision 15).

## 15. What Review held goes where it is used, or goes
**Decision:** The merge-conflict, refused-drive and nothing-verified notices move atop the chat with the page's other notices. The review agent's findings and its recorded walkthrough show on the review ticket's own row in Tickets. Once merged, Details says "Merged 3h ago" and the outcome leads its docs. The rounds trail is dropped, since Tickets folds the rounds. The project's drive instructions, the spec's deferred scope and the per-ticket accounts leave the panel: the first lives in the project's settings, the second in the spec, the third on each ticket's row.
**Why:** Nothing the human acts on is lost, and nothing is said twice. The rounds trail was the "round section" the human said is not needed.
**Assumed.** Alternative: keep a small "Review" section at the top of Tickets for the findings and the recording.
**Changed by the orchestrator:** the warnings go into the notice strip on the message box that "The chat looks the part" built, not into a notice area above the chat (decision 21).

## 16. Notes for the agent live in the drive
**Decision:** Writing notes while driving, the notes list and Send to agent move from Review into the feature's drive view, under the running app. Notes are about what the human sees in the drive, so they sit where they are seen. Under rather than beside, so a half-width panel keeps the app its whole width. Supersedes: 12, for the Drive view.
**Why:** The human: the notes "should be in the drive panel". Drawn beside the app first, the notes squeezed it to a sliver in a half-width panel.
**Assumed.** Alternative: notes beside the app as an aside, as the project drive keeps them.
**Note:** "Test drive looks the part" (planned, not built) decided the feature drive keeps no notes column (its decision 9). The two need reconciling; this one follows the human's newer word.

## 17. Work becomes Tickets
**Decision:** The Work view is renamed Tickets, keeping its list icon.
**Why:** The human suggested "Workers" or "Tickets". Tickets is the word the rest of the app already uses (rounds hold tickets; the agent "makes tickets"), and a ticket outlives its worker.
**Assumed.** Alternative: Workers.

## 18. Tickets is one list: the current round, earlier rounds folded above
**Decision:** One list, no Run and Tickets sections. Earlier rounds sit at the top, each folded to one line ("Round 1 · 4 of 4 landed · 18m"), opening to their tickets. Below them, the current round's tickets. Before the first round the current round is the tickets waiting to run; after a round has finished and new tickets wait, those are the next round and the finished one folds. The run timeline and the run history picker go; Stop stays in the page's header.
**Why:** The human: "just the tickets of the current round with all rounds collapsed above". Today the running round's tickets show twice, once as run lanes and once as the ledger.

## 19. A ticket is a sidebar row
**Decision:** Each ticket is drawn like a feature row in the sidebar: two lines, the title at 14px with its number before it, then a 12px line of a status glyph, the state in words ("Running · 4m", "Landed · a1b2c3d", "Waits on #1", "Failed · no commits") and the model. A running ticket's words shimmer as a working sidebar row does. Clicking a ticket opens it in place as a card: its actions as small quiet buttons (stop, retry, model, edit, cancel, as its state allows), the goal and acceptance criteria, then the worker's live log or its digest. The controls for the whole list (one model for every waiting ticket, the default model, the sandbox) move into a "…" menu on the view's bar.
**Why:** The human asked for the tickets to look better and match the sidebar. A row that says its state in words reads at a glance; the detail is one click away instead of on every row.
**Assumed.** Alternative: one-line rows with the state as a trailing word, as today but restyled.

## 20. The drive is left alone; until it takes the notes, they sit in Details
**Decision:** This feature does not touch the drive view: the human said to forget it, because another feature is working on it. The notes for the agent do not move there here. The pieces stay (`OpenWork`, `NoteComposer`, `SendToAgent`, `WorkList`, `NotesRail`) so that feature can mount them. Since Review was the only place to write notes and press Send to agent, they show in Details for now, under the docs, under the same condition Review used (a drive is up, or the agent declared ready). Removing them from Details when the drive takes them is one prop. Supersedes: 16.
**Why:** The human: "Forget about the drive panel (it's being worked on by another feature)." Retiring Review with no other home would leave notes taken in a drive with no way to reach the agent.
**Assumed.** Alternative: no notes anywhere until the drive feature lands; the human reports in the chat.
**Changed by the orchestrator:** superseded by decision 23; the drive's rail is the notes' home.

## 21. Review's warnings are standing rows on the chat's notice strip
**Decision:** The merge-conflict, conflict-resolved, refused-drive, nothing-verified and project-drive-blocking warnings show as rows on the notice strip on the message box, in its one-line shape: a title, a short subtitle, an action only where the warning had one. Unlike the strip's event notices they stand while their condition holds and go when it ends. Details a one-liner cannot hold (a conflict's file list, a refusal's raw message) go in the row's tooltip.
**Why:** The orchestrator, for the merge with "The chat looks the part": the old floating notice deck is gone and the strip is where the chat says what needs attention. The strip's rows came only from events and each needed an action, so it gains this one kind of row.
**Assumed.** Alternative: keep today's full cards in the area above the thread, which the strip's feature left for page alerts.
**Changed by the orchestrator:** this placement is the orchestrator's instruction, not yet seen by the human.

## 22. Tickets offers no human Retry
**Decision:** The opened ticket card does not offer Retry, Retry on another model, Retry fresh or Resolve with agent. A failed ticket keeps what the panel already gave it: the model picker, Edit, Cancel and, for a landing conflict, Resolve in terminal. Supersedes: 19, for "retry".
**Why:** The human's Retry and Waive were removed on purpose by an earlier feature: a failed ticket is the agent's to handle (tickets-and-review-are-tools-not-phases, decision 12). The planner's design and ticket 1 brought them back by mistake, against this feature's own "no new behaviour" (decision 11).
**Assumed.** Alternative: keep Retry, as the design the human approved showed it.

## 23. Notes do not sit in Details; the drive's rail is their home
**Decision:** Details shows no notes. "Test drive looks the part" takes them: the human chose its direction A, where the drive is a full page of its own with a right rail of Notes, then Chat, for the feature drive and the project drive. Send to agent lives there. The Review view's "all good" send goes with Review. This feature leaves the panel's Drive tab alone and does not redesign it; test drive decides how a drive is entered. Test drive merges before this feature, and this branch takes its change when it lands. Supersedes: 20.
**Why:** The stopgap existed only because notes had no home, and now they have one by the human's own choice of direction.
**Assumed.** Alternative: keep the stopgap in Details until test drive has landed.
**Changed by the orchestrator:** relayed from "Test drive looks the part"; the human chose direction A but has not yet said yes to building it.
