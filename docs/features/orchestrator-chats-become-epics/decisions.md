# Decisions — Orchestrator chats become epics

Planned without the human (a self-planning run, 2026-11-09). Decisions 1–3 were settled with the human in the orchestrator's chat (the brief's "Decided with the human"); the rest are this run's own, each marked **Assumed.** with the main alternative.

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
**Decision:** A nested feature held by its own epic's chat drops the "With <chat name> ·" part of its words and reads the rest ("asking you", "Agent working"). Only a feature run by someone else says so: the human ("Yours") or a different chat ("With <that chat>"). Outside an epic (Other features, the shelves), rows keep the full words "Every feature has one owner" builds.
**Why:** The epic's name sits right above; repeating it on every row is noise, and the exception is what the human needs to notice.
**Assumed.** Alternative: every row keeps the full owner words.
**For the human.**

## 11. An epic's row says what it asks and what it is doing
**Decision:** The epic's row shows its name and its chat's state: a yellow dot with "Asking about <feature>" (or "Asking you" when the question is about no one feature), a working shimmer while its agent works, nothing at rest. The hold rings and the hover list of held features go: the nesting replaces them. Clicking the row opens the chat. Epics do not fold.
**Why:** The row is the place to answer the chat; the features under it already say what the epic holds. No fold means one less control and one less state.
**Assumed.** Alternative: each epic can fold its features away.
**For the human.**

## 12. Epic names are 1–3 words, Title Case, set by the orchestrator when it cuts its first feature
**Decision:** The orchestrator names its own chat, in one style: 1 to 3 words, Title Case, a noun phrase ("Payment System", "Feature Ownership"). It does so with a new tool when it cuts the first feature, and may rename while the chat is young. Until then a chat keeps the runtime's generated title. The human's rename (the row menu's Rename, as today) always wins: once the human named a chat, the tool leaves the name alone and says so. The server caps a name's length; the style lives in the project skill as one line.
**Why:** A short noun scans; the moment of the first cut is when the chat knows what it is about. The human keeps the last word on names.
**Assumed.** Alternative: name every chat in epic style from its first reply, question chats included.
**For the human.**

## 13. Today's chats with features in motion get their names on their next turn
**Decision:** A chat that already cut features still in motion, and whose name the orchestrator never set, names itself the next time it runs (the same skill line covers it). Nothing renames chats in bulk when this ships; the human can rename any by hand.
**Why:** Only the chat's own agent knows what the cut was about; a bulk rename would need a model run per chat for chats that may never run again.
**Assumed.** Alternative: a one-off pass at ship time that names every listed chat.

## 14. The screens say "epic"; "Orchestrator" leaves them
**Decision:** Everywhere the app names an orchestrator chat it says epic: the sidebar's list, "New epic" in the create menu and on the list's "+", "All N epics" and the page it opens (today's Conversations page), the command palette, the chat's header (the epic's glyph and name, with no "Orchestrator ›" before it). "Orchestrator" no longer appears on screen; it stays the agent's name in the skills and the docs. What the human sees is one chain: epics hold features, features hold workers, and each has its chat and its agent.
**Why:** Three nouns in one chain, each holding the next, is the smallest model that covers the app. "Orchestrator", "chat", "conversation" and "thread" today name overlapping things.
**Assumed.** Alternative: keep "Orchestrator" as the list's title and let the nesting alone carry the epic idea, with no new word.
**For the human.**

## 15. A feature's page names its epic as the first crumb
**Decision:** A feature's header trail starts with its epic (its origin chat): the epic's glyph and name, then the feature, then the chat in front. Clicking it opens the epic's chat. It stays after the feature ships. A feature with no epic starts with the feature, as today. This replaces `the-sidebar-shows-only-active-threads` decision 13, which named the holder.
**Why:** The crumb says where the feature lives, which is its epic; who runs it is shown by its status words.
**Assumed.** Alternative: keep naming the holding chat.
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
