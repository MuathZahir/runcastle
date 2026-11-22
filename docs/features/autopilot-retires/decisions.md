# Autopilot retires: decisions

Planned with nobody present; the epic "Runcastle Rethink" runs this feature on autopilot and answered the plan on 2026-11-22. Decisions marked "Decided by autopilot" are the epic's, and the human can overturn any of them.

## 1. One per-feature setting replaces autopilot and the planning mode
**Decision:** The "Involve me in" level on each feature does what autopilot and the "plan with me or plan automatically" choice did. Autopilot goes whole: the orchestrator's switch for it, the run plan, the locked feature chats and their "End autopilot" note, and the autopilot marks in the sidebar. The human can always type in any feature's chat, and leads never send questions, the plan's yes or "ready" to the orchestrator. Nothing stays behind a flag.
**Why:** "Alright, but this setting will be for every feature." and "Do we really need something called 'Autopilot' in this case?"

## 2. The orchestrator is woken on every merge of its features
**Decision:** Every merge of an epic's feature wakes that epic, whoever merged it (the human, or runcastle at "Nothing"), and whether or not other features are still running. Runcastle's message carries the review's summary and the decisions the lead made without the human, so the epic can adjust later briefs, offer a follow-up, or tell the human the epic is done.
**Why:** "Would it not be needed after a feature merges? I feel like there are some usecases where it could be needed." Chosen over the orchestrator's first idea of dropping the wake.

## 3. Strict dependencies; a waiting feature starts by itself
**Decision:** A feature that waits on another starts only after that one merges, and then starts by itself. Nothing is built on unmerged work.
**Why:** "Yes", to the orchestrator's proposal.

## 4. One Start button, acting by the level
**Decision:** A feature that has not started shows one Start button; "Plan automatically" goes. At "Everything", Start opens the lead, which reads the brief and asks its first question, as Start does today. At "Designs and result" and below, Start sets the lead planning and building by itself, stopping only where the level says. The orchestrator's "plan this feature" and "stop its planning run" tools fold into its start tool the same way.
**Why:** Decision 1 retires the planning mode, and the level already says how much the lead asks, so a second button would say it twice.
**Decided by autopilot.** The epic took this pick.

## 5. "Starts by itself" means its lead starts working
**Decision:** When a feature's last dependency merges, runcastle cuts its branch and launches its lead as Start would (decision 4). At "Everything" the lead asks its first question in the feature's chat and waits there for the human.
**Why:** Today such a feature only gets its branch and then sits until someone clicks Start, which is not what decision 3 promises.
**Decided by autopilot.** The epic took this pick.

## 6. What "the review is clean" means for a merge at "Nothing"
**Decision:** Runcastle merges a feature at "Nothing" only when runcastle's own review ran on it, the lead told that review the project's checks passed, and no defect from any review is still open. A defect counts as closed when fixed, or dismissed by the lead with a reason; dismissed ones are listed in the merge message (decision 2). Observations never block. If any of this is missing, the feature waits as "Ready to test" for the human, and the lead is told why.
**Why:** The brief asks for a clean review and green checks before a merge nobody watches. Today the merge only checks for open defects, so a feature with no review at all would merge. Low defects also block because the lead can dismiss one with a reason, which keeps the choice visible.
**Assumed.** Alternative: let a low defect stay open; or accept the lead's own subagent review. Note the clash: this epic told leads to review with subagents and start no review workers, so under this rule its "Nothing" features would wait for the human instead of merging.
The epic changed this; see 11.

## 7. Undoing a merge made without the human is a git revert
**Decision:** No undo button. When runcastle merges a feature itself, the feature's chat gets a line naming the merge commit and the command that reverts it.
**Why:** A revert is the safe, ordinary undo and needs nothing new in runcastle; a merge at "Nothing" is rare and chosen.
**Decided by autopilot.** The epic took this pick.

## 8. What the orchestrator may still do inside its features
**Decision:** The orchestrator keeps creating, starting and reading its features, setting their dependencies and levels, and editing a feature's brief before it starts. It may also send a short message to one of its features' leads, which the lead's chat shows as from the epic. It no longer merges, drives or stops a feature: the human does those, or runcastle at "Nothing".
**Why:** Without autopilot nothing is ever locked to the epic, and today merging, driving, stopping and messaging work only on locked features. Messaging stays because the epic's job after a merge is to adjust what comes next.
**Assumed.** Alternative: let the orchestrator also merge, drive or stop any of its features when the human asks it to in its chat.
The epic changed this; see 12.

## 9. Leads tell the epic only about trouble that crosses features
**Decision:** A lead tells its epic only when it hits a merge conflict it cannot settle, is stuck after three tries, or stops for money, accounts or something outside git that cannot be undone. Those stops also wait on the human in the feature's chat. Everything else stays between the lead and the human. A conflict at a merge goes to the lead first, as today.
**Why:** The brief's "woken for trouble that crosses features", and the human's earlier word that the epic is not a relay. Hard limits stop at every level, so this keeps those stops and their names.
**Decided by autopilot.** The epic took this pick.

## 10. Epics on autopilot at the upgrade
**Decision:** When runcastle upgrades, every open feature of an epic that is on autopilot and still at "Everything" moves to "Nothing", and its lead is told, as for any level change. A feature the human already set to another level keeps it. Waits that were addressed to the epic go back to their feature's chat.
**Why:** Under autopilot the epic answered, approved designs and merged, which is what "Nothing" does now, so the epic keeps working. A level the human picked by hand is their choice.
**Assumed.** Alternative: move them to "Result only", so nothing merges until the human tries it.
The epic changed this; see 13.

## 11. "The review is clean" means the lead's word, with findings recorded
**Decision:** Runcastle merges a feature at "Nothing" when its lead declares it ready, says the project's checks passed, and no defect of any severity is open (each fixed, or dismissed with a reason). It does not require that a runcastle review worker ran: a lead may review with its own subagents, and records what they found as findings, so open defects still block. Dismissed defects are listed in the merge message. If any part is missing, the feature waits as "Ready to test" and the lead is told why.
**Why:** The epic: "a merge is never held for a review mechanism, and a lead may review with its own subagents, as this whole round did." Chosen over requiring runcastle's review worker.
**Decided by autopilot.**
Supersedes: 6

## 12. The orchestrator keeps merging when the human asks it to
**Decision:** As 8, but the orchestrator keeps its merge tool for its own features, for when the human asks it to merge. It loses driving and stopping.
**Why:** The epic: the human asked it to merge, word for word, earlier in this epic. Chosen over removing the merge tool.
**Decided by autopilot.**
Supersedes: 8

## 13. Epics on autopilot at the upgrade move to "Result only"
**Decision:** When runcastle upgrades, every open feature of an epic on autopilot that is still at "Everything" moves to "Result only", and its lead is told. A level the human set by hand stays. Waits addressed to the epic go back to their feature's chat.
**Why:** The epic: moving them to "Nothing" "would let runcastle merge work the human never chose to merge unseen, in any project". "Result only" loses them nothing, and "Set all to…" moves them to "Nothing" in one click. Chosen over "Nothing".
**Decided by autopilot.**
Supersedes: 10
