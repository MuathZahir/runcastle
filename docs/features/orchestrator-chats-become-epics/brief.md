## North star (the human's words, 2026-11-09)

"What I care about is how streamlined and smooth the experience is. This is the most important part. Minimize the user's mental model of the application and the amount of decisions he has to make. His next step should be clear (follow the yellow dots)."

## Purpose

The orchestrator chat list is hard to read, and nothing links an orchestrator chat to the features it cut. Today's chat titles are generated from the first message and have no common style ("Feature status showing Working while waiting", "Runcastle orchestrator feature workflow confusion", "I published the package but I'm getting github action errors…"). The human runs one chat per topic, which is the right unit, but the screen does not show it.

The human's idea: **think of each orchestrator chat as an Epic.** Its title is very short and easy to scan, like "Payment System", and under it sit the features that compose it. There should be a visual way to tell what is related to what.

## Decided with the human (orchestrator chat, 2026-11-09)

1. **Several orchestrator chats stay**; one main chat was rejected (unrelated work would crowd one context). Each chat is the home of one cut.
2. **A chat row goes yellow only when the chat itself asks the human something, and the row names the feature it is about.** The feature's own row then reads "With <chat name> · asking you" in the plain working colour (that part is built by "Every feature has one owner"). A yellow dot always sits on the thing you click to answer.
3. **The human's open note is in scope:** "Going out of a new chat removes it from the orchestrator sidebar list even though I typed a prompt into it. I have to click 'All x chats' then open the 'New chat' one." That breaks today's rule (a chat written in within 24 hours stays listed): fix it.

## What to explore, and present as options

The human wants to see options in the morning and choose: "You can explore these ideas on your own. When I'm back, I can see the different options and I can choose. Be thorough in your analysis and bold in your recommendations." Design each as a switchable option (Tweaks) on one design page, with a recommendation, and build the recommended one.

- **Sidebar shape.** At least: (A) the sidebar is a list of epics, each epic's row is its chat, its features nested under it, no separate status lanes; the epic with something yellow floats to the top, and inside an epic the yellow features come first. (B) today's lanes (Needs you, Working, …) kept, each feature row tagged with its epic (a short name or a colour). (C) a hybrid. The orchestrator's lean is (A): one place per item, the nesting itself is the link, and "float what is yellow to the top" keeps the next step at the top without a second list. Check it honestly against a sidebar with many epics and on a phone.
- **What makes a chat an epic.** The lean: a chat becomes an epic when it cuts its first feature; before that (or a chat used only for questions) it is just a conversation, shown quietly and fading as today.
- **Epic names.** One style: 1–3 words, Title Case, a noun phrase ("Payment System", "Feature Ownership"). The orchestrator names the epic when it cuts its first feature (a skill line plus a way to set the title); the human can rename it. What becomes of today's chat titles.
- **Membership follows the chat a feature came from, not who holds it.** A feature the human took over stays under its epic and shows it is theirs. "Every feature has one owner" adds the origin chat field; use that, do not add a second one. Features made by hand with no epic need a place.
- **The word "Epic" in the UI**, and whether "Orchestrator" stays as a word the human sees. The fewer words for the same thing, the better: one candidate model is "epics hold features, features hold workers".
- **The feature page's crumb** (today the holding chat's name) becomes its epic.
- **A finished epic**: when all its features have shipped, it folds away as today's chats do.

## Must not swallow

- Who owns a feature, the hand-back button, the typing warning, how leads talk to their chat: "Every feature has one owner".
- Status words and need rules: "The status tells the truth about who and what".

## Ordering

Cut from `main`. It needs "Every feature has one owner"'s origin chat field and its "With <chat name>" row words: plan and design now, but before this feature's workers start, merge `feature/every-feature-has-one-owner`'s latest tip into this branch (the orchestrator will say when). Merge order for the human: "The status tells the truth about who and what", then "Every feature has one owner", then this one.

## How it runs

The human, going to sleep (2026-11-09): "I want you to finish both features. Don't merge them. I'll check them before (designs and logic)."

- Planning mode: **plans itself**, on the human's word tonight (it would otherwise have been grilled with them).
- The orchestrator carries it through plan, design, build and review, and does **not** merge. The human checks designs and logic in the morning, and merges.
- Decisions that change what the human sees: the orchestrator settles them on its recommendation tonight and lists each for the morning. Designs keep their options switchable and stay unapproved until the human looks.
