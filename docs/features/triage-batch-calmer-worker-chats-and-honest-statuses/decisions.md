# Decisions — Triage batch: calmer worker chats and honest statuses

Planned without the human (a headless planning run, 2026-11-10). Decisions 1–6 are the
human's own, settled in the orchestrator's notes triage and copied from the brief. The
rest were made by the lead alone and carry an **Assumed.** line. The challenge was an independent agent given only the brief and these decisions.

Check first: 9, 10, 13, 14, 15

The orchestrator read the plan against the triage grill and agreed with 7, 9, 10, 12, 13, 14 and 15,
and asked how decision 15 covers the phone; its wording now says so. That is the orchestrator's
read, not the human's yes: every **Assumed.** decision still waits on the human.

## 1. "Worked for" rows say what ran
**Decision:** Every word the agent writes stays in view and each stretch of tool calls keeps its own row, but the row's label becomes a mechanical summary of what ran in that stretch, e.g. "Ran 5 commands, read 2 files, edited 1 file", built from the tool-call kinds runcastle already records. No agent writes it.
**Why:** The rows carried no information; a count of what ran says something at a glance without hiding any words (decision 12 of `every-word-the-agent-writes-stays-in-view` stands).

## 2. Handback card: first paragraph, capped when opened
**Decision:** A worker's handback card shows the first paragraph of its report plus the commit count and changed files as today; "Show more" opens the rest inside a box with a maximum height that scrolls, so the card never takes over the screen. A mechanical cut, not a new worker-written summary field.
**Why:** A full report was a screen and a half in the lead's chat.

## 3. Assignment card starts folded
**Decision:** The assignment card pinned at the top of a worker's chat starts folded to one line (worker name and the first line of its goal); a click opens it; open, it gets the same maximum height with scroll as the handback card. It stays pinned.
**Why:** Open and pinned, it covered the conversation.

## 4. "Needs your answer" only when the lead is really waiting
**Decision:** Find the real cause of "Needs your answer" showing while the lead or its workers are working, fix it, and pin it with a test, keeping to `the-status-tells-the-truth-about-who-and-what`.
**Why:** The status said the human was needed when nobody was waiting on them.

## 5. The agent's test drive is labelled as the agent's
**Decision:** A drive the Review worker started stays visible in the shared drive slot, labelled as the agent's (e.g. "Review worker is trying this feature"), and clicking it opens that worker's chat. The "can't land its own edits" banner shows only on the human's own drives. The drive state carries who started it.
**Why:** Hiding it would block the human's own drive with no visible reason, and it is the feature loop showing itself; ADR-0014's one drive slot is unchanged.

## 6. A "workers started" card in the lead's chat
**Decision:** Copy the orchestrator's feature cards: one card per lead turn, a row per worker started that turn with its name, the first line of its goal, a live status (working / waiting on you / handed back) and a click that opens the worker's chat.
**Why:** Today a started worker leaves nothing clickable in the lead's chat; the human has to find it in the side panel.

## 7. The work row keeps its duration, after the summary
**Decision:** A finished stretch's row reads "Ran 5 commands, read 2 files, edited 1 file · 32s": the summary first, the time muted after it. A stretch of thinking only keeps "Thought for 8s"; a stretch still running keeps showing its steps live, as today.
**Why:** The time still says how long the human waited, and costs a few characters once the summary leads.
**Assumed.** Alternative: drop the duration altogether.
**For the human.** Every chat's work rows change their words.

## 8. The summary counts what the human would care about, in a fixed order
**Decision:** The summary counts, always in this order: commands run, distinct files read, distinct files edited (edits, deletes and moves), searches, pages fetched, subagents run, and calls of other tools (runcastle's own tools, skills) as "used N tools". A subagent counts as one ("ran 2 subagents"); the calls inside it are not added to the parent's counts.
**Why:** A fixed order lets a skimming eye land in the same place on every row; a subagent's own calls would swamp the parent's counts and are one click away inside it; counting the other tools keeps a row from ever reading empty.
**Assumed.** Alternative: list the kinds in the order they first happened, and fold a subagent's inner calls into the parent's counts.

## 9. The calmer rows and cards apply in every chat, not only worker chats
**Decision:** The work-row summary (1, 7, 8) and the capped handback report (2) apply wherever those pieces render: worker chats, lead chats, the orchestrator's chats and the phone. The orchestrator's own handback card (a feature's lead handing back to its chat) gets the same cap.
**Why:** It is one shared component per piece; keeping an uncapped copy in the orchestrator's chat would keep the same screen-and-a-half problem there.
**Assumed.** Alternative: limit the change to worker and lead chats.
**For the human.** The orchestrator's chats change too.

## 10. Folded cards and worker rows show the worker's purpose line, not the goal's first line
**Decision:** The folded assignment card (3) and each row of the "workers started" card (6) show the worker's name and its **purpose**, the one-line description the lead writes for every worker and the side panel already shows, instead of the first line of the goal.
**Why:** Goals open with reading instructions ("Read first: docs/features/…/spec.md…"), so their first line says nothing about the work; the purpose line was written to be that one line.
**Assumed.** Alternative: the first line of the goal, as the brief says.
**For the human.** It changes words the brief chose.

## 11. A worker's assignment line from runcastle stays as it is
**Decision:** The "Runcastle · Start your assignment: … Show more" line at the top of a worker's chat is left as it is; only the pinned card folds.
**Why:** It is already one sentence with its own Show more, and it is the worker's real first prompt, which decision 12 of `every-word-the-agent-writes-stays-in-view` keeps in view.
**Assumed.** Alternative: hide it, since the pinned card holds the same goal.

## 12. The workers card covers the Review worker and every live status
**Decision:** The "workers started" card gets a row for every worker the lead starts that turn, the Review worker and a verify review included. Its live status uses every real worker state in plain words: waiting to start, working, waiting on you, handed back, landed, dropped, failed. Sending a worker back adds no new row; its existing row turns back to working.
**Why:** The review is a worker the human may want to watch, and a status that says only "working / waiting on you / handed back" would lie once a worker lands or fails.
**Assumed.** Alternative: leave the Review worker out, since its package arrives in the chat anyway.
**For the human.** The lead's chat gains these cards.

## 13. The real cause of the false "Needs your answer": workers did not count as work
**Decision:** The sidebar (desktop and phone) took its words from the feature's need, and the need treated a lead whose turn ended on a plain reply ("I've started the work") as waiting on the human, because a lead with workers at work still counted as idle. From now on, a lead's quiet "it replied, so it may await you" need does not stand while any of its workers is working or waiting to start: the sidebar then says the feature is working, as the header already did. A real wait still beats workers: the lead's own `wait_for_you`, an open question box, a permission prompt or a worker that needs the human still reads as needing the human.
**Why:** The header already counted workers and said "Working · 1 worker at work" in the same moment; the two must follow one rule, and the precedent (`the-status-tells-the-truth-about-who-and-what`, decisions 3 and 9) already counts a running subagent as work. A lead with workers out is woken by their handbacks, so nothing is lost.
**Assumed.** Alternative: treat a reply ending in "?" as a real question even while workers work.
Phone and desktop alerts read the same need, so they stop firing for it too.
**For the human.** What the sidebar says while workers work changes.
**Challenged:** A lead that asks "Should I also do X?" in plain words while its workers run would now read as working, and the question would wait unseen until a handback; leads should be held to asking with `wait_for_you`, and the human should weigh that trade.

## 14. A lead's own wait stays until the human replies; the tool's description is corrected
**Decision:** Starting a worker or a review does not clear a wait the lead raised with `wait_for_you`; only the human's next message does, as today. The tool's own description, which says "your next dispatch clears it", is corrected to match.
**Why:** A lead may ask the human something and then start unrelated work; clearing the wait would make a real question vanish unanswered. Decision 13 alone fixes the reported bug.
**Assumed.** Alternative: clear the wait when the lead starts a worker, as the description promised.

## 15. The agent's drive in the slot: named, opens its chat, Stop asks first
**Decision:** While the Review worker drives, the sidebar's drive slot names it ("Review worker is trying this feature", the feature's title beneath) and a click opens the Review worker's chat on the feature's page. Its Stop button stays, but asks first, saying it ends the review's drive. The feature's header reads as a worker at work and offers no "Stop drive" of its own, and the "can't land its own edits" banner stays away (decision 5). The phone has no drive slot and cannot start a drive, so it never meets a busy slot. It does show the human's drive, in its chat bar's status words and the chat's banner. Both come from the same shared feature status, so during an agent's drive the phone reads as a worker at work, the same as the desktop.
**Why:** The slot is the human's, so they must be able to take it back without dropping the whole review; the confirm keeps a stray click from breaking a running review. The banner is technically true during a review drive too (the lead's own commits wait), but the lead is idle while the review runs, so it only adds noise.
**Assumed.** Alternative: no Stop on the agent's drive, so the only way to end it is to drop the Review worker from its chat.
**For the human.** The drive slot and the header behave differently during a review.

## 16. The human's own Test drive while the agent drives stays refused, and says why
**Decision:** While the Review worker holds the drive slot, the human's Test drive stays refused as today (ADR-0014's one slot), and its reason names the Review worker ("Review worker is trying this feature") with a way to open its chat, instead of the server's "the review agent's drive of <branch>".
**Why:** Queuing or taking over the slot would change the one-drive-slot rule, which this feature must not touch; naming who holds it, and where to find them, is the honest part.
**Assumed.** Alternative: let the human's Test drive take the slot over after a confirm.

## 17. The Review Package keeps its own layout
**Decision:** The cap of decision 2 applies to worker handback cards (and the orchestrator's twin, decision 9). The Review Package, the review's own attachment with screenshots and findings, keeps its layout.
**Why:** It is the page the human accepts the feature from, built to be read in full; capping it is a different question from the one the brief raised.
**Assumed.** Alternative: cap the Review Package's text the same way.

## 18. Prompts Claude Code makes on its own never count as the human typing
**Decision:** When a lead's background helper finishes, Claude Code hands its result to the lead as a new prompt that opens with `<task-notification>`. The lead's prompt hook (`handleLeadPrompt` in packages/server/src/routes/hooks.ts) counts every prompt without runcastle's tag as the human typing. That moves a chat-owned feature to the human and clears what the feature waits on. From now on, such machine-made prompts change nothing: the owner stays the same and no human-message mark is set. The builder looks for other prompts of the same kind, checks whether the Codex runtime has an equivalent, and covers the fix with a test. It goes to the "Honest statuses" worker.
**Why:** During this feature's own planning run, seven helper results moved the feature to the human and cleared its waiting marks, though the human never typed. Same family as decision 4: a status must say who is really acting.
**The human's**, added to the brief as item 7 through the orchestrator on 2026-11-10.
