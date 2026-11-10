# Decisions — Orchestrator chats become epics

Planned without the human (a self-planning run, 2026-11-09). Decisions 1–3 were settled with the human in the orchestrator's chat (the brief's "Decided with the human"); the rest are this run's own, each marked **Assumed.** with the main alternative. An independent challenger read the brief and these decisions; its disagreements are marked **Challenged:**, and decisions 19–21 answer the branches it raised.

On 2026-11-09 the project's orchestrator read the plan on the human's delegation and changed decisions 10, 12 and 13 (each marked **Changed by the orchestrator:**); the human has not confirmed them yet.

The same night the human, through the orchestrator, said to build it ("I want you to finish both features. Don't merge them. I'll check them before (designs and logic)"). The work started on that word; the decisions above stay open for the human's check, and the design's options stay switchable.

Check first: 4, 6, 12, 13, 14

## 1. Several orchestrator chats stay
**Decision:** The project keeps several orchestrator chats; each chat is the home of one cut. One main chat was rejected.
**Why:** Unrelated work would crowd one context.

## 2. A chat row goes yellow only when the chat itself asks the human, and names the feature
**Decision:** An orchestrator chat's row is yellow only when that chat has asked the human something; the row then names the feature the question is about. The feature's own row reads "With <chat name> · asking you" in the plain working colour (built by "Every feature has one owner"). A yellow dot always sits on the thing you click to answer.
**Why:** One ping, on the place where the human answers it.

## 3. A new chat the human wrote in stays listed
**Decision:** Leaving a brand-new chat the human typed a prompt into no longer drops it from the sidebar; it stays listed like any chat written in within the day.
**Why:** The human's open note: today they have to open "All N chats" to find the chat they just started.

## 4. The sidebar is a list of epics, each with its features nested under it
**Decision:** The Orchestrator card and the feature lanes for work in motion (Needs you, Agent working, In progress, Up next) become one list of epics. Each epic is its chat's row; the features it cut sit indented under it. There are no status lanes for work in motion: the nesting is the link, and the yellow-first order (decision 8) keeps the next step on top. The design page keeps the other two shapes on its Tweaks menu: (B) today's lanes, each feature row tagged with its epic's name; (C) a "Needs you" strip on top, then epics.
**Why:** One place per item, and what belongs to what is visible without reading a tag. A sidebar with many epics costs about the same rows as today (each feature once, plus one row per epic), and the phone gets the same list.
**Assumed.** Alternative: (B) keep the lanes and tag each feature row with its epic.
**Changed by the human (2026-11-10), at the design review:** the list has no "Epics" title, and each epic is a card. Its head carries the old Orchestrator card's look: the accent wash, the fading grid, the hub tile and a bold name, with what its chat is doing (or how many features it holds) under the name. Its features sit inside the card on hairlines, as the old Working box held its rows; there is no indent. "Other features" is a plain card with a grey tile. The edge is one quiet hairline in every state. The epic in front brightens its head and its tile, never its outline. While its chat works, the hub's dots breathe in turn and a slow sheen crosses the head. The human's words: "I liked how the sidebar used to look … but the design is worse"; then "clicking on an epic makes the outline bigger which looks bad", and a filled tile "doesn't look very professional".
**For the human.**

## 5. Every orchestrator chat is an epic; one with no features is a quiet row
**Decision:** There is one kind of row for an orchestrator chat. A chat that cut features shows them under it; a chat that has cut none (a question, a triage) is the same row with nothing under it, and leaves the list by today's rule once nothing keeps it there.
**Why:** No second kind to learn and no moment where a row changes kind; a question chat fades within the day anyway.
**Assumed.** Alternative: a chat becomes an epic only once it cuts its first feature, with question chats in a separate quiet group.

## 6. A feature belongs to the chat it came from, not the chat that holds it
**Decision:** A feature nests under its origin chat (the field "Every feature has one owner" adds), whoever holds it now. A feature the human took over stays under its epic; a feature parked as a draft by a lead belongs to the epic of the feature it was parked from. This feature adds no field of its own.
**Why:** What a feature belongs to should not move when who runs it changes; holding moves, the cut does not.
**Assumed.** Alternative: nest under the holder, so a feature the human takes over leaves its epic.
**For the human.**
**Changed by the orchestrator:** the origin field is the owner feature's `chatId`. When the human takes a feature by typing in it, `chatId` stays, so it stays under its epic. When the human gives it to a different chat, `chatId` moves to that chat, so the feature moves to that chat's epic (the owner feature's decision 21, kept).

## 7. Features with no epic sit together after the epics
**Decision:** A feature with no origin chat (made with New feature, or its chat is gone) sits in one group after the epics, labelled "Other features", in the same order an epic uses inside. The group sorts with the epics: it rises to the top when something in it is yellow.
**Why:** Mixing loose feature rows between epics makes it hard to tell where an epic ends; one labelled group keeps "every feature sits under something".
**Assumed.** Alternative: loose features as top-level rows mixed in among the epics.
**For the human.**

## 8. Yellow floats to the top; otherwise the order holds still
**Decision:** Epics with something yellow (the chat asks you, or one of its features needs you) come first; the rest follow. Within each of those two groups, epics keep today's order, newest started first. Inside an epic, features that need you come first, then today's lane order: agent working, in progress, up next.
**Why:** The next step is always the top row, and nothing else moves, so the list stays learnable. Rows that are not yellow never reshuffle by activity.
**Assumed.** Alternative: a fixed order with no floating, relying on the dots alone.
**For the human.**

## 9. Backlog, Shipped and Archived stay as shelves at the foot
**Decision:** Epics nest only features in motion or up next. Parked drafts, shipped and archived features stay in today's shelves at the bottom of the sidebar, across all epics, unchanged.
**Why:** The epic list is about what is moving; a parked idea or a shipped feature nested under every epic would lengthen each one for rows the human rarely opens.
**Assumed.** Alternative: each epic ends with a quiet "2 in backlog · 3 shipped" line that opens them.
**For the human.**

## 10. Inside its epic, a feature row does not repeat who runs it
**Decision:** A nested feature held by its own epic's chat drops the "With <chat name> ·" part of its words and reads the rest ("Agent working"). When the epic's question is about that feature, the row reads "Question above" in the quiet colour, never a second yellow-looking cue: the epic row is the one yellow thing to click. Only a feature run by someone else says who: the human ("Yours · …") or a different chat ("With <that chat> · …"). A feature the human owns that is consulting its epic's chat reads "Asking above · <first line>" in the working colour (outside the epic, "Asking <chat> · <first line>", from "Every feature has one owner"). Outside an epic (Other features, the shelves), rows keep the full words "Every feature has one owner" builds.
**Why:** The epic's name sits right above; repeating it on every row is noise, and the exception is what the human needs to notice. A plain "asking you" under a yellow epic row read as a second thing to do.
**Assumed.** Alternative: every row keeps the full owner words.
**Challenged:** A plain "asking you" right under a yellow epic row can read as a second thing to do; words that point up ("question above"), or none, keep one yellow thing to click.
**Changed by the orchestrator:** it took the challenger's side (2026-11-09, on the human's delegation): "Question above" in the quiet colour, and "Asking above" for a human-owned feature consulting its epic.
**Amended after the review (2026-11-10):** only the chat's question about the feature becomes "Question above". Any other need the epic's chat holds keeps the full words, "With <epic> · Plan to approve". The review found that dropping the name left "Plan to approve" or "Needs your answer" under the epic with no yellow dot, which reads as the human's to do while the chat has it. Rows with no need ("Agent working") never carried the name, so nothing else changes.
**For the human.**

## 11. An epic's row says what it asks and what it is doing
**Decision:** The epic's row shows its name and its chat's state: a yellow dot with "Asking about <feature>" (or "Asking you" when the question is about no one feature), a working shimmer while its agent works, nothing at rest. The hold rings and the hover list of held features go: the nesting replaces them. Clicking the row opens the chat. Epics do not fold.
**Why:** The row is the place to answer the chat; the features under it already say what the epic holds. No fold means one less control and one less state.
**Assumed.** Alternative: each epic can fold its features away.
**For the human.**

## 12. Every epic names itself on its first reply: 1–3 words, Title Case
**Decision:** The orchestrator names its own chat, in one style: 1 to 3 words, Title Case, a noun phrase ("Payment System", "Feature Ownership", "Monday Burn"). It does so with a new tool on its first reply, question chats included, and may rename while the chat is young (for example when it cuts its first feature and the topic is clearer). The human's rename (the row menu's Rename, as today) always wins: once the human named a chat, the tool leaves the name alone and says so. The server caps a name's length; the style lives in the project skill as one line.
**Why:** A short noun scans, and with question chats in the same list (decision 5) every row must read the same way. The human asked for names "very short and easy to scan. Like \"Payment System\"". The human keeps the last word on names.
**Assumed.** Alternative: name a chat only when it cuts its first feature, with the runtime's title until then.
**Challenged:** With question chats in the same list (decision 5), naming only at the first cut leaves sentence titles beside short names, the hard-to-read list the brief complains about; every chat should name itself in epic style on its first reply.
**Changed by the orchestrator:** it took the challenger's side (2026-11-09, on the human's delegation), saying the human asked for exactly this: short names in one style, easy to scan. This run first planned naming at the first cut, with the runtime's title until then.
**For the human.**

## 13. A one-off naming pass names today's listed chats when this ships
**Decision:** Once, when this ships, each chat listed at that moment whose name neither the orchestrator nor the human set gets an epic-style name from one short headless model run, given only its title and its first messages. The pass is recorded so it never repeats. Chats not listed then name themselves on their next reply (decision 12). If the pass turns out to need machinery out of proportion, it falls back to "name yourself on your next turn" and the ready handback says why.
**Why:** A chat whose features the human took over may never run again and would keep its sentence title on ship day; the listed chats are a handful of short runs, done once.
**Assumed.** Alternative: no pass; each chat names itself on its next turn, and a chat that never runs again keeps its sentence title.
**Challenged:** A chat whose features the human took over may never run again and keeps its sentence title on ship day; a one-off naming pass over the chats now listed is a handful of short runs, done once.
**Changed by the orchestrator:** it took the challenger's side (2026-11-09, on the human's delegation). This run first planned no pass. The pass runs models on the human's chats by itself, so it is the human's to confirm.
**For the human.**

## 14. The screens say "epic"; "Orchestrator" leaves them
**Decision:** Everywhere the app names an orchestrator chat it says epic: the sidebar's list, "New epic" in the create menu, "All N epics" and the page it opens (today's Conversations page), the command palette, the chat's header (the epic's glyph and name, with no "Orchestrator ›" before it). "Orchestrator" no longer appears on screen; it stays the agent's name in the skills and the docs. What the human sees is one chain: epics hold features, features hold workers, and each has its chat and its agent.
**Why:** Three nouns in one chain, each holding the next, is the smallest model that covers the app. "Orchestrator", "chat", "conversation" and "thread" today name overlapping things.
**Assumed.** Alternative: keep "Orchestrator" as the list's title and let the nesting alone carry the epic idea, with no new word.
**Challenged:** "New epic" to ask a quick question, and a triage chat called an epic, only reads right if every chat is named in epic style (the challenge on decision 12); otherwise keep "New chat" and let the nesting carry the idea.
**Answered by decision 12's change:** every chat now names itself in epic style, so "New epic" reads right for a question too. The orchestrator kept this decision as planned.
**Changed by the human (2026-11-10):** the list lost its title, and with it its "+"; "New epic" lives in the create menu only.
**For the human.**

## 15. A feature's page names its epic as the first crumb
**Decision:** A feature's header trail starts with its epic (its origin chat): the epic's glyph and name, then the feature, then the chat in front. Clicking it opens the epic's chat. It stays after the feature ships. A feature with no epic starts with the feature, as today. This replaces `the-sidebar-shows-only-active-threads` decision 13, which named the holder.
**Why:** The crumb says where the feature lives, which is its epic; who runs it is shown by its status words.
**Assumed.** Alternative: keep naming the holding chat.
**Changed by the orchestrator:** (2026-11-10) with "Every feature has one owner" merged in, its owner control follows the epic in the header. When the feature's epic chat is also its owner, the two are one crumb: "◆ Payment System · you merge ▾ › Feature". Clicking the name opens the chat; the finish words ("you merge", "merges it", or "yours to plan first" while the human plans it) open the owner menu. When they differ, both stay: "◆ Payment System › Yours ▾ › Feature" (the human took it), or "◆ Payment System › Notes Triage · merges it ▾ › Feature" (another chat runs it). With no epic, the owner control stands alone. The reason: the same name twice in a row reads as two things. When the header runs short of room (the owner feature's width floors), the epic's name gives way down to a few letters ("Paym… · you merge") and the finish words never truncate; the separate epic crumb gives way too.
**For the human.**

## 16. An epic stays listed while it has work in motion
**Decision:** An epic is in the list while any of its features (by origin, decision 6) is in motion or up next, or its chat itself is active by today's rule (working, asking, open, or written in within the day). When the last of its features ships or is parked and the chat is quiet, the epic leaves the list and is found under "All N epics"; writing in it brings it back. This replaces holding with origin in `the-sidebar-shows-only-active-threads` decision 2.
**Why:** A finished epic folds away on its own, and one whose feature the human took over does not vanish while that feature is still moving.
**Assumed.** Alternative: keep counting only held features, so an epic whose features the human took over leaves the list.
**For the human.**

## 17. The phone shows the same epic list
**Decision:** The phone's sidebar drawer shows the same list as the desktop: epics with their features nested, Other features, then the shelves. Tapping an epic opens its chat.
**Why:** One shape on every screen; on the phone today the chats are not listed at all, so this is also a gain.
**Assumed.** Alternative: the phone keeps a flat feature list and reaches epics through a separate page.
**For the human.**

## 18. The epic list stays in the sidebar whatever is open
**Decision:** The epics, with their features, show in the sidebar on every page: an epic's chat, a feature, a worker, Settings. Today the chats are listed only while the Orchestrator is in front, and opening any feature hides them.
**Why:** The list is now the sidebar itself; it cannot depend on which page is open. It also takes away one way a chat seems to vanish (decision 3).
**Assumed.** Alternative: none worth keeping; it follows from decision 4.
**For the human.**

## 19. A chat that drifts suggests a new epic; features never move between epics
**Decision:** When a request in an epic's chat does not fit the epic's name, the orchestrator says so and suggests starting a new epic for it (one skill line). There is no way to move a feature to another epic; a misfiled feature stays where it is, and the human can rename the epic.
**Why:** One topic per epic keeps the list true without a new control to learn.
**Assumed.** Alternative: a "Move to epic" action on feature rows.
**For the human.**

## 20. Work joins an epic through its chat, not a button
**Decision:** Epic rows get no "+" for adding a feature by hand. To add to an epic, the human asks in its chat. New feature in the create menu still makes a feature with no epic (decision 7).
**Why:** One path to add work, one less button.
**Assumed.** Alternative: a "+" on each epic row that opens New feature already set to that epic.
**For the human.**

## 21. Rows on the shelves name their epic quietly
**Decision:** A feature row in Backlog, Shipped or Archived shows its epic's name in the quiet secondary line, so a parked or finished feature still says where it came from. Rows nested under an epic do not, since the nesting says it.
**Why:** Decision 9 takes parked and finished features out of their epic; this keeps "what belongs to what" true on every row at no cost to learn.
**Assumed.** Alternative: shelf rows stay as today, with no epic shown.
**For the human.**
