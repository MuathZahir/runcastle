## North star (the human's words, 2026-11-09)

"What I care about is how streamlined and smooth the experience is. This is the most important part. Minimize the user's mental model of the application and the amount of decisions he has to make. His next step should be clear (follow the yellow dots)."

Judge every decision in this feature against that. Fewer concepts, fewer states, fewer choices. When in doubt, remove.

## Purpose

The human gets confused about where to work. Seen on 2026-11-09:

- A feature an orchestrator chat ran ("A new feature waits for Start") had its lead ask the human directly for its design and plan decisions, while the orchestrator chat told the human to "go answer those in its own chat". The same questions were asked in two places.
- A self-planned feature ("The status tells the truth about who and what") both handed its plan to the orchestrator and showed "Plan to approve" on the feature. The orchestrator showed the plan as a raw `preview.html` card, not the plan card the lead uses.
- Three features in flight were held by three different orchestrator chats, and nothing told the human whether to answer in the feature or in which orchestrator chat.

Nothing ever decided where a feature's conversation lives. This feature decides it: **every feature has exactly one owner at a time, and the owner decides where the human talks about it.**

## Decided with the human (orchestrator chat, 2026-11-09)

1. **One owner per feature: the human, or one orchestrator chat.** The feature's sidebar row and header say which. Under the hood this is today's holder (ADR-0016): held by an orchestrator chat = that chat's; no holder = the human's.
2. **A feature the human owns talks only to the human, in its own chat.** It works as a feature with no orchestrator does today: the lead asks, declares ready, the human drives and merges from the feature.
3. **A feature an orchestrator chat owns talks only to that chat.** Its lead brings everything to the chat by `hand_back`, never `wait_for_you` to the human. The chat settles what it can; what is the human's it asks in its own chat. Plans and designs reach the human there on the **same plan and design cards the lead uses** (opening the feature's Plan / Design tab), never as a raw HTML file.
4. **A feature the human grills is theirs while they grill it**, even inside an autonomous cut. At their plan yes, if they chose to let the orchestrator take it further, it passes to the chat it came from. This is the one owner change built into the flow.
5. **The owner changes only when the human changes it.** Typing in an orchestrator-run feature's chat makes it the human's, after a warning before the first message (roughly: "The '<chat>' chat runs this. Sending makes it yours."). The chat is told it let go. Handing it back is one button on the feature, or "run X for me" in any orchestrator chat.
6. **Decisions that reach beyond the feature go to the chat it came from.** When a lead of a human-owned feature hits something that touches another feature or which features exist, it asks the orchestrator chat that cut the feature (features must remember their origin chat; new). That chat answers the lead in the background with facts and a recommendation; the lead puts it to the human in the feature's chat, and the human answers there. Asking does not change the owner. If the human's answer changes another feature, the lead passes the human's words to that chat, which acts. A feature with no origin chat (made with the sidebar's New feature button, or its chat is gone) asks the human directly.
7. **The three working agreements (autonomous / checkpoints / check-in) are replaced by a per-feature choice of how far the orchestrator takes it:** the human finishes it; the orchestrator builds it and shows the human before merging; or the orchestrator merges it itself. Named checkpoints go ("let me play the core first" becomes "show me before merging" on the core feature, plus the cut's order). How it is planned (grilled with the human, or plans itself) stays a separate choice, as today. The human said "you run it" is too vague: the words must say plainly whether they get grilled to make the plan, the agent plans and shows them, or the agent also merges. The exact words are this feature's to design, and fewer choices is better.
8. **A yellow dot sits on the thing you click to answer.** A feature row is yellow only when its own chat has something for the human. When an orchestrator chat asks the human about a feature it runs, **only that chat's row goes yellow**, and it names the feature; the feature row reads "With <chat name> · asking you" in the plain working colour. Clicking a feature still opens its lead (`clicking-a-feature-opens-its-lead` decision 7 stands).
9. **When an orchestrator notices something about a feature the human owns** (a sibling merged that changes things, a collision), it posts it in that feature's chat, marked as from the orchestrator, and does not take the feature.
10. **Several orchestrator chats stay** (the human rejected one main chat: unrelated work would crowd one context). Each chat is the home of one cut; the sibling feature "Orchestrator chats become epics" makes that visible.

## Understood

- "The status tells the truth about who and what" (in flight, this branch is cut from it) already builds the base: a handback leaves a mark and the feature reads "With the orchestrator" until the chat acts; a lead's `wait_for_you` always reads Needs you; a held self-planned feature hands its plan back instead of `wait_for_you`; an orchestrator's question to the human about a held feature is shown only in its own chat. Build on those decisions (its `decisions.md`, read with the feature tools); do not re-decide them.
- The skills (lead and project) must get *simpler* from this, not longer. Prefer one rule ("talk to your owner") over case lists.

## Must not swallow

- How the orchestrator chat list looks, epic titles, grouping features under chats: the sibling "Orchestrator chats become epics".
- Status rules beyond who owns a feature (the need kinds, precedence): the status feature owns those.

## Open (for the plan)

- The words for the per-feature choice (decision 7) and where it is shown and changed on the feature.
- The hand-back button: where it lives, what it says.
- Where the origin chat is stored, and what happens to it when that chat ends or is too long to reopen.
- Moving today's held features (several are held by ended chats) into the new rules.
- The skill lines that change, kept short.

## Ordering

Cut from `feature/the-status-tells-the-truth-about-who-and-what`, which is still building and is not merged. Before this feature's workers start, merge that branch's latest tip into this branch so the build sees all of it. Merge order for the human: the status feature first, then this one. "Orchestrator chats become epics" builds on this feature's origin chat field.

## How it runs

The human, going to sleep (2026-11-09): "I want you to finish both features. Don't merge them. I'll check them before (designs and logic). I assume you understand the feel I want so you can check the plans of the features and ensure they align."

- Planning mode: **plans itself**, on the human's word tonight (it would otherwise have been grilled with them). The decisions above are the grill's result.
- The orchestrator carries it through plan, design, build and review, and does **not** merge. The human checks the designs and the logic in the morning, and merges.
- Decisions that change what the human sees: the orchestrator settles them on its own recommendation tonight and lists each for the human's morning check. Designs keep their alternatives switchable (Tweaks) and stay unapproved until the human looks: the human said they want to "see the different options and choose".
