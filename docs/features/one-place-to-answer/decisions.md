# Decisions — One place to answer

Decisions 1–7 were settled with the human in the orchestrator's chat (the brief's "Decided with the human") and are restated here so the record is whole. The rest were settled with the human in this feature's grill.

## 1. A feature that plans itself stays the human's
**Decision:** Automatic planning no longer hands a feature to the epic. Its plan, questions, designs and "ready" arrive in the feature's own chat.
**Why:** Automatic planning is for simple features the human still watches; it is not "do it while I'm gone".

## 2. The epic owns a feature only when the human says so in words
**Decision:** "Run these for me", "do these while I'm gone". Everything else is the human's, and they talk to its agent directly.
**Why:** Epic ownership is the human's "away" mode, and only they know when they are away.

## 3. One place per feature
**Decision:** A feature is either the human's (they answer in its chat) or the epic's (they answer in the epic). Its header says which, and the other agent never asks the human anything about it. An agent that points the human somewhere else does not also ask the question itself.
**Why:** The human could not tell where to answer.

## 4. The epic never carries the human's decisions
**Decision:** When a feature the epic runs needs the human (a never-guessed question, a design to approve, anything only they can decide), it becomes the human's: the epic tells them once ("Fix B needs you, open its chat") and keeps the rest of the batch moving. The human answers in the feature's chat and it carries on from there.
**Why:** Relaying failed in practice: leads refuse a design approval that comes through the epic, so the human answered twice.

## 5. The epic asks the human only two things about features it runs
**Decision:** Before starting, anything unclear about the batch; at the end, one report with what to look at, and "merge these?" when they chose to see them first. Test-drive feedback beyond a plain yes goes to the feature's own chat.
**Why:** One place per feature (3).

## 6. The per-cut question changes with it
**Decision:** Features are the human's by default; for the ones they hand to the epic, the orchestrator asks "show you first, or merge".
**Why:** Follows from 1 and 2.

## 7. Accepted cost
**Decision:** An away batch where three features each need the human means three chats to open.
**Why:** It should be rare: a batch left running is meant to hold work with nothing left to decide.

## 8. A feature that is the human's never goes back to the epic by itself
**Decision:** Once a feature is the human's (it needed them, they typed in it, or it was always theirs), it stays theirs until they give it back: the owner button at the start of the feature's header ("<Epic> builds and merges it" / "… shows me before merging"), or "run it for me" in the epic. The "Yours to plan · then <Epic>" state and the lead's automatic hand-over at the plan's yes (`hand_back` with `planAgreed`) go. The finish choice (show first / merge) only means something while the epic owns a feature; a human-owned feature always reads "Yours".
**Why:** Ownership moves only when the human moves it; a feature quietly changing hands is the confusion this feature ends. The cost, one click per feature after answering it in an away batch, should be rare (7).

## 9. A lead's wait on the human makes an epic-run feature the human's
**Decision:** Under an epic owner, `wait_for_you` is no longer refused. When the lead hits something only the human can decide (a what/where/who question, a design to approve, a stuck worker), it calls `wait_for_you` as any lead does; the server makes the feature the human's in the same move, the question waits in the feature's chat, the row goes yellow and runcastle pings as for any feature. The epic is woken with one line so it tells the human once ("<Feature> needs you, open its chat") and carries on with the rest of the batch. What the epic can answer itself still goes to it by `hand_back`: the plan's yes under automatic planning, "ready", merge conflicts. This is the second way a feature becomes the human's, beside their typing in its chat; per 8, it does not go back by itself.
**Why:** The lead knows what it is asking; one call, no extra hop through the epic, and the question lands where the human answers.
**The human left it to the lead ("do what you think is best").** Alternative: the lead hands back to the epic, which releases the feature to the human.

## 10. Features an epic owns at ship time stay with it
**Decision:** Features an epic owns when this ships keep their epic and their finish choice; the new rules apply to them from then on (9: one that needs the human becomes theirs). The only move: a feature that is the human's but set to pass to its epic at the plan's yes (the state 8 removes) gets finish "I'll finish it" and stays the human's.
**Why:** Nothing changes hands behind the human's back; one click on the owner button takes any of them.

## 11. The epic never passes on the human's words; `relaysHuman` goes
**Decision:** `send_to_feature` loses `relaysHuman` and its "The human's own answer, relayed by the project's orchestrator" header; the lead's rule that a relayed answer counts as the human goes with it. None of its three uses survives: a grilled feature's plan yes is given in its own chat (it is the human's), a "for the human" decision makes the feature the human's (9), and drive feedback beyond a plain yes goes to the feature's chat (5). The end-of-batch "merge these?" needs no relay: the epic merges features it owns. When the human tells the epic something about a feature it does not run, the epic points them to that feature's chat and passes nothing on. Plain "from the orchestrator" notes stay, and never count as the human.
**Why:** The relay is the second-hand path that made the human answer twice.

## 12. "Show me before merging" keeps the epic's drive step
**Decision:** When features the epic runs with "show me before merging" are ready, its end-of-batch report lists them and it starts the first drive, saying what to try. A plain yes ("merge") is given in the epic, which merges. Anything wrong is typed in that feature's chat, which makes the feature the human's (as typing already does); they finish it there or give it back with the owner button.
**Why:** A plain yes in the epic and real feedback in the feature are each one place; it keeps the batch's "merge these?" (5) instead of turning every ready feature into a chat to open.
**The human took the lead's recommendation.** Alternative: "show me first" hands the feature to the human at ready, to drive and merge like their own.

## 13. The words when a feature becomes the human's
**Decision:** The header button keeps "Yours", "<Epic> · you merge", "<Epic> · merges it"; "Yours to plan · then <Epic>" goes (8). When an epic-run feature becomes the human's because it needs them (9):
- the feature's chat shows one quiet line from runcastle (not the agent), above the lead's question: "This is yours now: it needed you. <Epic> carries on with the rest of the batch.";
- the epic says one line, "<Feature> needs you, so it's yours now. Open its chat to answer.", and nothing more about that feature;
- the owner menu's two epic choices add the rule to their hint lines ("…If it needs you, it becomes yours."), so the human learns it before it happens.
The sidebar needs no new words: the row reads "Yours · <its need>", yellow, like any feature of theirs.
**Why:** The human should never open a chat full of the epic's work without being told why it is suddenly theirs.

## 14. One choice per feature at cut time, with three answers
**Decision:** The epic's two cut-time questions (how it is planned; who finishes it) become one per feature:
- **Plan it with me** — the human's; grilled in its chat.
- **Plan automatically** — the human's; plans alone and shows the plan in its chat.
- **Run it for me** — the epic's; plans automatically; the epic then asks "show you first, or merge?".
`create_feature` makes the epic the owner exactly when the answer is "run it for me", and refuses a grilled feature handed to the epic. "Grill it, then the epic finishes it" is "Plan it with me" plus one click on the owner button afterwards (8). Refines 6.
**Why:** Under 1, 4 and 8 the old pairs collapse to these three; one question is less to read.

## 15. "What's waiting for me?" names each item's one place
**Decision:** When the human asks an epic what is waiting, each item names where it is answered and the epic never restates or answers a feature's question: a feature of the human's → "answer in its chat"; something this epic holds → "answer here"; something another epic holds → "in <that epic>". Instruction text only; no new screen.
**Why:** Restating a feature's question in the epic is the "where do I answer?" confusion in miniature.
Alternative considered: a new "Waiting for you" panel in the app (a new screen, not asked for).

## 16. The epic may start the automatic planning of a feature it cut for the human
**Decision:** For a feature the epic cut as "Plan automatically" (the human's, 14), the epic may start its automatic planning run once, when the cut's order says it is that feature's turn. The feature stays the human's; its plan and questions arrive in its own chat. "Plan it with me" features wait for the human to open them and press Start. Every other acting tool stays refused on the human's features.
**Why:** Starting is what the human chose at cut time, not answering for them; without it every such feature waits for a click and a reminder.
