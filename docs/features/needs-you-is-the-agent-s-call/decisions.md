# Decisions — Needs you is the agent's call

Planned without the human (a headless planning run, 2026-11-13). Decisions marked
human wants.

## 1. One bit: needs you, or not
**Decision:** Every feature, every worker and every orchestrator chat shows one thing about the human: it needs you, or it does not. When it does, it shows the one line the agent wrote saying why. Nothing else about waiting shows.
**Why:** The human's own words in the brief: "I just want to know if the agent needs me or not. I don't care about the state."

## 2. Only an agent's tool call sets it
**Decision:** "Needs you" is set by `wait_for_you({ why })`, by `declare_ready`, or by a permission prompt or question box that waits on the human's click. The one exception is an agent whose run died (decision 9). Ending a turn never sets it, whatever the agent's last words were and whether or not subagents or background commands still run. The "implied answer" rule, which read a finished turn (or a question mark after a plan card) as a question, is deleted.
**Why:** The brief: the guess is what makes the status wrong "most of the time".

## 3. The reason is the agent's own short line
**Decision:** The why shown beside "Needs you" is the agent's words, unchanged, kept to one line (clipped with an ellipsis if longer). The tool asks for one short line. Wherever "Needs you" shows (sidebar row, ping, an orchestrator's message), one click opens the exact chat where the question waits.
**Why:** The brief, from the human's standing direction "a simple path for the human".

## 4. The wait kinds go
**Decision:** `wait_for_you` takes only `why`. The kinds (answer, plan, design, stuck) and the separate labels they drove ("Plan to approve", "Design to approve", "Stopped · …") are deleted. A plan wait reads, for example, "Needs you · Plan ready for your yes"; the plan card itself is unchanged.
**Why:** The kinds exist only to pick a label; the agent's own line says the same thing better.

## 5. Every need kind runcastle derived is deleted
**Decision:** The ten need kinds (permission, conflict, worker, answer, plan, design, stopped, test, merge, handback), the "quiet" need and the code that ranks them go. What replaces them is a list of who needs the human now, each with its why and its chat.
**Why:** The brief's direction: delete them rather than keep them behind a simpler label. Prefer deleting code to adding it.

## 6. Leads, orchestrator chats and workers all call it
**Decision:** The feature lead keeps `wait_for_you`. Orchestrator chats get it too, so an epic's chat reads "needs you" only when its agent says so (today a question mark after a plan card makes it "waiting"). Workers get it in their sandbox tools; a worker whose turn ends without a handback or a wait reads idle, not "needs you". A worker's Stop and a server restart leave it idle too.
**Why:** The same guessing bug lives in the orchestrator's "asking about" rule and in the worker's "turn ended without a handback" rule. One rule for every agent is the simplest model.

## 7. What clears it
**Decision:** A need clears only when the human writes in that chat (or answers its prompt or question box, presses Stop, or closes the feature), or when the agent itself replaces it (a new `wait_for_you` or `declare_ready`) or withdraws it (`wait_for_you` with nothing to wait for). A worker handing back, a review finishing, a merge conflict or an orchestrator's message does not clear it: the human's question is still open, and the row keeps reading "Needs you" while the agent works on (decision 18).
**Why:** The brief: "your reply (or the agent's next tool call that takes it back) clears it". A need wiped by a machine wake would read Working while the human is really being waited on, the false status this feature exists to kill. Withdrawing a question that went moot is rarer than re-asking after every wake, so it asks less of agents.

## 8. Ready to test is a "needs you"
**Decision:** `declare_ready` sets "Needs you · Ready to test · <scenario>". The Test drive button stays where it is. It clears like any need, on the human's next message; a drive alone does not clear it. "Ready to merge" goes: a feature that is ready to test is ready to merge.
**Why:** The brief names it as a need. One state is simpler than the test-then-merge pair, which depended on whether a drive was set up.

## 9. Events with no agent behind them go to the agent; a dead run needs you
**Decision:** A merge conflict, a failed worker and a worker's dead sandbox are delivered to the feature's lead as a message, and the lead decides whether to tell the human (by `wait_for_you`). When the agent itself cannot run (its run crashed, or the usage limit stopped it with "carry on" off), runcastle sets "Needs you" on that chat with a fixed line, such as "The agent's run failed (exit 1)" or "Usage limit reached". This is the one need runcastle sets itself. A run that ended normally without calling the tool is not a failure: it reads idle.
**Why:** The brief's recommendation: the simplest home for an event is the owning agent. A dead run has no agent to tell, and only the human can restart it; a crash is a fact, not a guess.

## 10. Stop reads idle
**Decision:** When the human presses Stop, the feature reads idle. "Stopped · you stopped it" goes. Stop still holds the lead back until the human replies.
**Why:** The human did it; there is nothing to tell them.

## 11. Waiting designs do not make a need by themselves
**Decision:** A recorded design waiting for approval no longer turns the feature amber. The lead says so with `wait_for_you` when it wants the human to look. The design card, its Approve button and the Design tab are unchanged.
**Why:** Only an agent's call sets "needs you".

## 12. A feature's row carries its workers' needs
**Decision:** A feature row reads "needs you" when its lead or any of its workers needs the human. It shows the newest need's line, and clicking it opens that exact chat (the worker's, if it is a worker's). Each worker card shows its own.
**Why:** One place to look in the sidebar, and one click to the question (decision 3).

## 13. No held needs, no owner prefixes, no hour's grace
**Decision:** "With <chat> · …", "Asking <chat> · …", "Handed back · …" and the 60-minute grace before an epic's need comes to the human are deleted. A lead that hands back to its orchestrator chat reads idle; the orchestrator chat reads working, and needs you only if it calls `wait_for_you` itself. The automatic switch of an epic's feature to the human on `wait_for_you` stays for now: removing it belongs to "Ownership is a label".
**Why:** "Needs you" belongs to the chat whose agent called the tool. Ownership is the sibling feature's to simplify; this feature only stops deriving needs from it.

## 14. One ping per need, every time
**Decision:** Every time an agent starts needing the human, the desktop and the phone are pinged once, with the agent's line. There are no quiet needs and no held needs, so the only ping rule is "it needs you now and did not a moment ago". Nothing that is not a need pings.
**Why:** With the guess gone, every need is real, so each is worth a ping.

## 15. The status shows five things
**Decision:** A feature's status line and sidebar row show one of: "Needs you · <why>", "Working", "Idle", "Merged", or its shelf (backlog, archived) as today. Phase words such as "Talking with you", "Agent working" variants and "Waiting for you ·" leave the status. Working means the lead is mid-turn, its subagents or background commands run, or one of its workers works.
**Why:** The brief asks to count what the UI shows and confirm it is just these.

## 16. Up-next drafts with a problem leave the Needs you lane
**Decision:** A draft marked up next that cannot start (a dependency dropped, say) shows its problem on its own row in red, but no longer sits in "Needs you" and never pings.
**Why:** No agent called the tool; it is a fact about the queue, not a question.

## 17. Agents are told to call the tool; there is no fallback
**Decision:** Every agent's instructions carry one rule: if your last message asks the human anything, call `wait_for_you` with one short line. Runcastle never guesses a question from a finished turn. If an agent forgets, its row reads idle and the question waits in its chat.
**Why:** A fallback would be the guessing the human rejected. A missed ping is visible in the chat; a false one is the noise the human complained about.

## 18. "Needs you" wins over "Working"
**Decision:** When an agent has called `wait_for_you` but its subagents, background commands or workers still run, its row reads "Needs you". "Working" shows only while nothing needs the human.
**Why:** The agent said it needs the human; that is the one thing the row exists to say.

## 19. Closing clears needs
**Decision:** Merging, archiving or shelving a feature clears every need on it and its workers; dropping or landing a worker clears that worker's. Nothing times out on its own.
**Why:** A closed feature cannot need anyone; a timeout would be another guess.
