# Decisions

Planned without the human (a self-planning run, 2026-10-30). Each decision below was made by the planner and is marked assumed until the human confirms it.

## 1. A subagent gets one card, and the fold decides it
**Decision:** The function that turns a thread's log into what the chat shows (`foldThread`) remembers every subagent the thread has shown. An event for a subagent an earlier turn already showed makes no card, and an event that has no title and says the subagent is finished makes no card for one it never saw.
**Why:** The stored log of the project chat shows the cause: each time the agent is relaunched, the adapter (the process that connects runcastle to the agent) re-announces every past subagent, untitled and already completed, at the start of the first turn. That chat grew from 7 ghosts to 16. Fixing it where the log is read also repairs threads that already hold these events.
**Assumed.** Alternative: drop the re-announcements on the server before they reach the log, which leaves old threads broken.

## 2. A message sent into a running turn cannot hide the answer
**Decision:** A late update to a tool call or subagent that began before a steered message (one sent into a running turn) updates its own row. It adds no row, and it cannot push the agent's final words into the "Worked for…" fold.
**Why:** Reproduced with the real fold. It forgets the turn's calls and subagents at a steered message, so a late update looks like a new step after the answer. The fold then treats the answer as narration, hides it under "Worked for…", and adds a blank row. Steering is also the moment a running tool gets moved to the background, so a late update is the likely case.
**Assumed.** Alternative: report the finding and change nothing, since the brief says this item may turn out to be nothing.

## 3. The missing answer: what we report
**Decision:** The report on the missing answer says: nothing in the code ties it to the thread being older than the web chat, the likely cause is the steered-message fault in decision 2, and the words were probably there, folded under "Worked for…". This could not be confirmed on the thread in the screenshot, because project-helix's logs are not on this machine. If the agent wrote no final words, the chat shows none and says nothing about it.
**Why:** Steered messages take the same path on every thread, so a thread's age changes nothing. Only two steered messages exist in the logs here, and both were answered normally. The fix is at read time, so the screenshot's thread will show its answer on its next open if it had one.
**Assumed.** Alternative: add a line saying "the agent wrote no answer" to a turn that ends without words.
**Challenged:** With the target thread's log unavailable and only two steered messages here, the honest claim is "no evidence it is related", and the real test is the human reopening that thread once the fix is installed. The wording above was softened for this. The reopen stays a request in the ready message.

## 4. The grouped tool rows stay as they are
**Decision:** No change is planned to how tool rows are worded or grouped, beyond the blank row decision 2 removes. The build runs real logged turns through the grouping and reads the result, and fixes what reads wrong.
**Why:** The brief asked for a check against real tool titles. All 2,047 settled rows in this machine's logs have a title, and only one is the adapter's generic placeholder ("Read File"). The placeholders "Terminal" and "Preparing file…" appear only while a call runs.
**Assumed.** Alternative: rework the wording for in-flight rows, which the brief's "no redesign of the chat" argues against.
**Challenged:** Counting titles does not show that grouped rows read correctly, and the brief's worry is that the card shipped without being tried on real turns. The read of real turns above comes from this.

## 5. Pending attachments are saved in the browser, per thread
**Decision:** Attachments waiting to be sent are saved in the browser's own database (IndexedDB), under the same key as the thread's typed draft. They come back after switching chats and after a reload, in that browser only. Sending or removing one deletes it. A failed send puts them back on the thread they came from, whichever thread is on screen.
**Why:** The draft text already lives in the browser, so this matches it. Images are too large for the storage the text uses (localStorage), and IndexedDB holds them as they are, with no server change.
**Assumed.** Alternative: upload each attachment to the server when it is added, so it follows the human to another browser.

## 6. A new feature's chat starts itself the first time it is opened
**Decision:** When a feature's main chat is on screen and has never started, the web starts it at once through the normal launch, so the agent reads its brief and speaks first. This replaces chat-as-web-components decision 12 for the feature's main chat only, along with its line that opening a chat never launches anything. Side threads, project chats and the preparation chat keep waiting for the first message.
**Why:** It is what the brief asks for. The normal launch already carries the briefing as the thread's first prompt, as `docs/adr/0009-kickoff-delivery.md` and ADR-0015 require, so no new delivery path appears.
**Assumed.** Alternative: a "Start" button on the empty screen, which costs a click but never spends tokens on a feature opened just to look.

## 7. Short requests still get a question from the orchestrator
**Decision:** The project skill gets a floor: no cut is proposed and no feature is created until the human has answered at least one question in this conversation, unless they said in words to skip it ("just do it", "you decide"). The questions cover anything that changes what the human gets or how it will behave. Implementation choices stay with the feature's own grill, and the brief names them under **open**. The working-agreement question does not count. A small change (the skill's routing destination 2) gets the same floor.
**Why:** Three lines in the skill let a short request pass with no question: "Recommend, don't interrogate. Put your proposed cut to them", "If you cannot say which way an answer would swing the cut, you do not need to ask it", and "work too small to deserve a conversation". A rule that says "grill" with an exit for confident requests does not hold, so this one has no exit the agent can take on its own.
**Assumed.** Alternative: reword those three lines with no floor, which leaves the judgement with the agent.
**Challenged:** The floor counts questions rather than decisions, so an agent could ask one cheap question and settle the rest alone. Applying it to small changes also goes past "tighten the wording" and adds friction to trivial requests. A better rule would name each decision that changes what the human gets.

## 8. A concrete brief narrows the feature's grill and does not cancel it
**Decision:** The feature skill's "When the brief is already concrete, skip the grilling" is replaced. Before writing the spec, the agent names the decisions the brief did not settle and puts them to the human one at a time. It skips the grill only when none remain, and says so in chat. Self-planning runs are unchanged.
**Why:** The check the brief asked for found the same exit on the feature side, and that sentence is it. It is why a confident brief can reach building with the human never asked.
**Assumed.** Alternative: leave the feature skill alone and fix only the project skill, which is where the human saw the problem.

## 9. Built by the lead in one pass, with one review
**Decision:** The lead builds all five items itself, with no tickets, then runs one independent code review before declaring ready.
**Why:** Each item is small, and the items share files: the fold takes two and the chat hook (`use-thread.ts`) takes two, so parallel workers would collide on landing. A ticket also costs about ten minutes of setup before it does any work. The change crosses core, server, web and skills, which earns one independent read.
**Assumed.** Alternative: one ticket per file-disjoint group, burned in parallel.

## 10. "Opened" means the human can see the chat
**Decision:** The start in decision 6 fires only when the main chat column is on screen, the thread list has been read and shows no main chat, and the feature is started and neither shipped nor archived. Nothing on the server or in the orchestrator starts it, and a page whose panel covers the chat waits until the chat shows.
**Why:** The brief says not to start an agent for a feature nobody has opened. Waiting for the thread list stops a slow read from starting a second chat for a feature that has one.
**Assumed.** Alternative: start on opening the feature page, whatever is on screen.
**Challenged:** A chat on screen in a hidden browser tab still counts, so the rule should also require the tab to be visible.

## 11. One start, and a failed start falls back to today's screen
**Decision:** A feature's chat starts once, however many tabs or re-renders ask, and a second ask reuses the first. If the start is refused (the runtime is not ready, say), the chat stays on today's empty screen with the refusal shown once, with no automatic retry. The first Send tries again.
**Why:** A loop of refused starts would be noise. The empty chat already works, so it is the natural fallback.
**Assumed.** Alternative: retry once on each new open of the chat, showing any refusal once.
**Challenged:** If the runtime was not ready on the first open but is on the second, a retry works. With no retry the human is back to typing "Hi", which is the bug being fixed.

## 12. A draft moves with the chat as it starts
**Decision:** When the chat gets its thread, any draft text and pending attachments saved for the unstarted chat move to that thread. The chat still starts when a draft exists. A message sent while the agent is opening joins that turn and shows as sent into the running turn.
**Why:** Drafts are saved under a key that changes once the thread has an id, so without the move a saved draft would vanish the moment the chat started itself.
**Assumed.** Alternative: hold the start while a draft exists, so the opening and that message go as one prompt, which leaves the chat empty for anyone with a leftover draft.

## 13. The launch line stays, and the skills say what it means
**Decision:** The "Proceed with your task" line that opens every session stays as it is. Both skills say that it is the instruction to open the skill, never a go-ahead to skip the grill.
**Why:** On a project chat that line reaches the agent right ahead of the human's first message, so it can read as "go". Rewording it touches code the brief keeps out of this item, and eight test files pin the wording.
**Assumed.** Alternative: reword the line itself in the launch code.

## 14. Only a feature with no history starts by itself
**Decision:** The start in decision 6 fires only for a feature with no sessions of any kind, no tickets and no rounds. A feature with any of those keeps today's empty chat if it has no main chat.
**Why:** A feature whose work ran in an older terminal session or through tickets can also have no main chat. Starting an agent there would launch a fresh kickoff on work already under way.
**Assumed.** Alternative: fire on any feature with no main chat, which also covers a feature whose chat row was lost.

## 15. The orchestrator asks more when a feature will plan itself
**Decision:** Self-planning runs stay as they are, as the brief says. The project skill says that when a feature will plan itself, the orchestrator's questions are the only ones the human gets before the plan, so it asks there anything that would surprise them about what the feature does. It still runs no design grill.
**Why:** Decisions 7 and 8 send implementation choices to the feature's own grill, and a self-planned feature has none, so the human's complaint would survive on exactly those features. This is skill wording and changes no run's behaviour.
**Assumed.** Alternative: leave it to the **Check first** list on each plan, which the human only sees after the plan exists.

## 16. Later subagent updates
**Decision:** A later "finished" update changes nothing on screen, because the card settled with its turn. A subagent that really runs again in a later turn, meaning an update that says it is running, gets a card in that turn.
**Why:** The relaunch noise is always "completed", so this separates noise from real work. A card cannot spin forever, because a turn's end settles every card in it.
**Assumed.** Alternative: patch the original card in its old turn, which has no visible effect because its status is already settled.
