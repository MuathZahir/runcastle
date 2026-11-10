# Every feature has one owner

## Problem

The human gets confused about where to work on a feature. The same lead questions reached them in a feature's chat and in an orchestrator chat; a self-planned feature both handed its plan to the orchestrator and showed "Plan to approve"; three features in flight were held by three orchestrator chats and nothing said which chat to answer in. Nothing ever decided where a feature's conversation lives.

## Approach

**From the human's side.** Every feature has one owner: the human, or one orchestrator chat. The feature's header starts with an **owner control** that says which ("Yours", "Notes triage · you merge", "Notes triage · merges it"; the chat's name truncates, the rest never does); clicking it offers three choices — "I'll finish it", "<Chat> builds it and shows me before merging", "<Chat> builds and merges it" — and that is the only place ownership is changed on a feature (decisions 11, 12). A feature with no chat reads "Yours" and the control does not open; its hover says to ask an orchestrator chat "run <feature> for me" (decision 21). The same three choices sit in the feature row's "…" menu. A human-owned feature behaves exactly as a feature with no orchestrator does today. A chat-owned feature talks only to its chat: its row says "With <Chat> · …" whenever the chat holds the next move, and when the chat asks the human about it, only the chat's row goes yellow and names it (decisions 8, 15, 17). Typing in a chat-owned feature's lead chat takes it, after a one-line strip above the composer says so; the strip always carries an "Open <Chat>" link, and says when the chat is asking about this feature (decisions 23, 28). Testing, merging, approving a design, answering a permission prompt or writing to a worker never take it. Designs always wait for the human's own yes, whatever the choice (decision 27). Saying "run X for me" in any orchestrator chat hands it to that chat.

**The owner.** The owner is the existing holder column (ADR-0016): null means the human. Two new fields join it on the feature:

- **its chat** — the orchestrator chat it came from: set when an orchestrator chat creates it, replaced when the human gives it to another chat, moved to a replacement chat with holds when a chat is too long to reopen; null for features made with New feature (decision 21), whose owner control then does not open and whose row menu offers no owner choices;
- **finish** — `you` | `show` | `merge`: how far its chat takes it (decision 7). For a chat-owned feature it says whether the chat merges. For a human-owned feature it is the human's choice; `show`/`merge` with no plan yet agreed means the chat takes it at the plan yes (decision 14).

There is no "planning mode" field: the planning choice is made once in the orchestrator chat and travels as today, through the launch (`self-plan`) and the brief (decision 13).

**Changing the owner** happens in exactly these places, each emitting an event so the UI updates at once and each clearing an outstanding handback:

- the owner control or the row menu (a new tRPC mutation): choosing "I'll finish it" releases the hold; choosing a chat option sets finish and gives the feature to its chat;
- the human's first typed message in the lead's main chat (the existing human-message hook): releases the hold (decision 23). Workers and side chats do not;
- the orchestrator's `take_feature`, extended to carry the finish choice, used only on the human's words ("run X for me"); it makes the taking chat the feature's chat;
- `create_feature` from an orchestrator chat, which now takes the two choices: it holds the feature only when the feature plans itself and finish is not `you`; a grilled feature starts as the human's (decision 4);
- the lead's `hand_back` at the human's plan yes, with a flag saying the plan was agreed, on a human-owned feature whose finish is a chat's: it passes the feature to its chat (decision 14).

Taking one feature leaves the rest of the cut with its chat, which starts a waiting sibling when the taken feature merges (decision 29). A chat that lets go is not woken; the release is recorded, the chat is told on its next turn through the context its tools already return, and its tools refuse the feature from then on (decision 23). A chat whose process ended keeps its features (decision 22).

**What each side may do.** The rule for agents is one line: talk to your owner.

- The lead of a chat-owned feature: `wait_for_you` is refused with a line pointing to `hand_back` (decision 18). Plan yes, designs, ready, conflicts, questions all go by handback.
- The lead of a human-owned feature: `wait_for_you` as today. `hand_back` now reaches its chat when the human owns it, for decisions that reach beyond the feature; the feature reads "Asking <Chat> · <first line>" in the working colour while it is out ("With <Chat>" only ever means the chat owns it), and the chat answers with `send_to_feature` (decisions 6, 20). With no chat, `hand_back` is refused and the lead asks the human.
- An orchestrator chat acts only on features it owns: `requireHold` stops claiming unheld features. On a human-owned feature it may `send_to_feature` (a marked note, decision 9, or an answer to its lead's question) and read; every other acting tool refuses with a line saying the human owns it (decision 19).
- An orchestrator chat may post a feature's **plan card** and **design cards** in its own chat: `show_plan` and `show_design` accept a slug from orchestrator sessions, as `show_review_package` already does, and post the same cards, which open the feature's Plan or Design tab (decision 3).

**Status.** The pure feature-need function gains two facts: whether the owner chat is asking the human about this feature, and the owner chat's name (decisions 15–17, 20).

- Under a chat owner, everything except a permission prompt and a "with you" worker's question is held: it reads "With <Chat> · <its words>" in Working, no count, no ping. This replaces the base feature's "held only while a handback is outstanding" for chat-owned features and extends what is held to plan and design waits (decision 16).
- With an outstanding handback and the owner chat asking about this feature, the words are "With <Chat> · asking you". A chat is asking about a feature when its turn ended on a question and, in that turn, it showed that feature's plan, design or review card. A chat that holds five handbacks and asks about one marks only that one. If the build finds questions asked in words alone, with no card, it adds an optional feature field to a tool the chat already has (decision 17).
- A human-owned feature whose lead is asking its chat reads "Asking <Chat> · <first line>" in the working colour, never yellow (decision 20).
- The hour safety net applies only while the owner chat is neither asking nor working; then "Handed back · …" under Needs you, as today.
- "With the orchestrator" becomes "With <Chat>" everywhere it appears.

The orchestrator chat's row, when it is asking about a feature it owns, gains one plain line "Asking about <feature>" ("+N" for more), and its amber dot is the only one for that question. The row's look beyond that line belongs to "Orchestrator chats become epics" (decision 30).

**The words.** The header reads the short set: "Yours", "<Chat> · you merge", "<Chat> · merges it"; the menu keeps the long sentences (decision 12, changed by the orchestrator). "Yours to plan · then <Chat>" reads while a grilled feature waits for its plan yes.

**Skills.** Both get shorter.

- Lead skill: one rule, "talk to your owner" — the header says who; under a chat, everything goes by `hand_back`; under the human, `wait_for_you`, and `hand_back` to its chat for what reaches beyond the feature; at a plan yes on a feature its chat takes next, `hand_back` with the plan-agreed flag. The planning-alone ending follows the same rule. The holder-specific paragraphs it replaces go.
- Project skill: working agreements, checkpoints and "check-in" go; cutting asks two plain questions (plan it with me / plan it yourself and show me; I finish it / you build it and show me before merging / you build and merge it) and passes them to `create_feature`; the chat reads `finish` from the feature to know whether it merges; it acts only on features it owns; it posts plan and design cards by slug; "run X for me" takes a feature.

**Moving today's features** (decision 24): a one-time, marker-guarded boot step, as the holder sweep was. Held features keep their chat as owner and as their chat, with finish `show`; unheld features stay the human's with finish `you`, and get their chat back from their creation record where it names one. The step records what it moved; the lead lists every moved feature in its ready handback, for the orchestrator's report to the human. No summary screen.

## Seams

- **Feature need** (existing, pure, in core): observe kind, words, held and lane for a chat-owned feature in every need kind, with and without a handback, with the owner chat asking, working, or quiet past the hour; a human-owned feature asking its chat; unchanged words for human-owned features.
- **Ownership service** (existing holding service, grown): observe each owner change — control, typed message, `take_feature`, `create_feature`, plan-agreed handback, replacement chat — writing owner, its chat and finish, emitting one event, clearing the handback; and the boot move, run once.
- **The MCP tools** (existing): `wait_for_you` refused under a chat owner; `hand_back` reaching the owner, else its chat, else refused; orchestrator acting tools refused on human-owned features while `send_to_feature` is allowed; `show_plan` / `show_design` with a slug posting the card into an orchestrator chat.
- **Feature router** (existing tRPC): the new owner mutation and the feature list carrying owner chat name, its chat and finish.
- **Owner control and owner strip** (new web components, designed): the readings, the menu's checked option, the no-chat control that does not open, the strip's presence, its asking form and its link to the chat.
- **Sidebar row words** (existing): a feature row's "With <Chat> · …" and "Asking <Chat> · …" words and dot; the chat row's "Asking about <feature>" line and dot.
- **Which features a chat asks about** (new, pure): from a chat's turn ending on a question and the cards it showed in that turn, the features it is asking about.
- **Skill text** (existing tests over the skills): the one rule is present, working agreements are gone.

## Out of scope

- How the orchestrator chat list looks, epic titles, grouping features under chats — the sibling "Orchestrator chats become epics", which builds on this feature's "its chat" field.
- Status rules beyond who owns a feature (the need kinds and their order overall) — the status feature owns those.
- Showing or changing the planning mode on a feature.
- Picking an arbitrary chat from the owner control; a feature goes to another chat by telling that chat "run X for me".
- Editing earlier features' docs; decision 26 records what this supersedes.

## Open questions

- Whether one three-step question should replace the two cut-time choices (decision 13); the orchestrator takes it to the human. The build keeps the planning choice in one place so folding it in later is small.
- Whether the cards a chat showed are enough to know which feature it asks about (decision 17); the build checks real orchestrator logs and adds the optional feature field only if not.
- Whether a chat's row reliably reads "asking" for an orchestrator whose turn ends on a question without a question mark; the build checks the existing thread-activity reading on real orchestrator logs and notes any gap.
- The build merges the latest tip of `feature/the-status-tells-the-truth-about-who-and-what` into this branch (the brief's ordering), since the held-need rules here extend its handback mark, and merges it again before the review if it moved.
