# Orchestrator chats become epics

## Problem

The sidebar lists orchestrator chats and features as two unrelated lists. Chat titles are long sentences in no common style ("I published the package but I'm getting github action errors…"), so the chat list is hard to scan, and nothing shows which chat cut which feature. The human runs one chat per topic, but the screen does not show that. To find what needs them, they read status lanes that mix features from every topic.

Two smaller faults make it worse. The chats are listed only while the Orchestrator is in front: open a feature and they all disappear. And a brand-new chat the human wrote in can drop out of the list when they leave it, so they have to dig it out of "All N chats".

## Approach

**What the human sees.** The sidebar becomes one list of **epics**. An epic is an orchestrator chat with a short name ("Payment System"); the features it cut sit indented under it. The list replaces the Orchestrator card and the lanes for work in motion (Needs you, Agent working, In progress, Up next). Epics with something yellow come first (the chat asks the human, or one of its features needs them); inside an epic, features that need the human come first. So the top row is always the next step, and nothing else reorders. An epic's row shows its name and its chat's state: an amber dot with "Asking about <feature>", a working shimmer, or nothing. Clicking it opens the chat. Features with no epic sit in one "Other features" group after the epics. Backlog, Shipped and Archived stay as shelves at the foot; their rows name their epic quietly. The same list shows on every page and on the phone.

A nested feature run by its own epic's chat does not repeat "With <chat> ·"; when the epic's question is about it, it reads "Question above" in the quiet colour, so the epic row is the one yellow thing to click. Only a feature run by someone else says who ("Yours · …", "With <other chat> · …"); a feature the human owns that is consulting its epic's chat reads "Asking above · <first line>". The word "Orchestrator" leaves the screens: the list is "Epics", the create menu and the list's "+" say "New epic", "All N epics" opens today's Conversations page (retitled), the chat header shows the epic's glyph and name, and a feature's first crumb is its epic.

Every orchestrator chat names itself (1–3 words, Title Case, a noun phrase) on its first reply, question chats included, and may rename while young. Once, when this ships, a naming pass gives the chats listed at that moment epic names. The human's rename always wins. When a request does not fit the epic's name, the orchestrator suggests a new epic.

**The shape of it.**

- **Membership** is the feature's origin chat, `chatId`, the field "Every feature has one owner" adds (filled for older features by its boot step). This feature adds no field. It stays when the human takes the feature by typing, and moves when the human gives the feature to a different chat, so the feature moves epic then. A draft parked by a lead belongs to the epic of the feature it was parked from: the owner feature sets that origin when the draft is created, or this feature does if it does not.
- **The epic list** is a pure ordering over the wire data the sidebar already polls: the feature list and the project's chat list. The pure function groups features under their origin chat, keeps the epics that are listed, orders them, and returns the groups the component draws. A chat is listed while it is active by today's rule, or while any feature it cut is in motion or up next. This replaces holding with origin in the rule that decides whether a chat is listed. The designed component (`SidebarEpics`) and its helpers (`feature-ui/epics`) are already drawn on the design page; the build wires them into the sidebar in place of the Orchestrator card and the in-motion lanes. The sidebar fetches the chat list itself, so the list no longer depends on which page publishes threads.
- **What the epic asks about.** The epic row's "Asking about <feature>" needs the feature that the chat's open question concerns. "Every feature has one owner" (its decision 8) makes the chat row the place for that question; the build reads that link from it. A chat whose question names no feature reads "Asking you".
- **Epic names.** A new MCP tool for orchestrator sessions only sets the session's own chat title. It is refused, with the human's name in the answer, once the human renamed the chat. The server caps the length; the 1–3 word style is a skill line. The name is a `title` event in the chat's log, marked as the orchestrator's. The thread-naming precedence becomes: the human's rename, then the orchestrator's name, then the runtime's generated title, then the first message. The chat list carries whether the orchestrator named the chat, so the skill can tell an unnamed epic to name itself.
- **The one-off naming pass.** Once, on the first server start with this feature, each orchestrator chat listed at that moment (by the listing rule above) whose name neither the orchestrator nor the human set gets a name from one short headless model run, given only its title and its first messages, in the way the token check already calls `claude -p`. The result is written as the orchestrator's `title` event, and a project-level record says the pass ran, so it never repeats. A failed run leaves that chat to name itself on its next reply. If this needs machinery out of proportion, it falls back to that alone and the ready handback says why.
- **Skill lines** (project skill, kept short): name your epic in your first reply, 1–3 words, Title Case, a noun phrase, or on your next reply if your chat has no name of yours yet; suggest a new epic when a request does not fit the name; call it the epic when you speak to the human.
- **Words.** Each visible "Orchestrator" (the sidebar, the chat header, the Conversations page title and the "All N" link, the command palette, the create menu's "New chat") becomes epic wording. The feature header's first crumb comes from the origin chat, not the holder, and stays after the feature ships. When that chat also owns the feature, the epic's name and the owner control's finish words share one crumb ("Payment System · you merge"), so the name never shows twice.
- **The new-chat fix.** Traced: a sent first message is logged as the human's and keeps the chat listed (a server test now guards it). The chat that dropped had words typed in its box and not sent: it had no log yet, so it was idle with no human message, and leaving it dropped it (it was still called "New chat", which only an unsent chat is). The rule that decides whether a chat is listed now also keeps a chat whose box holds unsent words (the draft the browser already keeps per chat).

## Seams

- **Epic ordering (new, pure, web).** Given features and chats, it returns the ordered groups: epics with their nested features and the holder words, then Other features. Covers decisions 4–8, 10 ("Question above", "Asking above"), 16 and 21 in tier-1 tests with no DOM.
- **The epic list component (new, web).** `SidebarEpics` rendered as static markup: the amber epic row and its "Asking about" words, nesting, the "Yours" and "With <chat>" rows, Other features, "All N epics".
- **Whether a chat is listed (existing, web).** The rule that decides it counts features by origin, not by holder. Extend its existing tests.
- **Thread naming (existing, server).** The precedence with the orchestrator's name added. Extend the thread-naming tests.
- **The naming pass (new, server).** With the model call stubbed: names only listed chats with no orchestrator or human name, writes the orchestrator's `title` event, and does nothing on a second start.
- **The naming tool (new, MCP).** Called by an orchestrator session: the chat list returns the new title; a human-renamed chat refuses and keeps its name; a lead session does not see the tool.
- **The chat list (existing, tRPC `thread.list`).** A chat with a sent first message reports that the human wrote in it.
- **Whether a chat is listed, drafts (existing, web).** A chat with unsent words in its box is listed.
- **The feature header crumb (existing, web).** It names the origin chat; it joins the owner control when that chat owns the feature, and stays apart when the human or another chat does.

## Out of scope

- Who owns a feature, the hand-back button, the typing warning, how leads talk to their chat: "Every feature has one owner".
- Status words and need rules: "The status tells the truth about who and what".
- Moving a feature between epics, adding a feature to an epic by hand, folding an epic.
- The docs site, README and landing page wording ("Orchestrator" stays there until a later pass).

## Open questions

- Whether the owner feature records which feature an orchestrator's question concerns. If it does not, this build adds that to the orchestrator's waiting signal, and until then the epic row reads "Asking you".
