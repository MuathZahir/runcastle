# Decisions — Epics on autopilot

Planned without the human (a headless planning run, 2026-11-13). Decisions 1–12 are the
human's own, from the brief ("What the human agreed" and the two orchestrator additions
that quote them). Decisions marked **Assumed.** were made in this run and wait for the
human's check.

Check first: 14, 16, 17, 18, 23

## 1. Autopilot is one switch per epic
**Decision:** An epic is an orchestrator chat plus the features it created. Autopilot is switched on and off for an epic, never for a single feature. Per-feature ownership (`held_by`), the tool that takes a feature (`take_feature`), the "who finishes it" choice and the "Run it for me" planning answer are deleted, not wrapped.
**Why:** Handing a single feature to an orchestrator chat is what created the ownership machinery: owners per feature, automatic flips, hold refusals, startup repairs. The human had to remember who ran each feature.

## 2. Autopilot off is the default, and every feature is the human's
**Decision:** With autopilot off, every feature is the human's. They talk to it in its own chat. The orchestrator creates features and links the human to them; it does not message features or answer for them.
**Why:** The brief: one obvious place per feature, and that place is the feature's chat unless the human said otherwise.

## 3. Autopilot on: the epic chat is the only place the human talks
**Decision:** On autopilot the epic's features work for the orchestrator. Their questions for the human, their "ready to test" and their merges all come to the epic. The human can open a feature's chat and watch it, but cannot type there; a note in place of the message box says the epic is on autopilot and links to the epic.
**Why:** "It should be very obvious when the user has to go to the orchestrator and when to the feature agent."

## 4. How far autopilot goes is whatever the human says in the epic
**Decision:** There is no separate finish setting. "Take them to ready to merge", "build them and show me the screenshots" or "merge them" are all valid instructions, and the orchestrator follows the words.
**Why:** The brief; the finish choice was one of the settings the human could not keep track of.

## 5. Only the human turns autopilot off
**Decision:** A question only the human can decide does not end autopilot. It waits in the epic while the other features carry on; overnight, that feature just waits.
**Why:** "When autopilot is on, I can go sleep." The old automatic flip of a feature to the human (ADR-0021 §5) is what bounced the human between chats.

## 6. Turning autopilot off returns every feature to the human
**Decision:** When autopilot goes off, each of the epic's features is the human's again. Each lead is told, and each feature's chat opens for typing.
**Why:** The brief.

## 7. It must be very obvious which features are on autopilot
**Decision:** In the sidebar, an epic on autopilot and its features look distinct ("cool and maybe futuristic", in the human's words). The look stresses that the features are locked and being worked by the orchestrator. A feature on autopilot shows no "needs you" of its own; the epic shows it. The look is designed in design mode.
**Why:** The brief: the human must never have to remember who runs what.

## 8. Switched through the chat, with one escape hatch
**Decision:** The human turns autopilot on and off by saying so in the epic chat ("go on autopilot", "stop"); the orchestrator calls a tool. There is no button in the main UI. The lock note in a locked feature chat also carries an "End autopilot" link that works without the orchestrator.
**Why:** The human: "all of that should be through the chat. No separate button." The link covers an orchestrator chat that cannot take a turn (a usage limit overnight, a crash, a very long turn), which would otherwise keep features locked for hours.

## 9. The epic grill stays, before autopilot
**Decision:** The order is: the orchestrator grills the human on the epic, cuts it into features, proposes a run plan, gets the human's yes, then goes on autopilot. Autopilot never replaces the grill that shapes the epic.
**Why:** The human: "the orchestrator obviously should grill the user on the epic so that it understands the best way to cut it — that doesn't change."

## 10. The orchestrator proposes a run plan before going on autopilot
**Decision:** For each feature the orchestrator says what it will do and why: plan it itself and take it to some point, or leave it for the human's grill ("A and B I'll take to ready to merge; C changes how billing works, so I'll leave it for your grill"). The human says yes or adjusts it in the chat. That proposal is the agreement; nothing about it is fixed in machinery.
**Why:** The human: "the agent should give the user the best way to go about things."

## 11. The human can hand over their decisions
**Decision:** When the human says so ("do the whole thing"), the orchestrator answers the feature leads' decisions in the human's place, and says yes to their plans. The human decides unless they hand decisions to an autopilot. Handing over covers feature-level decisions that come up later, never the epic's grill.
**Why:** The human: "complete the whole thing until it's ready to merge. So it would go through the features, answer all the decisions, make the features plan themselves." This turns charter decision 9 ("the human makes every decision") from an absolute into a default; the project session rewrites it at merge.

## 12. On autopilot with decisions handed over, leads accept the orchestrator's answers
**Decision:** Today the lead refuses an orchestrator's yes on designs and behaviour and waits for the human's own words. On autopilot with decisions handed over, the orchestrator's answer counts. Off autopilot, nothing changes. Only the skill lines that say this change here.
**Why:** Without it, handing over decisions would stall at the first design. The broader skill rewrite belongs to "Skills become short rules".

## 13. An epic's features are the ones it created, plus any the human adds
**Decision:** A feature belongs to the epic whose chat created it. When the human tells an epic to also run another feature ("also run X"), X moves to that epic. Features the epic creates while on autopilot join its run. A feature belongs to at most one epic; one made with "New feature" belongs to none until the human gives it to one.
**Why:** It reuses the link every feature already carries to the chat that created it, so membership needs no new setting the human must remember.
**Assumed.** Alternative: membership fixed at creation, with no way to add a feature to an epic later.
**For the human.**

## 14. Autopilot runs the features its run plan gives it; the rest stay yours
**Decision:** Turning autopilot on names the features it runs, from the agreed run plan. Only those lock. A feature the run plan leaves for the human's grill stays the human's and unlocked, so they can grill it in its own chat while the others carry on. The human can add one later ("also run C") or take one back ("I'll do C myself") in the epic. Ending autopilot still returns them all at once.
**Why:** The run plan already leaves some features for the human's grill (decision 10). If those locked too, the human could only grill them through the epic, with the orchestrator relaying each question: the relay ADR-0021 removed because the human answered twice.
**Assumed.** Alternative: autopilot locks every feature in the epic, and a feature left for the human's grill is grilled through the epic chat.
**Challenged:** A per-feature "in the run" mark, with "also run C" and "I'll do C myself", is per-feature ownership and `take_feature` under new names, the thing this feature exists to delete. Keep it only if the human accepts that knowingly; otherwise lock the whole epic and grill C after ending autopilot.
**For the human.**

## 15. With autopilot off, the orchestrator creates and starts, and nothing more
**Decision:** With autopilot off, the orchestrator may create features, start the ones it cut when the human asks (a branch and its first run, grilled or self-planned), read them, and hear when they merge. It does not message their leads, answer for them, drive or merge them.
**Why:** Starting a feature is not answering for it, and "start A and B" in the epic is the cut's natural next step. Everything that talks to a lead waits for autopilot, so a lead off autopilot only ever hears from the human.
**Assumed.** Alternative: the orchestrator only creates; the human clicks Start on every feature.
**For the human.**

## 16. A locked feature can be watched, not acted on
**Decision:** On autopilot, a feature's chat and its workers' chats have no message box, and its acting buttons (Stop, Test drive, Merge, Approve on designs) are hidden. Everything stays readable: the chat, the plan, designs, the review, the diff. The lock note's links (to the epic, and "End autopilot") are the only actions. To drive or merge in the morning, the human tells the epic, or ends autopilot and works in each feature's chat as usual.
**Why:** One place to act per feature is what makes it obvious. A Stop or Merge clicked in a locked feature would act behind the orchestrator's back.
**Assumed.** Alternative: lock only the message box, and keep Stop, Test drive and Merge working.
**Challenged:** Keep Stop working in a locked feature and tell the epic when it is used. Stop is a safety brake, not a decision; without it, halting one runaway lead means ending autopilot for the whole epic.
**For the human.**

## 17. What a locked feature needs goes to the orchestrator, and only the orchestrator pings you
**Decision:** On autopilot, a lead tells its epic, not the human, whenever it would otherwise need the human: a question, a plan or design for a yes, ready to test, a failed worker, a merge conflict. A lead's run that dies is reported to the epic too. The orchestrator decides what reaches the human, and the epic reads "Needs you" only when the orchestrator says so. If the orchestrator's own run dies (a usage limit, a crash), the epic reads "Needs you" with that reason, as any dead run does today.
**Why:** "When autopilot is on, I can go sleep": the human is woken only for what the orchestrator could not settle, and always in one place.
**Assumed.** Alternative: a dead lead run on autopilot still shows "Needs you" on the epic directly, without the orchestrator deciding.
**For the human.**

## 18. Hard limits stay, even with decisions handed over
**Decision:** Even when the human handed over their decisions, the orchestrator stops and waits for the human on: a new paid service, account, purchase or setup step for the human; anything outside git that cannot be undone, such as deleting data or sending something out (a deploy, a package release, a post, an email); and anything the human named as theirs. Ordinary agent usage is never a hard limit. Merging goes only as far as the human's words said. The feature carries on around the wait where it can.
**Why:** These are the decisions a human would be upset to find made for them overnight, and none of them can be reversed before merge. Everything inside git can be.
**Assumed.** Alternative: no fixed limits; the orchestrator judges each case from the run plan.
**For the human.**

## 19. Every decision made for the human is marked and summed up
**Decision:** A decision the orchestrator makes in the human's place is marked **Decided by autopilot** in its feature's `decisions.md`, and a design it approves is shown as approved by autopilot. When the run plan's work is done, or when the human next writes in the epic, the orchestrator posts one summary: per feature, what it decided for them and what waits for them, each with a link. The human reverses anything before merging, by telling the epic or by ending autopilot and telling the feature.
**Why:** Handing decisions over is only safe if nothing decided for the human is hidden from them.
**Assumed.** Alternative: a running log the orchestrator posts after each decision.
**Challenged:** Also post the summary each time the run stalls on something only the human can answer, since the human may check in mid-run and the summary is the one place the decisions made for them are gathered.
**For the human.**

## 20. Ending autopilot: work carries on, and each lead re-asks what is still open
**Decision:** Ending autopilot (by the human's words or the "End autopilot" link) stops nothing that is running. Each lead is told the feature is the human's again, and that any question it still has goes to the human with `wait_for_you`. The orchestrator is told too, and stops answering for those features.
**Why:** The lead knows its own open questions; nothing has to be moved across from the epic. Stopping running work would throw it away for no reason.
**Assumed.** Alternative: the orchestrator lists the open questions it held in the epic chat when autopilot ends.
**For the human.**

## 21. Features held by an epic today become the human's at upgrade
**Decision:** When this ships, every feature is the human's and every epic starts with autopilot off. Features an epic runs today, and their leads, are told once that the feature is the human's now. The human turns autopilot on again in words where they want it.
**Why:** The old "run it for me" and finish settings do not map cleanly onto a run plan the human agreed, and an upgrade happens when the human is present (they merge this feature).
**Assumed.** Alternative: an epic holding features today starts on autopilot for those features.
**For the human.**

## 22. The orchestrator's messages name the epic
**Decision:** A message from an orchestrator to a lead opens with the epic's name ("From the epic "Checkout flow", not the human"), not only "From the project's orchestrator".
**Why:** The brief asks for it: a lead, and the human reading its chat, see at once which epic is talking.
**Assumed.** Alternative: keep the generic line.

## 23. Autopilot carries on after a usage limit, whatever the setting says
**Decision:** While an epic is on autopilot, its chat and its locked features' leads and workers are woken once when a usage limit resets, even when the human's "carry on after a usage limit" setting is off. The summary says how long the run was paused. Off autopilot, the setting rules as today.
**Why:** A usage limit is the most common overnight failure. Turning autopilot on is the human saying "run while I sleep"; an epic that stalls at 1 a.m. and waits for morning defeats it.
**Assumed.** Alternative: autopilot follows the setting, and the run plan warns when it is off.
**For the human.** This overrides a setting of the human's while autopilot is on.

## 24. A question already waiting moves to the epic when its feature joins autopilot
**Decision:** When a feature joins autopilot (autopilot turned on, or "also run X") while its lead waits on the human, the wait in its chat is closed and the lead is told to re-ask through the epic. It is the mirror of decision 20.
**Why:** A locked chat cannot be answered; a question left there would sit unseen.
**Assumed.** Alternative: the orchestrator reads open waits when autopilot starts and answers or raises them itself.
**For the human.**

## 25. On autopilot without handed-over decisions, the human approves in the epic
**Decision:** When the human did not hand over their decisions, a locked feature's plan, designs and other questions still come to the epic. The orchestrator links to the plan or design (still readable in the locked feature), the human answers in the epic, and the orchestrator relays the answer to the lead marked as the human's own words, which the lead accepts as the human's.
**Why:** The lock hides the Approve button (decision 16), so the approval needs one place to happen; the epic is it (decision 3). Relaying the human's own words counts as the human, so nothing is answered twice.
**Assumed.** Alternative: keep the Approve button working on a locked feature's designs.
**For the human.**
