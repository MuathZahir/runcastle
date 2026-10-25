# Decisions — One orchestrator, no mode

Planned with no human present (2026-10-25). Every decision below is the planner's until the human confirms it.

## 1. The project session always runs without permission prompts
**Decision:** Every project session launches the way the orchestrator launches today: Claude Code's `bypassPermissions`, approvals `never` on Codex, runcastle's install guard still on. The setting's warning ("it edits this repo and runs commands without asking") moves to the project chat's own description, so the human still reads it once.
**Why:** The project session now always holds the acting tools and works while the human is away; a permission prompt with nobody there stalls the whole cut while the terminal looks alive (whole-cuts-plan-themselves #10). Every feature chat already runs this way (tickets-and-review-are-tools-not-phases #13), so the project chat would be the one exception left.
**Assumed.** Alternative: keep today's `default` mode on the project session, and let the human answer prompts when they come back.
**Challenged:** pre-approve runcastle's own tools and file reads and keep prompts for shell commands and edits; the project chat is also where the human asks plain questions and edits the charter, and free shell access there is a big trust change to make without them.

## 2. What the orchestrator may act on is set by its instructions, not by the server
**Decision:** The acting tools work on any feature in the project, from any live project session. The instructions draw the line: the orchestrator acts only on (a) what the human asked in this conversation, and only as far as they asked ("check on X" is a read, not a licence to start X), or (b) a cut whose working agreement the human made, within that agreement. Questions, portfolio answers and health sweeps never lead to action on their own. A feature the human is running by hand is theirs unless they ask the orchestrator to act on it.
**Why:** The human chose no ownership and no marker; the brief settles that the prompt keeps the orchestrator to what was asked. The tools keep only the refusals the human's own buttons have.
**Assumed.** Alternative: keep a hidden server-side ownership list, so tools refuse features nobody handed over.

## 3. The orchestrator hears about the features it has acted on
**Decision:** Runcastle's news lines (and the catch-up when the project chat reopens) cover every unshipped feature the orchestrator has acted on: one it created, messaged, planned, started, drove or merged. That set is read from the events its own tool calls already stamp; nothing is stored or shown. To follow a feature it has not touched, it acts on it (for example by messaging its agent).
**Why:** It replaces ownership as the answer to "whose news?" without bringing a marker back. Hearing about every feature would wake the orchestrator on the human's own hand-run work and invite it to act there.
**Assumed.** Alternative: news on every feature in the project.
**Challenged:** messaging a feature's agent only to start hearing about it interrupts that agent for a side effect; a read-only "follow", used when the human names the feature, would be cleaner.

## 4. No stop switch: the human tells it to stop, or ends the project chat
**Decision:** With the setting gone, there is no separate off switch. The human stops the orchestrator by telling it to in its chat, or by ending the project chat; nothing relaunches it, and it cannot act while it is not live. Each feature's own Stop still stops that feature's work. The "the orchestrator mode was turned off" message goes.
**Why:** The setting was the old one-move stop (whole-cuts-plan-themselves #6). A chat the human can end is the same single move, without a second control to explain.
**Assumed.** Alternative: a "Stop orchestrating" button on the Orchestrator card, refusing the acting tools until pressed again.
**Challenged:** ending the project chat does not stop the feature agents and rounds it already set going, and "tell it to stop" relies on the model obeying, so stopping a cut is no longer one move; one control, or a tool it must call when told to stop, should stop everything it set working.

## 5. The tools: two go, one is added
**Decision:** `take_over_feature` (handing a feature over) goes, since there is nothing to take over. `record_test_note` goes: drive notes are the human's, sent with Send to agent, and the orchestrator tells a feature's agent what it found with `send_to_feature`. `start_feature`, `plan_feature`, `stop_feature_run`, `drive`, `merge_feature`, `add_to_brief` and `send_to_feature` stay. A new read, `read_feature_chat({ slug })`, returns the last few turns of the feature's chat, so the orchestrator can read what the feature's agent said back, for example the question behind "Waiting for you · <why>".
**Why:** The human wants the orchestrator to talk to a feature's agent, and today it can only send: the agent's answer stays in a chat it cannot see. Runcastle already builds exactly this excerpt for side sessions, so the read costs little.
**Assumed.** Alternative: no chat read; the agent's docs and its `wait_for_you` reason are all the orchestrator sees.

## 6. A feature the human has open is busy: the instructions say wait, nothing refuses
**Decision:** While the human is using a feature's chat (decision 14 says when that is), the orchestrator does not message that feature or start work on it. It waits until the feature is free, or tells the human what it wants to send. `send_to_feature` does not refuse.
**Why:** The brief keeps the existing "the feature is busy, wait" rule. A refusal would lock the feature for as long as a chat terminal stays up, and those stay up for days after the human walks away.
**Assumed.** Alternative: `send_to_feature` refuses while the feature has a chat with a terminal up.
**Challenged:** waiting for the session to end blocks for days, exactly like the refusal this rejects; busy should mean the human messaged the chat recently or its agent is mid-turn. (The planner took this up as decision 14.)

## 7. Shared things change in one place, and the orchestrator says where before it acts
**Decision:** The instructions give one general judgement: when several features would change the same shared thing (a theme, a component, a schema), the change belongs in one place, because agents editing the same files apart conflict and drift. The orchestrator works out per task what that place is (a feature that lands first and the rest depend on, or the one feature that already owns it). When that means doing something other than what the human literally said ("tell every feature to change the theme"), it says so in a line or two before acting, naming where the change goes and why, and goes ahead unless the human objects. No task-specific rules are written in.
**Why:** The brief settles that the guidance stays general. Saying it first keeps "nothing they did not agree to" true when the orchestrator rephrases a request.
**Assumed.** Alternative: it acts first and explains in its report.

## 8. Judging a part next to the old rest needs no new machinery
**Decision:** Nothing is built for seeing several unmerged features together. The orchestrator orders work so shared pieces merge first (`dependsOn`, the existing merge-order edges), and when it asks the human to look at one feature it says plainly what they are seeing: this screen new, the rest still the old app.
**Why:** Rule 7 plus merge order already answers most of it, as the brief expected. A combined preview of several branches would be a new kind of drive, a feature of its own.
**Assumed.** Alternative: a drive that merges several feature branches into one throwaway preview.

## 9. Interruptions are gathered into one message; the sidebar is unchanged
**Decision:** The instructions tell the orchestrator to gather what needs the human into one message ("4 designs ready for you: …"), unless one item blocks everything else. Runcastle adds no new notice or count for this. A feature whose agent is waiting still shows under Needs you even when the orchestrator is about to answer it; the answer clears it.
**Why:** The project chat already shows on the Orchestrator card when it waits on the human, and news lines that arrive together already come as one message. Hiding a feature from Needs you would need to know the orchestrator has it, which is ownership again.
**Assumed.** Alternative: features in a running cut leave Needs you while the orchestrator handles them.

## 10. Installs are paced by judgement, not by a limit
**Decision:** No new limit. The instructions tell the orchestrator that each feature it sets working costs machine time (its agent installs dependencies to run checks), so it starts only as many at once as the work gains from. Burns already share one machine-wide pool of `burnConcurrency` slots.
**Why:** The heavy installs, in burns, are already capped. A second cap on feature chats would be a hard rule the brief's "judgement, not rules" argues against.
**Assumed.** Alternative: a project setting capping how many features the orchestrator has working at once.

## 11. The working agreement stays, and says whether the orchestrator merges
**Decision:** Before creating anything for a cut, the orchestrator still asks how the cut is run (autonomous, checkpoints the human names, or a check-in after each feature) and writes the answer into each feature's brief. The question now says outright what each shape means for merging, and that "you decide" means autonomous, merge included. Outside a cut, the orchestrator merges only when the human asks it to.
**Why:** The brief's aim is that the human is pulled in only for taste and trust, and that nothing happens they did not agree to. Merging is the biggest act the orchestrator has, so the agreement names it rather than leaving it implied.
**Assumed.** Alternative: the orchestrator never merges unless the human says "merge" for that feature.
**Challenged:** "you decide" should stop before merging; the brief names "should it merge?" as one of the two moments the human is pulled in, and reading a vague answer as permission to merge works against that.

## 12. The orchestrator hears when a feature's agent waits or declares ready
**Decision:** Two more kinds of news reach the orchestrator on the features it follows: the feature's agent waiting for the human (with its reason, such as "start round 1?" or "stuck: …"), and the agent declaring the work ready to test. The existing lines are reworded for rounds rather than burns and laps.
**Why:** Under decisions 3 and 5 the orchestrator plays the human's part toward each feature's agent, and those two moments are exactly when the agent turns to the human. Today neither reaches it, so it would learn of them only by polling.
**Assumed.** Alternative: keep today's list (runs ending, reviews, merges, drives) and have the orchestrator check waiting features itself.

## 13. A message from the orchestrator says it is from the orchestrator
**Decision:** What `send_to_feature` delivers reaches the feature's agent marked as the orchestrator's, so the agent records any decision it changes as the orchestrator's (the existing "Changed by the orchestrator" mark), and the human sees who wrote it when they open that chat. When the orchestrator relays the human's own answer it says so, and the message counts as the human's. It still clears a Stop, as a human message does.
**Why:** With the marker gone and the orchestrator free to message any feature, the chat is the one place the human can see what it said. The feature skill already asks the agent to tell the two apart, but nothing in the message lets it.
**Assumed.** Alternative: deliver it unmarked, as today, and rely on the orchestrator to introduce itself.

## 14. "Using a feature's chat" means recently, and stepping in keeps the feature in the cut
**Decision:** A feature counts as busy while the human is using its chat: they sent it a message in the last 30 minutes, or its agent is mid-turn on their message. A chat left open and idle longer than that is free, and the orchestrator may message it (marked as its own, decision 13), where the human will see it when they come back. A feature the human stepped into during a cut stays in that cut: when it is free again, the orchestrator first reads what changed (the feature's docs and `read_feature_chat`), treats what the human told that agent as the human's decision, and carries on from there. "Start them all" still reaches it. `get_feature_context({ slug })` says when the human last messaged the feature, so the orchestrator can tell.
**Why:** The challenger showed decision 6 would otherwise block for days, since chat terminals stay up long after the human leaves. The brief's own example has the human iterating with feature agents in the middle of a cut, so the cut has to survive that.
**Assumed.** Alternative: the human stepping in takes the feature out of the cut until they hand it back.

## 15. Which features the orchestrator follows is not shown in the app
**Decision:** The app shows no list of the features the orchestrator follows or is running. The orchestrator says what it is running when asked, and its reports name each feature they touch.
**Why:** The human removed the marker so that "orchestrated" stops being a kind of feature; a list on the Orchestrator card would bring the same idea back in another place.
**Assumed.** Alternative: a "working on: A, B, C" line on the Orchestrator card.
