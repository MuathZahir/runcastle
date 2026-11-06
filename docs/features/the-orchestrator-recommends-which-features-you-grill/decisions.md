# Decisions — The orchestrator recommends which features you grill

Planned without the human (a self-planning run, 2026-11-06). Each decision below is assumed until the human confirms it. The challenge was run by a separate agent that saw only the brief and these decisions.

Check first: 1, 3, 5, 7, 9

## 1. The planning mode rides on the cut proposal
**Decision:** When the orchestrator proposes a cut, each feature in the proposal carries its recommended planning mode and a one-line reason. The human confirms or flips modes in the same answer that confirms the cut. It is not a separate question, and it does not count as the one shape question intake requires before a cut. A cut of one feature gets a mode too.
**Why:** The human asked for a recommendation per feature, and the cut proposal is where each feature is already listed. A separate question would add a round trip to every intake.
**Assumed.** Alternative: ask it as its own question next to the working-agreement question.
**Challenged:** One yes to the cut can approve modes the human never read, so the default wins by inertia; ask for the modes explicitly. (The plan answers this by showing each mode as its own visible item on the feature's line, with its reason.)

## 2. Two modes: "grill with you" and "plans itself"
**Decision:** A feature's planning mode is one of two: **grill with you** (the human plans it with the feature's lead in its chat) or **plans itself** (the orchestrator starts its self-planning run). No third mode.
**Why:** "Plans itself, but I check the plan" is already covered by the working agreement's checkpoints, and a third mode would blur the choice.
**Assumed.** Alternative: a third mode where the feature plans itself and the human reviews the plan before round 1.

## 3. When to recommend a grill, and which way to lean
**Decision:** Recommend **grill with you** when the feature shapes how the human works or what they see, is big or hard to undo, or has open questions its brief marks as the human's. Recommend **plans itself** for bug fixes and well-specified mechanical work. When unsure, recommend the grill.
**Why:** The human's complaint is too little grilling ("If the feature is important or big, I would usually like to get grilled"). A wrongly recommended grill costs one "no, plan it yourself"; a wrongly skipped one costs a plan built on guesses.
**Assumed.** Alternative: lean to "plans itself" when unsure, to save the human's time.
**Challenged:** "Shapes how the human works or what they see" covers most of this product, so leaning to the grill risks over-grilling; tighten the trigger or cap how many grills a cut queues.

## 4. The mode is written in each brief, next to the working agreement
**Decision:** Each feature's brief carries one line with its planning mode and the reason, in the same place as the working agreement: in the `brief` passed when the feature is created, or appended with the tool that adds to a brief (`add_to_brief`) for a feature that already exists or when the mode changes. After a compaction or relaunch the orchestrator reads it back from the brief.
**Why:** The orchestrator's chat is not kept; the brief is where its judgement survives, as the working agreement already does.
**Assumed.** Alternative: keep it only in the orchestrator's chat and ask again after a relaunch.

## 5. A "grill with you" feature's plan and its yes belong to the human
**Decision:** For a "grill with you" feature the orchestrator never starts its self-planning run (`plan_feature`) and never gives its plan the yes on its own judgement or the agreement's. The yes comes from the human: in the feature's own chat at the end of the grill, or in the orchestrator's chat, which the orchestrator then relays as the human's own answer (`send_to_feature` with `relaysHuman: true`). When the feature's lead waits for that yes, the orchestrator does not answer it otherwise. The orchestrator also skips the questions it asks before a self-planned feature's run, since the feature's own grill asks them.
**Why:** The point of the grill is that the human and the lead share the picture before building; the orchestrator saying yes for them would undo it. Today the skill tells the orchestrator to answer a waiting agent's question when the agreement settles it, which would reach a plan wait too. Relaying the human's own words keeps the yes theirs without forcing them back into the feature's chat.
**Assumed.** Alternative: the yes only counts when the human gives it in the feature's own chat.

## 6. When its turn comes, the orchestrator hands the human the chat
**Decision:** When the agreement says a "grill with you" feature should be planned, the orchestrator starts it if it is still a backlog draft (as the agreement allows), then tells the human in its own chat to open that feature's chat for the grill. If several are ready at once it names them in one message, with the order it would take them. It notifies the human's phone (`notify_human`) once if they seem away, and does not nag after that. Meanwhile it keeps the cut's other features moving.
**Why:** The orchestrator cannot open a chat for the human or start a grill itself; one clear handoff plus one ping is the most it can do without becoming noise. The "gather what needs the human" rule already says to bundle.
**Assumed.** Alternative: wait silently until the human opens the chat on their own.

## 7. After the yes, the cut's working agreement takes over unchanged
**Decision:** Once the human has said yes in the feature's chat, the lead runs its rounds and the orchestrator carries the feature on exactly as the cut's working agreement says (autonomous, checkpoints or a check-in after each feature). The grill adds no stop of its own after the plan, and the three ways of running a cut stay as they are.
**Why:** The brief keeps the three shapes unchanged; the grill is about planning, not about how far the orchestrator carries the build.
**Assumed.** Alternative: a grilled feature always gets a check-in before its merge, whatever the agreement.
**Challenged:** Wanting to plan a feature together does not mean the human wants to skip looking at the result; under "autonomous" a grilled feature would merge unseen.

## 8. The human can change a feature's mode at any time; unrecorded modes are judged
**Decision:** The human can flip a feature's mode whenever they like; the orchestrator records the change in the brief (`add_to_brief`) and works to it. A feature with no recorded mode (one created before this change, or outside a cut) is judged by the same rule as decision 3 when the agreement calls for planning it: if the orchestrator would recommend a grill, it asks the human before starting a self-planning run.
**Why:** Briefs written before this change have no mode line, and silently planning an important one would repeat the problem this feature fixes.
**Assumed.** Alternative: treat a missing mode as "plans itself", as today.

## 9. The "draft started by itself" news names the grill path too
**Decision:** The line runcastle sends the orchestrator when a draft starts by itself (today: "plan_feature or send_to_feature sets it going") also says that a feature whose brief says "grill with you" waits for the human's chat instead. This is the one change outside the skill text.
**Why:** That line is the orchestrator's prompt at exactly the moment it decides whether to plan a feature, and as written it points straight at the self-planning run. It is prompt text, not UI, so it stays within "prompt-only".
**Assumed.** Alternative: change only the skill, and leave the server untouched.
**Challenged:** It touches server text when the brief says prompt-only; that scope change should be the human's call, or the skill should be robust on its own.

## 10. A feature waiting on its grill holds only itself and what depends on it
**Decision:** While a "grill with you" feature waits for the human, only that feature and the features that wait on it (its dependents) are held. The handoff message names those dependents, so the human knows what their grill unblocks. Under an autonomous agreement this is the one planned stop besides decisions the orchestrator must ask about.
**Why:** The rest of the cut has no reason to wait, and naming what is held tells the human how urgent the grill is.
**Assumed.** Alternative: pause the whole cut until every grill is done.

## 11. No fallback when the human does not come to the grill
**Decision:** A "grill with you" feature waits for the human however long it takes. The orchestrator never falls back to a self-planning run on its own. It lists the feature as waiting on the human in its reports and whenever asked what is stuck; only the human switching the mode (decision 8) sends it to plan itself.
**Why:** A silent fallback would bring back the very problem this feature fixes. The cost of waiting falls only on that feature and its dependents (decision 10).
**Assumed.** Alternative: after a set time, plan it itself and tell the human.
