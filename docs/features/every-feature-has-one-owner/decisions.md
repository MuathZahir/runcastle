# Decisions — Every feature has one owner

Planned without the human (a self-planning run, 2026-11-09). Decisions 1–10 were settled with the human in the orchestrator's chat (the brief's "Decided with the human"); the rest are the planner's, each marked assumed. One independent challenger read the brief and these decisions; 27–29 answer the branches it raised, and its disagreements are marked **Challenged**.

Check first: 11, 12, 13, 17, 24

The orchestrator agreed the plan on 2026-11-09 with changes to 12, 17, 20, 21 and 24 and a new 30, each marked where it changed; the human checks them in the morning.

## 1. One owner per feature: the human, or one orchestrator chat
**Decision:** Every feature has exactly one owner at a time: the human, or one orchestrator chat. The feature's sidebar row and header say which. Under the hood this is today's holder (ADR-0016): held by an orchestrator chat means that chat owns it; no holder means the human does.
**Why:** Nothing decided where a feature's conversation lives, so the same questions reached the human in two places.

## 2. A feature the human owns talks only to the human, in its own chat
**Decision:** It works as a feature with no orchestrator does today: the lead asks, declares ready, the human drives and merges from the feature.
**Why:** One place to answer.

## 3. A feature an orchestrator chat owns talks only to that chat
**Decision:** Its lead brings everything to the chat by `hand_back`, never `wait_for_you` to the human. The chat settles what it can; what is the human's it asks in its own chat. Plans and designs reach the human there on the same plan and design cards the lead uses (opening the feature's Plan or Design tab), never as a raw HTML file.
**Why:** One place to answer, and the same cards wherever the human meets them.

## 4. A feature the human grills is theirs while they grill it
**Decision:** Even inside an autonomous cut. At their plan yes, if they chose to let the orchestrator take it further, it passes to the chat it came from. This is the one owner change built into the flow.
**Why:** The grill happens in the feature's chat, with the human.

## 5. The owner changes only when the human changes it
**Decision:** Typing in an orchestrator-run feature's chat makes it the human's, after a warning before the first message (roughly: "The '<chat>' chat runs this. Sending makes it yours."). The chat is told it let go. Handing it back is one control on the feature, or "run X for me" in any orchestrator chat.
**Why:** Ownership never moves behind the human's back.

## 6. Decisions that reach beyond the feature go to the chat it came from
**Decision:** When the lead of a human-owned feature hits something that touches another feature or which features exist, it asks the orchestrator chat that cut the feature (features remember their origin chat; new). That chat answers the lead in the background with facts and a recommendation; the lead puts it to the human in the feature's chat, and the human answers there. Asking does not change the owner. If the human's answer changes another feature, the lead passes the human's words to that chat, which acts. A feature with no origin chat asks the human directly.
**Why:** The chat that cut the features knows them; the human still answers in one place.

## 7. Working agreements become a per-feature choice of how far the orchestrator takes it
**Decision:** The three working agreements (autonomous, checkpoints, check-in) are replaced by a per-feature choice: the human finishes it; the orchestrator builds it and shows the human before merging; or the orchestrator merges it itself. Named checkpoints go ("let me play the core first" becomes "show me before merging" on the core feature, plus the cut's order). How it is planned (grilled with the human, or plans itself) stays a separate choice. The words must say plainly what happens; fewer choices is better.
**Why:** "You run it" was too vague to know whether the human gets grilled, shown, or skipped.

## 8. A yellow dot sits on the thing you click to answer
**Decision:** A feature row is yellow only when its own chat has something for the human. When an orchestrator chat asks the human about a feature it runs, only that chat's row goes yellow, and it names the feature; the feature row reads "With <chat name> · asking you" in the plain working colour. Clicking a feature still opens its lead (`clicking-a-feature-opens-its-lead` decision 7 stands).
**Why:** The human follows the yellow dots; each dot must lead to where the answer goes.

## 9. An orchestrator's news about a human-owned feature is posted in the feature's chat
**Decision:** When an orchestrator notices something about a feature the human owns (a sibling merged that changes things, a collision), it posts it in that feature's chat, marked as from the orchestrator, and does not take the feature.
**Why:** The human is talking about that feature there.

## 10. Several orchestrator chats stay
**Decision:** Each chat is the home of one cut; the sibling feature "Orchestrator chats become epics" makes that visible. The human rejected one main chat.
**Why:** Unrelated work would crowd one context.

## 11. One owner control on the feature's header does both jobs
**Decision:** The feature header starts with one owner control. It shows who owns the feature and, for a chat, how far it takes it; clicking opens a short menu of three choices: the human finishes it, the chat shows them before merging, or the chat merges it. Picking the human's choice is "take it"; picking a chat's choice is "hand it back". There is no separate hand-back button and no separate how-far setting. It replaces the holder's name at the start of the header's trail. The same menu sits in the feature row's "…" menu.
**Why:** Who owns it and how far the chat goes are one fact for the human; two controls would be two things to learn.
**Assumed.** Alternative: a "Hand back to <chat>" button beside the title plus a separate how-far setting in the feature's details.
**For the human.**

## 12. The words of the owner control
**Decision:** The control reads "Yours", "<Chat> · shows you before merging" or "<Chat> · merges it". Its menu offers "I'll finish it", "<Chat> builds it and shows me before merging", "<Chat> builds and merges it", each with one line under it saying what that means. The words use the human's own phrase "show me before merging". The design keeps a second set of words switchable (a Tweak) so the human can compare.
**Why:** Each option names who does the last step, merging, which is what the human said was vague.
**Assumed.** Alternative: "You finish it / Built, you merge / Built and merged".
**For the human.**
**Challenged:** "<long chat title> · shows you before merging" will not fit the header; show "<Chat> · you merge" / "<Chat> · merges" there and keep the long sentences in the menu. (The design's Tweak switches to exactly that.)
**Changed by the orchestrator (2026-11-09, on the human's delegation):** the header takes the short words: "Yours" / "<Chat> · you merge" / "<Chat> · merges it". The menu keeps the long sentences. The header must fit whatever the chat's name is long or short; it truncates the name, never the "· you merge" part. The design's long header set is dropped; the build follows the short set.

## 13. How it is planned is chosen once, in the orchestrator chat, and is not on the feature
**Decision:** The planning choice ("Plan it with me" or "Plan it yourself and show me") is asked when the chat cuts the feature, as today, and is not shown or changed on the feature. Once the plan has its yes it no longer matters.
**Why:** A choice that is spent after one step should not take room on every feature's header.
**Assumed.** Alternative: a second control on the header for the planning mode.
**For the human.**
**Challenged:** the human's own words read like one scale (grilled for the plan, plans and shows, also merges); one cut-time question with three steps would halve the choices. Kept separate because decision 7, the human's, keeps planning a separate choice.
**Kept by the orchestrator (2026-11-09):** kept as planned, because the one scale would change the human's decision 7; the orchestrator puts it to the human in the morning. The build keeps the planning choice in one place (the cut's question and the launch), so folding it into one three-step question later is a small change.

## 14. A grilled feature the chat takes after the plan says so while it is grilled
**Decision:** While the human grills a feature whose choice is a chat's, the owner control reads "Yours to plan · then <Chat>". At the human's plan yes the lead passes it to that chat with its handback, and the control changes to the chat. The lead says so in its chat in one line.
**Why:** The one built-in owner change (decision 4) should never surprise the human.
**Assumed.** Alternative: ask again at the plan yes who finishes it.
**For the human.**

## 15. The feature row names its chat whenever the chat owns the next move
**Decision:** A chat-owned feature's row says "With <Chat> · <what is happening>" whenever its lead is not working: handed back, asking you, ready to test, plan sent. While the lead or its workers work it still reads "Agent working" or "Working · 2 workers". A human-owned row is unchanged. The orchestrator chat's row keeps the rings of the features it owns.
**Why:** The name is what tells the human which chat to open; while an agent works there is nothing to open.
**Assumed.** Alternative: a small orchestrator mark on every chat-owned row, always.
**For the human.**

## 16. Under a chat owner, a feature row goes yellow only for what only the feature can answer
**Decision:** When a chat owns the feature, its row goes yellow only for a permission prompt in the lead's terminal or a "with you" worker's question: things the human can only answer inside the feature. A plan or design to approve, ready to test and a merge conflict go to the chat by handback, and the row reads "With <Chat> · …". This supersedes in part `the-status-tells-the-truth-about-who-and-what` decision 6, which never held a design to approve.
**Why:** Decision 8: the dot sits where the answer is given, and a chat-owned feature's answers are given in the chat.
**Assumed.** Alternative: keep base decision 6, so a waiting design lights the feature row too.
**For the human.**

## 17. "Asking you" is read from facts runcastle already has
**Decision:** A feature reads "With <Chat> · asking you" when it has an outstanding handback and its owner chat is asking the human (its turn ended on a question). That chat's row is yellow and names the feature in its words ("Asking about <feature>", "+1" for more). The one-hour safety net (base decision 2) runs only while the owner chat is neither asking nor working; then the feature reads "Handed back · …" under Needs you.
**Why:** No new tool and no guess: an owner chat that is asking has the human's attention already, and the hour still catches a chat that went quiet.
**Assumed.** Alternative: a tool the chat calls to say which feature it is asking about.
**For the human.**
**Challenged:** a chat that owns five handed-back features and asks about one would mark all five "asking you"; the chat should name the feature it asks about (a field on a tool it already has, or a small new one). Correct dots matter more than one tool fewer.
**Changed by the orchestrator (2026-11-09, on the human's delegation):** the challenger's way. A chat that holds five handbacks and asks about one marks only that one. The feature it asks about is read from a fact the chat already produces: the features whose plan, design or review card the chat showed in the turn that ended on a question. Only if that fact is not enough (a question asked in words, with no card) does the build add an optional feature field to a tool the chat already has. The hour safety net stays as above.

## 18. A lead under a chat owner cannot wait on the human
**Decision:** When a chat owns the feature, the server refuses the lead's `wait_for_you` with a line telling it to `hand_back` instead, and the lead and project skills each say "talk to your owner" in one rule.
**Why:** A rule the server keeps cannot drift with a habit; the skills get shorter, not longer.
**Assumed.** Alternative: the skills say it and nothing refuses.

## 19. An orchestrator chat acts only on features it owns
**Decision:** A chat's acting tools work only on features it owns. On a human-owned feature it may post a marked note in the feature's chat (decision 9) and answer its lead (decision 6); anything else is refused until the human gives it the feature ("run X for me" or the owner control). Today the first acting tool silently claims an unheld feature; that goes.
**Why:** Decision 5: the owner changes only when the human changes it.
**Assumed.** Alternative: keep the silent claim for features nobody has touched yet.
**For the human.**

## 20. A human-owned feature's lead asks its chat with the same handback
**Decision:** `hand_back` reaches the feature's owner chat, or, when the human owns it, the chat it came from. While that question is out the feature reads "With <Chat> · <the question's first line>" in Working; the chat's answer reaches the lead as a message. Asking never changes the owner.
**Why:** One tool for "talk to the chat" keeps the lead's rules short.
**Assumed.** Alternative: a separate ask-the-chat tool.
**For the human.**
**Challenged:** "With <Chat>" is the phrase that means the chat owns it; a human-owned feature asking its chat should read "Asking <Chat> · …" so ownership never blurs.
**Changed by the orchestrator (2026-11-09, on the human's delegation):** the challenger's way. "With <Chat>" means only that the chat owns the feature. A human-owned feature whose lead is asking its chat reads "Asking <Chat> · <the question's first line>", in the working colour, never yellow.

## 21. The chat a feature came from is remembered on the feature
**Decision:** A feature remembers its chat: the orchestrator chat that created it, replaced by any chat the human later gives it to. It moves to a replacement chat when its chat is too long to reopen, as holds do (ADR-0016). A feature made with the sidebar's New feature button has none; its owner control then offers only "I'll finish it", with a line saying to ask an orchestrator chat "run <feature> for me".
**Why:** "The chat it came from" should mean the chat that knows it best now, not one the human has moved on from.
**Assumed.** Alternative: the creating chat only, never changed.
**For the human.**
**Challenged:** a one-item menu is a dead end; with no chat the control should read "Yours", not open, and carry the "run X for me" line as its hover.
**Changed by the orchestrator (2026-11-09, on the human's delegation):** the challenger's way. With no chat the control reads "Yours" and does not open; hovering it says to ask an orchestrator chat "run <feature> for me". The row's "…" menu shows no owner choices for such a feature.

## 22. A chat that has ended still owns its features
**Decision:** An orchestrator chat whose process ended keeps its features; a handback wakes it again, as today. Ownership never lapses with time.
**Why:** The process ending is routine; it is not the human changing the owner.
**Assumed.** Alternative: features of an ended chat become the human's.

## 23. Taking a feature by typing shows a strip, and the chat learns quietly
**Decision:** While a chat owns the feature, a strip above the lead's composer reads "<Chat> runs this feature. Sending makes it yours." Sending the first message makes it the human's and the strip goes. The chat is not woken; it is told when it next runs, and its tools refuse the feature from then on. Only a typed message in the lead's main chat does this: testing, merging, approving a design, answering a permission prompt, or writing to a worker or a side chat never take the feature. Taking it drops the outstanding handback, and the chat's question about it stops counting at once.
**Why:** The warning costs one line; waking a chat for news it cannot act on costs a turn.
**Assumed.** Alternative: wake the chat with the news at once.
**For the human.**

## 24. Today's features move to the new rules once, with nothing merged without the human
**Decision:** A one-time step at boot: each feature held by a chat keeps that chat as owner and as its chat, with "shows you before merging"; each unheld feature is the human's with no chat. Nothing is read from the briefs' working-agreement lines.
**Why:** Parsing old prose is fragile, and the cautious default never merges without the human; they can change any feature with one click.
**Assumed.** Alternative: read each brief's working agreement and set "merges it" where it said autonomous.
**For the human.**
**Challenged:** unheld features a chat cut (being grilled now) would lose their chat; recover it from the feature's creation record where one exists, and list every feature whose behaviour changed in a summary the human sees.
**Changed by the orchestrator (2026-11-09, on the human's delegation):** an unheld feature gets its chat back from its creation record where that record names a chat; it stays the human's, with finish "I'll finish it". Held features move as above. There is no summary screen: the lead lists every feature that moved, and how, in its ready handback, and the orchestrator puts that list in its report to the human.

## 25. The orchestrator reads the choice from the feature, not the brief
**Decision:** The project skill drops working agreements and checkpoints. When it cuts a feature it asks the two choices in plain words and passes them to `create_feature`; afterwards it reads the feature's choice from the feature, and changes it only on the human's words. Briefs stop carrying a working-agreement line.
**Why:** One source of truth the human can see and change on the feature.
**Assumed.** Alternative: keep the line in the brief and show it on the feature.
**For the human.**

## 26. This feature's place against earlier decisions
**Decision:** It supersedes in part `the-status-tells-the-truth-about-who-and-what` decisions 6 (what a chat-owned feature holds), 8 and 13 (under a chat owner `wait_for_you` is refused, not merely avoided), `one-orchestrator-no-mode` decision 11 (the working agreement stays), and ADR-0016's silent claim on first act. Those docs are not edited.
**Why:** Shipped features' docs record what was true when they shipped.
**Assumed.** Alternative: none; recorded for the trail.

## 27. Designs always wait for the human's own yes
**Decision:** Whatever the finish choice, a design is approved only by the human (the Approve button, or their own words relayed). "Merges it" lets the chat give the plan's yes and merge after a clean review; it never approves a design.
**Why:** The human said they want to see the options and choose; a chat that merges should not also pick the look.
**Assumed.** Alternative: under "merges it" the chat approves designs too.
**For the human.**

## 28. The strip above the composer always offers the way to the chat
**Decision:** While a chat owns the feature, the strip reads "<Chat> runs this feature. Sending makes it yours." with an "Open <Chat>" link; while the chat is asking the human about it, it reads "<Chat> is asking you about this feature." with the same link. It is neutral, never amber.
**Why:** A human who clicks the plain "With <Chat> · asking you" row lands in the lead; the next step must be one click to the chat, never a takeover.
**Assumed.** Alternative: the strip only warns, and the human finds the chat in the sidebar.
**For the human.**

## 29. Taking one feature leaves the rest of the cut with its chat
**Decision:** When the human takes a feature, its chat keeps the rest of the cut and its order; a sibling that waits on the taken feature starts when that feature merges, which the chat hears about from runcastle's events. The chat never takes the feature back by itself.
**Why:** Taking one feature is not stopping the cut; and decision 5 says only the human moves the owner.
**Assumed.** Alternative: taking one feature pauses the chat's cut until the human says to go on.
**For the human.**

## 30. The chat row's look belongs to "Orchestrator chats become epics"
**Decision:** This feature supplies the fact (which features a chat is asking about) and one plain line on today's chat row. Where "Asking about <feature>" sits, how it truncates at sidebar width, and the rest of the chat row's look belong to the sibling "Orchestrator chats become epics", which is redesigning chat rows now. The row is not polished further here.
**Why:** Two features designing the same row at once would clash.
**Decided by the orchestrator (2026-11-09, on the human's delegation).**
