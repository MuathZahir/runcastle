# Decisions — Waiting is not backlog

Planned without the human (self-planning run, 2026-10-24). Every decision below is
assumed until the human confirms it.

Terms used throughout:
- **Backlog feature** — an unstarted feature (status `draft`: a database row, no branch) that waits for the human's Start. "Not now."
- **Waiting feature** — an unstarted feature the human has said yes to, which starts by itself when its last unshipped dependency ships. "Yes, as soon as X ships."
- **Dependency** — a merge-order edge from ADR-0013 (`feature_dependencies`): the dependent may not start until each dependency has shipped.

## 1. Waiting is a mark on an unstarted feature, not a new status
**Decision:** A waiting feature is still an unstarted feature (status `draft`, no branch) that carries one extra stored mark: "start by itself when what I wait on ships". The backlog is every unstarted feature without that mark. Everything that today treats a draft as "not started yet" keeps working unchanged. Starting the feature clears the mark.
**Why:** Dozens of places read `status === 'draft'` to mean "no branch exists yet", and that stays true of a waiting feature. A new status would have to be taught to every one of them for no gain. The in-flight feature *Tickets and review are tools, not phases* derives each feature's status from what is happening, and a stored intent mark fits that model better than another stored status.
**Assumed.** Alternative: a new feature status `waiting` beside `draft`, `active`, `shipped` and `archived`.

## 2. Only a feature with something unshipped to wait on can be waiting
**Decision:** Marking a feature waiting is refused unless it has at least one dependency that has not shipped. A feature with nothing left to wait on is either started or in the backlog.
**Why:** "Start when X ships" with no X is just Start. Refusing it keeps the waiting group honest: everything in it is waiting on something you can name.
**Assumed.** Alternative: allow it, and start the feature at once.

## 3. When the last dependency ships, the waiting feature starts by itself
**Decision:** The merge flow, right after a feature ships, starts every waiting feature whose last unshipped dependency was that one. "Starts" means exactly what the human's Start does: cut `feature/<slug>`, write the brief, mark it started. It launches no session and spends no tokens; the feature arrives at planning like any feature the human just started. This is best-effort after the merge has landed: a failure never fails the merge.
**Why:** This is the brief's settled behaviour. The human already said "yes, after X", so starting on X's merge is what they asked for. It is plain Start, not "Plan it yourself", because planning spends tokens and the human did not ask for that.
**Assumed.** Alternative: only announce it ("ready to start") and leave the click to the human.

## 4. The new branch is cut from the branch the dependencies merged into
**Decision:** The auto-start cuts from the branch the dependencies merged into (each dependency's recorded base). When a feature waits on several and they merged into different branches, it does not guess: it does not start, and it asks the human (decision 5) with the branches named.
**Why:** The waiting feature builds on its dependencies' work, which lives on the branch they merged into. The branch that was just merged into exists by definition, so a missing base only matters in the mixed case, and there no rule is safe.
**Assumed.** Alternative: always cut from the project's main branch.

## 5. Anything that stops a waiting feature from starting puts it in Needs you
**Decision:** A waiting feature lands in Needs you, with a Start button and the reason, whenever it cannot or should not start by itself: the automatic start failed, its dependencies merged into different branches, it has nothing left to wait on without having started (a dependency was deleted, or its last open dependency was removed), or a dependency it waits on was archived. This is worked out from the feature's current state every time the sidebar reads it, so a server crash between the merge and the start also ends here. There is no retry sweep.
**Why:** The whole point of the feature is that nothing wanted gets forgotten. A waiting feature that quietly stopped waiting would be the same bug again. An archived dependency will never ship, so "yes, after X" can no longer come true on its own, and only the human knows whether the feature still makes sense.
**Assumed.** Alternative: a failed start stays in the waiting group with a warning chip.
**Challenged:** when the human removes the last open dependency themselves, sending the feature to Needs you is an extra step; ask right there at edit time ("Nothing left to wait on. Start now, or move to backlog?") and keep Needs you for the cases the human did not cause.

## 6. An automatic start shows as a timeline line on both features, and the feature needs planning
**Decision:** The started feature's timeline gets "started by itself: `x` shipped" (with the base it was cut from), and the dependency's timeline gets "started `y`, which was waiting on this". The started feature then sits wherever any newly started feature sits; today that is Needs you as "needs planning". No toast and no popup.
**Why:** The sidebar moving the row from Up next into the live lanes is the signal, and Needs you already catches a feature with no plan. The two timeline lines make the start explainable afterwards from either side.
**Assumed.** Alternative: a one-time notice on the merge result ("also started `y`").

## 7. The sidebar gets an "Up next" group, and backlog chips stop saying "Waits on"
**Decision:** A new sidebar group, **Up next**, sits between In progress and Backlog and holds waiting features. Its rows' chip reads `After <slug>` (or `After N` with the list on hover) and the hover says it starts by itself when they ship. The word "waits" now belongs to Up next, so Backlog chips change: `Blocked by <slug>` while a dependency is unshipped, `Ready to start` once every dependency it had has shipped, and `In the backlog` when it never had any. Ready-to-start rows sort first in Backlog, as startable drafts do today. A backlog feature never enters Needs you: the backlog is the human's "not now".
**Why:** The human asked for waiting features to be shown on their own, and for the two ideas not to share one look. The "Ready to start" chip answers the brief's open question without breaking the rule that the backlog claims no attention.
**Assumed.** Alternative: keep one Backlog group and show waiting features as a sub-group inside it.

## 8. The human moves a feature between backlog and waiting on its page
**Decision:** On an unstarted feature's page, the next-step bar offers the move. A backlog feature with an unshipped dependency keeps its disabled Start and gains **Start when ready** ("starts by itself when `x` ships"), which marks it waiting. A waiting feature's bar says "Starts by itself when `x` ships" and offers **Move to backlog**. A backlog feature with nothing unshipped to wait on just has Start. The existing "Waits on" row on the page still edits the dependency set for both.
**Why:** That page is where the human already edits dependencies and clicks Start, so the move sits beside the thing it changes. One button each way, no settings.
**Assumed.** Alternative: also put the move in the sidebar row's right-click menu.

## 9. Existing backlog features are not converted automatically
**Decision:** When this lands, every existing unstarted feature stays in the backlog, dependencies or not. The human (or the project session) marks the ones they mean as waiting, one click each. The outcome notes the two the brief names, `one-orchestrator-no-mode` and `designs-wait-for-you`, as the ones to mark.
**Why:** Today's backlog mixes both meanings, including scope creep that feature sessions parked as "not now" with a dependency on their own feature. A blanket conversion would make those start by themselves, which is the opposite of what parking them meant. Two clicks fix the cases the human named.
**Assumed.** Alternative: convert every unstarted feature with an unshipped dependency to waiting in the migration.

## 10. Only the project session and the orchestrator can make a feature waiting
**Decision:** `create_feature` gains `upNext: true`, accepted only with `draft: true` and a non-empty `dependsOn`. `set_feature_dependencies` gains an optional `upNext` to move a feature either way. Both are open to project-scoped sessions (the project session and the orchestrator) only. A feature's own sessions still park scope creep in the backlog, exactly as today.
**Why:** Waiting starts a feature without a click, so it should only come from a conversation where the human agreed an order of work, which is the project session's cut. Scope creep parked mid-grill is "not now" by definition; the human can still mark it waiting in one click.
**Assumed.** Alternative: let a feature chat mark parked scope as waiting when the human says so in that chat.
**Challenged:** what makes an automatic start safe is the human's consent, not which session heard it. "Do this right after this feature ships" is natural to say mid-grill, and under this decision it lands in the backlog anyway, which brings the original complaint back through another door. Keep backlog as the ideate default, with waiting only on an explicit "after this".

## 11. The agents' instructions and reads learn the difference
**Decision:** The project skill's create step asks, per feature, "start now, up next after X, or backlog?", and states order with `dependsOn` plus `upNext: true` for the up-next ones. Its orchestrator part says waiting features start themselves and backlog features stay its call. The portfolio index marks unstarted features `[draft, up next]` or `[draft, blocked]` (backlog with an open dependency), and `get_feature_context` carries the mark. The ideate skill's parking step is unchanged: parked scope goes to the backlog.
**Why:** Without this, the project session keeps putting everything ordered into the backlog, and the human's complaint comes straight back.
**Assumed.** Alternative: leave the skill text alone and rely on the tool descriptions.

## 12. One lap
**Decision:** The whole feature is specced for lap 1. Nothing is deferred to a later lap.
**Why:** The brief settled the shape with the human; what is left is a stored mark, one hook in the merge flow, a sidebar group and two buttons. It fits one lap and is easy to test-drive end to end: mark a feature waiting, merge its dependency, watch it start.
**Assumed.** Alternative: a thin lap 1 with the mark and the sidebar group, and the automatic start in lap 2.

## 13. A feature's page says what its merge will start
**Decision:** The read-only "Blocks" line on a dependency's page (ADR-0013's decision 6) splits in two: **Starts when this ships:** lists the waiting features its merge will start, and **Blocks:** lists the backlog features it holds up. Both stay read-only there, edited only from the dependent's page.
**Why:** Merge is the click that now has a side effect, so the human should see that side effect before clicking it, on the page where the Merge button lives.
**Assumed.** Alternative: keep one "Blocks" line and mark the waiting ones in it.

## 14. A waiting feature may wait on a backlog feature, and says so
**Decision:** Waiting on a feature that is itself in the backlog is allowed. While any dependency is a backlog feature, the Up next row's hover and the waiting feature's page say "won't start until you start `b`". It does not enter Needs you for this: `b` being in the backlog is the human's own "not now". Chains work one step at a time: when A waits on B and B waits on C, C's merge starts B, and A keeps waiting on B's merge. Each row and each "Starts when this ships" line shows its own step only.
**Why:** Refusing it would stop the human stating an order before they know when they will start `b`. The warning is what keeps A from looking like it is on its way while nothing will move it.
**Assumed.** Alternative: refuse to mark a feature waiting while any dependency is in the backlog.

## 15. An automatic start cannot be undone
**Decision:** There is no "unstart". Once a waiting feature starts by itself it is a started feature like any other, and archiving is the way out if the human changes their mind. The **Start when ready** button's caption says plainly that it starts by itself when `x` ships.
**Why:** Starting cuts a branch and writes the brief there. Undoing that means deleting a branch and possibly work, which is a bigger feature than this one and rarely needed: the start spends no tokens, so a feature started too early costs nothing to leave alone or archive.
**Assumed.** Alternative: a "Back to backlog" action on a started feature that has no work yet, deleting its branch.

## 16. The Up next group is placed by meaning, so it survives the status-model rework
**Decision:** Up next sits after the groups of work in motion and before Backlog, whatever those groups are named when this burns. The in-flight feature *Tickets and review are tools, not phases* regroups the sidebar; whichever of the two lands second fits the other's groups, and the tickets that touch the sidebar read that feature's branch first.
**Why:** The brief requires it, and placing the group by meaning (after live work, before "not now") gives the second feature a rule to follow instead of a name to match.
**Assumed.** Alternative: this feature waits for the status-model feature to merge first.

Challenge pass: one separate agent read only the brief and this file. Its four gaps became decisions 14 to 16 (two of them merged into 14). It disagreed with decisions 5 and 10; both are marked above, and the planner's answers stand.
