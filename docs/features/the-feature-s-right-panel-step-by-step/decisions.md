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
