# Orchestrator chats become epics

## Problem

The sidebar lists orchestrator chats and features as two unrelated lists. Chat titles are long sentences in no common style ("I published the package but I'm getting github action errors…"), so the chat list is hard to scan, and nothing shows which chat cut which feature. The human runs one chat per topic, but the screen does not show that. To find what needs them, they read status lanes that mix features from every topic.

Two smaller faults make it worse. The chats are listed only while the Orchestrator is in front: open a feature and they all disappear. And a brand-new chat the human wrote in can drop out of the list when they leave it, so they have to dig it out of "All N chats".

## Approach

**What the human sees.** The sidebar becomes one list of **epics**. An epic is an orchestrator chat with a short name ("Payment System"); the features it cut sit indented under it. The list replaces the Orchestrator card and the lanes for work in motion (Needs you, Agent working, In progress, Up next). Epics with something yellow come first (the chat asks the human, or one of its features needs them); inside an epic, features that need the human come first. So the top row is always the next step, and nothing else reorders. An epic's row shows its name and its chat's state: an amber dot with "Asking about <feature>", a working shimmer, or nothing. Clicking it opens the chat. Features with no epic sit in one "Other features" group after the epics. Backlog, Shipped and Archived stay as shelves at the foot; their rows name their epic quietly. The same list shows on every page and on the phone.

A nested feature run by its own epic's chat does not repeat "With <chat> ·"; only a feature run by someone else says so ("Yours · …", "With <other chat> · …"). The word "Orchestrator" leaves the screens: the list is "Epics", the create menu and the list's "+" say "New epic", "All N epics" opens today's Conversations page (retitled), the chat header shows the epic's glyph and name, and a feature's first crumb is its epic.

The orchestrator names its chat (1–3 words, Title Case, a noun phrase) when it cuts its first feature, or on its next turn for a chat that already has features in motion and no name of its own. The human's rename always wins. When a request does not fit the epic's name, the orchestrator suggests a new epic.

**The shape of it.**

- **Membership** is the feature's origin chat, the field "Every feature has one owner" adds. This feature adds no field. A draft parked by a lead belongs to the epic of the feature it was parked from: the owner feature sets that origin when the draft is created, or this feature does if it does not.
- **The epic list** is a pure ordering over the wire data the sidebar already polls: the feature list and the project's chat list. The pure function groups features under their origin chat, keeps the epics that are listed, orders them, and returns the groups the component draws. A chat is listed while it is active by today's rule, or while any feature it cut is in motion or up next. This replaces holding with origin in the rule that decides whether a chat is listed. The designed component (`SidebarEpics`) and its helpers (`feature-ui/epics`) are already drawn on the design page; the build wires them into the sidebar in place of the Orchestrator card and the in-motion lanes. The sidebar fetches the chat list itself, so the list no longer depends on which page publishes threads.
- **What the epic asks about.** The epic row's "Asking about <feature>" needs the feature that the chat's open question concerns. "Every feature has one owner" (its decision 8) makes the chat row the place for that question; the build reads that link from it. A chat whose question names no feature reads "Asking you".
- **Epic names.** A new MCP tool for orchestrator sessions only sets the session's own chat title. It is refused, with the human's name in the answer, once the human renamed the chat. The server caps the length; the 1–3 word style is a skill line. The name is a `title` event in the chat's log, marked as the orchestrator's. The thread-naming precedence becomes: the human's rename, then the orchestrator's name, then the runtime's generated title, then the first message. The chat list carries whether the orchestrator named the chat, so the skill can tell an unnamed epic to name itself.
- **Skill lines** (project skill, kept short): name your epic when you cut its first feature, or on your next turn if your chat has features in motion and no name; suggest a new epic when a request does not fit the name; call it the epic when you speak to the human.
- **Words.** Each visible "Orchestrator" (the sidebar, the chat header, the Conversations page title and the "All N" link, the command palette, the create menu's "New chat") becomes epic wording. The feature header's first crumb comes from the origin chat, not the holder, and stays after the feature ships.
- **The new-chat fix.** First reproduce it: create a chat, send a first message, open a feature, come back. The code keeps a chat listed for a day once a human prompt is logged in it, so the likely causes are a first send that never logged a prompt on that chat (it was still titled "New chat"), or the list hiding all chats when a feature is open, which the always-on list removes. The fix makes a chat count as written in from the moment its first message is sent.

## Seams

- **Epic ordering (new, pure, web).** Given features and chats, it returns the ordered groups: epics with their nested features and the holder words, then Other features. Covers decisions 4–8, 10, 16 and 21 in tier-1 tests with no DOM.
- **The epic list component (new, web).** `SidebarEpics` rendered as static markup: the amber epic row and its "Asking about" words, nesting, the "Yours" and "With <chat>" rows, Other features, "All N epics".
- **Whether a chat is listed (existing, web).** The rule that decides it counts features by origin, not by holder. Extend its existing tests.
- **Thread naming (existing, server).** The precedence with the orchestrator's name added. Extend the thread-naming tests.
- **The naming tool (new, MCP).** Called by an orchestrator session: the chat list returns the new title; a human-renamed chat refuses and keeps its name; a lead session does not see the tool.
- **The chat list (existing, tRPC `thread.list`).** A chat with a sent first message reports that the human wrote in it, whether or not its log has caught up.
- **The feature header crumb (existing, web).** It names the origin chat.

## Out of scope

- Who owns a feature, the hand-back button, the typing warning, how leads talk to their chat: "Every feature has one owner".
- Status words and need rules: "The status tells the truth about who and what".
- Moving a feature between epics, adding a feature to an epic by hand, folding an epic.
- A bulk rename of today's chats at ship time.
- The docs site, README and landing page wording ("Orchestrator" stays there until a later pass).

## Open questions

- The origin field's exact name and its backfill for features made before it are "Every feature has one owner"'s to settle. This build reads whatever that feature ships. If it ships no backfill, today's features fall into Other features until their chat cuts again. The `created` feature action already records the creating session, which a backfill could read.
- Whether the owner feature records which feature an orchestrator's question concerns. If it does not, this build adds that to the orchestrator's waiting signal, and until then the epic row reads "Asking you".
