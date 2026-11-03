# Orchestrator actions show as cards — decisions

Planned without the human (a self-planning run, 2026-11-03). Every decision
below is assumed until the human confirms it.

## 1. One card kind for actions: the features card
**Decision:** Every orchestrator action on a feature shows in the chat as a row of one card kind, the **features card**. A turn gets one card, with one row per feature it acted on. Each row names the feature by its title and says in plain words what the turn did to it: created (started or parked in the backlog), started, planning started, planning stopped, sent a message, brief updated, taken into this chat, merged, test drive started or stopped. A feature acted on twice in one turn is one row with both ("Created · planning started"). Anywhere on a row opens that feature. Four features created in one turn read "4 features created" over four rows.
**Why:** The brief asks for few card kinds, and every one of these actions is "this happened to that feature, click to go there". One row shape covers them all and matches the plan and design cards' family (a well, 520px, one click).
**Assumed.** Alternative: one card kind per action (a created-features card, a merge card, a message card).
**Challenged:** A merge ends a feature's life and deserves a stronger look than "brief updated". (The merged row does wear the shipped glyph and the success tone; it stays a row.)

## 2. Reading, notes, drives of the base branch and refused calls stay in the fold
**Decision:** Only actions that changed a feature make rows. Tools that only read (project context, feature chat, briefs), note triage and note edits, a test drive of the base branch (no feature), and any call that was refused or failed stay folded in "Worked for …" as today. The agent's own words already say why a call was refused.
**Why:** A card says "something changed, go look". Reads change nothing, and a refused call made no change to show; drawing them would bury the real cards.
**Assumed.** Alternative: a red row for a refused action, so the human sees what the orchestrator could not do.

## 3. A row shows what happened and where the feature is now
**Decision:** Each row carries two facts: what this turn did to the feature (fixed, it is history) and the feature's live state in the sidebar row's own words and glyph ("Planning by itself", "Plan to approve", "Working · 3/7 tickets", "Shipped"), amber when it needs the human. The live state comes from the feature list the sidebar already reads, so it never disagrees with the sidebar.
**Why:** The human's next question after "4 features created" is "and where are they now?". Reading the sidebar's words answers it without a new query or a new vocabulary.
**Assumed.** Alternative: rows show only what happened, and the human clicks through for the state.
**Challenged:** Show the live state only on the newest mention of each feature; with every block kept (decision 6), a feature mentioned ten times shows the same state ten times, and old blocks look current. (The designs carry this as a Tweak for the human to try.)

## 4. Cards are recorded when the action succeeds, so they show from now on
**Decision:** When an orchestrator tool succeeds, runcastle writes a card event into that chat's log, as `show_plan` and `show_design` already do. The chat draws cards from those events. Chats from before this feature keep their raw tool calls and lines.
**Why:** The server knows the feature and that the action landed; reading it back out of tool-call JSON in the browser would tie the chat to every tool's output shape, for both runtimes. Old chats are history the human rarely rereads.
**Assumed.** Alternative: rebuild cards from the tool calls already in old logs, so past chats get them too.
**Challenged:** The orchestrator chat is long-lived and is the one the human screenshotted; rebuilding at least create and merge cards for old chats would make the feature visible there at once.

## 5. News lines become a quiet runcastle block with feature rows
**Decision:** Runcastle's news lines (a round finished, a plan is ready, a feature waits for you, merged, a drive failed) show as one quiet block per delivery: a "Runcastle" label, then one row per feature in the same row shape as the features card, named by title, clickable, the event in plain words with an icon for its tone (done, needs you, failed). Lines about the same feature in one delivery join one row ("Round 2 finished · review pass finished"). The block is lighter than an action card, so "what the orchestrator did" and "what happened elsewhere" read apart.
**Why:** The brief asks for the title not the slug, clickable, plain words. Reusing the row keeps one look for "a feature", and a delivery is already one moment in time.
**Assumed.** Alternative: news as the same raised card as actions.

## 6. Repeated news is not grouped across deliveries
**Decision:** Each delivery is its own block in its place in time. Two deliveries about the same feature an hour apart are two blocks.
**Why:** The chat reads in order; folding a feature's earlier news into its latest would hide what happened when, and the live state on each row (decision 3) already shows where it stands now.
**Assumed.** Alternative: collapse a feature's news so only its newest block shows, the older ones folded under it.

## 7. Agent plumbing is hidden, but what the agent read stays one click away
**Decision:** The human sees only the plain-words rows. The full text the agent received ("Read it with get_feature_context…") sits behind a small "What the agent read" disclosure on the block, closed by default.
**Why:** The brief says the plumbing should not be shown to the human; behind a closed disclosure it is not, and it stays there for the rare time an agent misread its news and the human wants to see why.
**Assumed.** Alternative: drop the raw text from the chat entirely.
**Challenged:** A toggle on every block is extra UI for a rare need; fold the raw text into the existing "Worked for" fold instead.

## 8. Other runcastle lines, and a feature's own chat, get the same look
**Decision:** In a feature's chat a draft its agent parks shows the same features card. In either chat, runcastle's lines that are not news (a kickoff, a wake, a resumed chat's briefing: "Proceed with your task…") show a short plain-words line ("Runcastle started this chat to plan the feature by itself"), with the full text behind the same "What the agent read" disclosure; and in a feature's chat a message the orchestrator sent shows in full as the Orchestrator's message, with its icon and name, on the left. A relayed answer reads "Your answer, relayed by the Orchestrator".
**Why:** Today a message from the orchestrator reaches a feature's chat as a grey Runcastle line whose first words are "From the project's orchestrator, not the human:", with the message itself folded behind Show more. The human cannot see what the orchestrator told the agent without a click, and the line names the wrong speaker. That is the same raw-plumbing problem the brief names, in the other chat.
**Assumed.** Alternative: leave a feature's chat as it is apart from the shared features card.

## 9. The orchestrator stops listing in words what a card shows
**Decision:** The project skill gets one line: an action's card shows the feature, so the orchestrator's words say why it acted and what comes next, not the list of features again.
**Why:** A card that says "4 features created" above a paragraph listing the same four by slug is the clutter this feature removes.
**Assumed.** Alternative: leave the skill alone and let the words repeat the card.

## 10. The cards use the app's words as they are today
**Decision:** Card text uses the words the app shows now: the sidebar's status words, "round", "test drive", "plan", "brief", "Orchestrator", "backlog". "Ready to publish" has not settled its word list yet (its decisions so far cover the README, the ping and the phone, not the chat words), so whichever of the two merges second changes any card word that disagrees, as the brief says.
**Why:** Inventing words here could clash with that sweep; the current words are what the human reads beside the cards today.
**Assumed.** Alternative: wait for "Ready to publish" to settle its words before writing card text.

## 11. On a phone a row stacks; nothing is dropped
**Decision:** At 390px a row keeps every fact: the title on its own line (two lines at most), what happened under it, and the live state under that. The card is the chat's full width.
**Why:** The brief says the cards must work at 390px. Each fact is short; dropping the live state on the phone would make the phone the one place it is missing.
**Assumed.** Alternative: on a phone, drop the live state and keep the title and what happened.

## 12. The tool calls stay in the fold; the card sits after the turn's work
**Decision:** A turn's tool calls stay inside "Worked for …" as the record of the work. The turn's features card sits where the plan and design cards sit: after the turn's work, before its final words.
**Why:** The fold is the turn's full record and the card its summary; taking calls out of the fold would make the two disagree when the human opens it.
**Assumed.** Alternative: drop a carded call from the fold.

## 13. A "sent a message" row quotes the message's first line
**Decision:** A row for a message the orchestrator sent a feature quotes the message's first line, clipped to one line on desktop and two on a phone. The full message is in the feature's chat, a click away.
**Why:** What the orchestrator told the feature is the one thing the human wants from that row; "Sent a message" alone tells them nothing.
**Assumed.** Alternative: the row says only "Sent a message".

## 14. A row opens the feature as its sidebar row does, and the card has no buttons
**Decision:** Clicking a row opens that feature exactly as clicking it in the sidebar does (on a phone, its chat). A row needing the human ("Plan to approve") gets no button of its own on the card; the feature page's next-step bar has it.
**Why:** One door per feature keeps the card a summary. The feature page already shows the right next step; a second Approve button in the chat would be a second place for the same action to go stale.
**Assumed.** Alternative: amber rows carry their next step (Open plan, Test drive) on the row.
