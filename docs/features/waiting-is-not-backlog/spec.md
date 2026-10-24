# Waiting is not backlog

## Problem

The backlog does two jobs. It holds ideas the human has decided are "not now", and it holds features the human already wants, which only have to wait until something else ships. ADR-0013 lets only backlog features (status `draft`) carry merge-order dependencies, and those dependencies only gate the Start click. So a feature that waits must sit in the backlog, and when its dependency merges nothing happens: by design (`feature-dependencies-merge-order-gates` decision 6) it does not enter Needs you. The human has to remember to come back and click Start. Features they wanted get forgotten.

## Approach

### What the human gets

Two ideas, two places in the sidebar:

- **Backlog** means "not now". A backlog feature stays until the human starts it. It may still have dependencies; they only say whether it *could* start. It never asks for attention.
- **Up next** means "yes, as soon as X ships". An Up next (waiting) feature has at least one unshipped dependency. When the last one ships, it starts by itself, exactly as if the human had clicked Start: its branch is cut and its brief written, with no session launched and no tokens spent. It then appears as a normal started feature, which today puts it in Needs you as "needs planning".

If a waiting feature cannot or should not start by itself, it shows in Needs you with a Start button and the reason. That covers: the automatic start failed; its dependencies merged into different branches; nothing is left for it to wait on without it having started (a dependency was deleted, or the human removed its last open dependency); or one of its dependencies was archived.

The human moves a feature between the two on its own page. A backlog feature with an unshipped dependency gets **Start when ready** beside its disabled Start. A waiting feature gets **Move to backlog**. Starting cannot be undone; archiving is the way out.

### Shape

**Storage (decision 1).** One new boolean column on `features`, the waiting mark, named `upNext` (column `up_next`): "start by itself when what I wait on ships". It is deliberately not called `waiting`, because the feature row already has `waitingReason`, which means "the lead is waiting on the human" and is unrelated. It is meaningful only while `status = 'draft'`, and starting a feature (by click or by itself) clears it. No new `FeatureStatus` value: everything that reads `status === 'draft'` as "no branch exists yet" stays correct for a waiting feature. A migration adds the column defaulting to false, so every existing draft stays in the backlog (decision 9). `feature_dependencies` is unchanged and still has no `kind` column.

**Derived states (core, IO-free, next to the existing dependency rules).** For an unstarted feature with its dependencies (the `DependencyRef` list, each with `satisfied`, `status`, `phase`):

| State | When | Sidebar |
|---|---|---|
| `upNext` | waiting mark, ≥1 unshipped dependency, none of them archived | Up next |
| `stuck` | waiting mark, and either nothing unshipped left or an unshipped dependency that is archived | Needs you |
| `blocked` | no mark, ≥1 unshipped dependency | Backlog, chip `Blocked by <slug>` / `Blocked by N` |
| `readyToStart` | no mark, ≥1 dependency, all shipped | Backlog, chip `Ready to start`, sorts first |
| `backlog` | no mark, no dependencies | Backlog, chip `In the backlog` |

Satisfaction stays derived at read time (ADR-0013 point 4: satisfied means `phase === 'shipped'`). The stuck reason comes from the state itself, except "the automatic start failed" and "dependencies merged into different branches", which come from the newest auto-start event on the feature's timeline (see below); the feature list carries that message for an up-next draft so the sidebar can show it without a second query per row. The web and the server both use these helpers; the web never recomputes `satisfied`.

**Setting the mark (decisions 2, 8, 10).** One service function sets or clears the mark on an unstarted feature. Setting it is refused unless the feature is a draft with at least one unshipped dependency ("start when X ships" with no X is just Start). Clearing is always allowed on a draft. It emits `feature.upnext.changed`. It is reached from:
- a new tRPC procedure on the feature router, `setUpNext({ featureId, upNext })` (the page's two buttons);
- MCP `create_feature`: a new `upNext: true`, accepted only with `draft: true` and a non-empty `dependsOn`, and only from project-scoped sessions (the project session and the orchestrator). A feature session's `create_feature` passing `upNext` is refused with a message saying parked scope goes to the backlog and the human can mark it up next on its page;
- MCP `set_feature_dependencies`: a new optional `upNext` (omitted = unchanged), project-scoped as today. It applies after the new set is written, so `{ dependsOn: ['a'], upNext: true }` works in one call.

Editing dependencies on a waiting feature is allowed, as today. Removing its last open dependency does not clear the mark; the feature becomes `stuck` and shows in Needs you (decision 5).

**Starting by itself (decisions 3, 4, 6).** In the merge flow, after the feature has shipped and before its worktree is retired, a new step finds every dependent that has the waiting mark, is still a draft, and now has no unshipped dependency. For each:
- If all its dependencies' recorded base branches (where each one merged) are the same branch, it calls the same start path the Start click uses (`startDraft`) with that branch as the base. The start clears the mark. It emits a `feature.started` event whose message says it started by itself because `<x>` shipped, cut from `<base>`, and on the shipped feature's timeline an event saying it started `<y>`, which was waiting on it.
- If the bases differ, it does not start. It records `feature.autostart.skipped` on the dependent with the branches named.
- If the start throws (git refused, anything), it records `feature.autostart.failed` on the dependent with the error.

The whole step is best-effort: an error never fails or rolls back the merge, the same way the worktree retirement is handled. There is no retry sweep and no boot-time scan: a waiting feature left unstarted for any reason is `stuck`, which the sidebar puts in Needs you (decision 5). It works for merges from the Merge button and from the orchestrator's `merge_feature`, which share the flow.

Archived dependencies keep blocking, as in ADR-0013, and make the waiting feature `stuck`. A deleted dependency cascades its edges away as today; a waiting feature left with nothing to wait on becomes `stuck`.

**Chains (decision 14).** A waits on B, B waits on C: C's merge starts B (if B is waiting); A keeps waiting on B's merge. A waiting feature may wait on a backlog feature. While any of its unshipped dependencies is a backlog feature (a draft without the mark), the row's hover and its page say "won't start until you start `<b>`". It does not go to Needs you for that.

**Sidebar (decisions 7, 16).** A new triage lane, **Up next**, between the lanes of work in motion and Backlog. Its rows' chip reads `After <slug>` (or `After N`, list on hover), and the hover says it starts by itself when they ship (plus the backlog warning above when it applies). `stuck` features join Needs you: `needsMe` returns a reason for them, which the row's hover shows. The Backlog lane's chips become `Blocked by …`, `Ready to start` and `In the backlog`; ready-to-start rows sort first. Backlog features never enter Needs you. Up next, like Backlog, is not a landing lane when entering a project. The in-flight feature *Tickets and review are tools, not phases* regroups the sidebar. Up next is placed by meaning (after live work, before Backlog) so whichever feature lands second can fit it into the other's groups.

**Feature page (decisions 8, 13, 15).** The unstarted feature's next-step bar:
- `blocked`: Start and Plan it yourself stay disabled with today's reason; a new **Start when ready** action marks it waiting. Its caption says it starts by itself when `<x>` ships and that this cannot be undone.
- `upNext`: the bar reads "Starts by itself when `<x>` ships" (or "won't start until you start `<b>`"), with **Move to backlog**.
- `stuck`: the stuck reason is the description, plus **Move to backlog**. When nothing unshipped is left, Start and Plan it yourself are enabled, as for any startable draft; when the reason is "different branches", the base picker is not preselected. When a dependency was archived, Start stays disabled with today's reason ("archived — remove it to start"), because ADR-0013's Start gate still holds.
- `readyToStart` / `backlog`: unchanged (Start, Plan it yourself).

The dependency's page splits ADR-0013's read-only **Blocks:** line into **Starts when this ships:** (its waiting dependents; one that still waits on something else after this says so, e.g. "`y` (also waits on `z`)") and **Blocks:** (its backlog dependents). Both stay read-only.

**Agent reads (decision 11).** `FeatureListItem` and `FeatureFull` carry the mark. The portfolio index line marks unstarted features `[draft, up next]` or `[draft, blocked]` (and `[draft, up next, stuck]` for stuck ones), replacing today's `[draft, waiting]`; `get_feature_context`'s header carries the mark as `upNext`. `blocks` (the unmerged dependents) carries each one's mark too.

**Skill text (decision 11).** The project skill's create step asks per feature: start now, up next after X, or backlog. Order is stated with `dependsOn`, and `upNext: true` marks the up-next ones. Its orchestrator part says waiting features start themselves when their dependencies merge, and backlog features stay its call. The ideate skill's parking step stays "park in the backlog", adding one line that the human can mark it waiting on its page. Tool descriptions for `create_feature` and `set_feature_dependencies` describe `upNext`.

**ADR.** This amends ADR-0013 ("only drafts wait, and the dependency gates only Start"): a draft may now carry the waiting mark, and a dependency's merge starts its waiting dependents. The project session writes that ADR when this ships, from `decisions.md`. Not part of the tickets.

## Seams

- **Core dependency rules (existing module, new functions).** The pure helpers that classify an unstarted feature into `upNext` / `stuck` / `blocked` / `readyToStart` / `backlog` and give the reason. Observe: the state for every combination of mark, satisfied, archived, draft dependency. Unit-tested with no IO.
- **Dependencies service (existing).** Setting and clearing the mark, with its refusals and its event. Observe through the service against a test database, as the existing feature-dependency tests do.
- **Merge flow (existing seam: `mergeFeatureFlow`).** The automatic start. Observe: after merging a dependency in a test repo, the waiting dependent is `active` with its branch cut from the dependency's base and its mark cleared; mixed bases and a start that throws leave it a draft with the right event; the merge itself always succeeds. This is the one seam the core behaviour is proven at.
- **MCP tools (existing: `toolCreateFeature`, `toolSetFeatureDependencies`, the feature index line, `get_feature_context`).** Observe: `upNext` accepted and refused by session kind and shape; the index marks.
- **tRPC feature router (existing router, new procedure).** The page's two buttons.
- **Web sidebar derivations (existing pure module).** `triage`, `rowChip`, `needsMe`, `sortForSidebar` over wire data. Observe: lanes, chips and order for each state; tested like the existing sidebar tests.
- **Web next-step resolver for drafts (existing pure module).** Observe: the bar for each state.
- **Feature page dependency lines (existing component).** The split Blocks line.

## Out of scope

- Started features waiting on others (plan now, build or merge later). The brief excludes it.
- Topical links between features (`builds-on`, `related`). ADR-0013 keeps them out.
- The new derived status model and its sidebar regrouping (*Tickets and review are tools, not phases*). This feature only adds the Up next lane and changes the Backlog lane.
- Planning a feature automatically when it starts by itself ("Plan it yourself" on auto-start).
- Undoing a start (decision 15).
- A toast or popup when a feature starts by itself (decision 6).
- A sidebar right-click action to move between backlog and Up next (decision 8).
- Converting existing drafts (decision 9). After this ships, the human or project session marks `one-orchestrator-no-mode` and `designs-wait-for-you` as waiting.
- Writing the ADR amending ADR-0013.

## Open questions

- The decisions were made without the human. Check first: who may mark a feature waiting (10, challenged), whether existing drafts are converted (9), what happens when the human removes a waiting feature's last open dependency (5, challenged), the "Up next" name and chip words (7), and waiting as a mark rather than a status (1).
- If *Tickets and review are tools, not phases* lands first and changes what a just-started feature looks like in the sidebar, "needs planning in Needs you" (decision 6) follows whatever that feature decides for a newly started feature.

## Later laps

None planned: the whole feature is lap 1 (decision 12).
