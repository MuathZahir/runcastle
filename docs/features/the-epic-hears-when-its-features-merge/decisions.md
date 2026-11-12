# Decisions — The epic hears when its features merge

Planned without the human (a self-planning run, 2026-11-12). Decisions 1–4 are the
human's own, copied from the brief; the human confirmed 5–15 with their yes to the plan (2026-11-12).

## 1. A merge always tells the epic the feature came from
**Decision:** When a feature merges, runcastle tells the orchestrator chat the feature came from (its epic), whoever owns the feature and whoever pressed Merge.
**Why:** The orchestrator should orchestrate: it cannot check that a cut fits together if it never hears that pieces landed.

## 2. It wakes that epic only while the epic has other unfinished features
**Decision:** The merge wakes the epic (starts a turn) only while that epic has other unfinished features. With none, no turn is spent.
**Why:** With nothing left to fit against, there is nothing to check.

## 3. On that wake the epic checks fit and warns siblings; it speaks to the human only on a problem
**Decision:** On the wake the epic checks the merged work fits with its siblings, and tells any sibling in progress what changed under it with `send_to_feature` (marked as the orchestrator's). It speaks to the human only if it found a problem.
**Why:** Integration is the orchestrator's job; a clean merge needs no words to the human.

## 4. This reverses decision 23 of "agents are woken only when it matters" for merges only
**Decision:** Merges are the one named exception to "the human's own merges tell the orchestrator nothing". Every other news line stays as that feature left it. The accepted cost is one orchestrator turn per such merge.
**Why:** A merge happens once per feature, so it is not the noise that decision removed.

## 5. "Unfinished" means a sibling that is started once the merge is done
**Decision:** The wake test counts the epic's other features that are started (in progress, not merged or dropped), checked after the merge has started any up-next drafts that were waiting on it. Plain backlog drafts do not count.
**Why:** A draft nobody has started has no code to clash with and no lead to warn; the epic reads it again when it starts. Up-next drafts that this merge starts are counted because they begin on top of the merged work.

## 6. With no unfinished sibling, the merge is logged in the epic's chat without a turn
**Decision:** When the wake test fails, the merge line is still written into the epic's chat but held: no turn starts, and the epic reads it ahead of whatever next wakes it. The line itself says nothing is left to check, so the epic takes no action on it when it next wakes.
**Why:** Decision 1 says a merge always tells the epic. Holding keeps the epic's record whole and costs nothing.

## 7. The merge shows in the epic's chat as a news row
**Decision:** Woken or held, the merge appears in the epic's chat as runcastle's news row under the merged feature, in the "done" tone, reading "Merged" with who merged it. It reuses the news row that "started by itself" lines already use; nothing new is drawn.
**Why:** The human should see why the epic took a turn, in the same place as runcastle's other news.

## 8. A long-idle or large epic chat is woken like any other
**Decision:** The merge wakes the epic whatever its size or idle time. Decision 7 of "agents are woken only when it matters" (news never restarts an oversized orchestrator chat) is no longer in force: its decision 26 replaced it with compaction, which already runs before a turn that follows a long gap.
**Why:** Compaction keeps the turn's cost bounded, and a merge is exactly when a long-quiet epic should look at its cut.

## 9. When the epic merges a feature itself, it checks in the same turn instead of waking again
**Decision:** When the epic's own `merge_feature` call does the merge, the line is held, not woken, and the tool's answer lists the unfinished siblings so the epic checks fit right there. Another chat's merge, or the human's, wakes as decision 2 says.
**Why:** The epic is already mid-turn and knows it merged; a second turn to tell it so would be the noise decision 4 promises to avoid.

## 10. The epic tells only the siblings the merge touches
**Decision:** On the wake, the epic messages (`send_to_feature`, marked as the orchestrator's) only the in-progress siblings the merged work actually affects: shared files or modules, something they build on, or a decision they assumed. The note says what changed and, when it touches the sibling's files, that its lead should bring the new main into its branch now; the lead does that, not the epic. Siblings it does not touch hear nothing. With nothing affected and no problem, the turn ends without a word to anyone.
**Why:** Each `send_to_feature` wakes that sibling's lead and counts as a human message there; telling every sibling on every merge would spread the noise to the leads. An affected sibling is worth a lead turn: bringing main in early keeps conflicts small.

## 11. A problem in merged work is reported with an offer, not fixed unasked
**Decision:** When the epic finds the merged work does not fit, it says so to the human in its own chat in a few lines and offers the fix: a new feature in its cut, or the in-progress sibling the fix naturally belongs to. It also sends one phone notification (`notify_human`), since under "One place to answer" the human mostly works in feature chats and may not open the epic's for days. It creates nothing and asks nothing in the features it does not own.
**Why:** The brief keeps the epic out of other features' questions; what to do about a problem on main is the human's call, and a report nobody reads checks nothing.

## 12. Only the epic's own features are checked
**Decision:** The merge tells only the epic the feature came from, and that epic checks fit against its own siblings. Features of other epics, and features made with the app's own New feature button, are not checked by anyone on a merge.
**Why:** The brief scopes this to the epic's own cut, and a feature with no epic has nobody to tell. A project-wide check is a different, larger feature.

## 13. The fit check reads; it does not run the tests
**Decision:** On the wake the epic reads what merged (the merge's diff and the feature's outcome) against its in-progress siblings' briefs, specs and branches. It runs no tests and starts no drive or review.
**Why:** The merged feature already passed its checks and review; each sibling runs the project's checks when it brings main in. Running tests per merge would make each wake far more expensive.

## 14. The line goes to the epic's current chat, or to nobody
**Decision:** The merge line goes to the chat recorded as the feature's epic. When runcastle has handed that epic's features on to a replacement chat, the record already points there, so the line follows. When the epic's chat no longer exists, nobody is told.
**Why:** The epic a feature came from is its own field, kept apart from the owner by "One place to answer"; following it needs no new rule.

## 15. Merges in quick succession each get their turn
**Decision:** Each merge that passes the wake test is its own wake. Merges that land within the same moment (runcastle's short gathering window for news) join one turn; merges a minute apart are separate turns, the later one waiting behind the turn already running.
**Why:** Decision 4 accepted one turn per merge, and the later turn sees the earlier merge already on main, so its check stays correct. Joining merges that queue behind a busy turn would need new queueing in the agent host for a case that happens rarely.

## 16. A worker's handback is read from a turn its agent starts by itself
**Decision:** When a worker hands back in a turn its agent started by itself (a background command or sub-agent finished), runcastle reads that handback, as it does at the end of any other turn. A worker whose turn ends while background work still runs stays "working" rather than "needs you"; it comes to need the human only if it is still idle once the background window (10 minutes) passes.
**Why:** The human said "Fix it" (2026-11-12) after this feature's Review worker said it had handed back while the feature showed it as "needs you": its handback came in a self-started turn, which runcastle never checked. Fixed here because the review showed it, though it is not about merges.
