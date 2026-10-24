# Brief

## Why this feature exists

The human, 2026-10-24, after the project session parked two features behind a running one: "Once I finish that feature, the ones that no longer have a dependency will stay in the backlog and I'll forget about them. I feel like we have to distinguish between dependencies and backlog. Like a feature in the backlog can have a dependency but also a feature that's not in the backlog should be able to have a dependency. Maybe we can show those differently and once the dependencies clear, they show up as normal features."

Today one flag does two jobs. ADR-0013 (docs/adr/0013-feature-merge-order-dependencies.md) lets only **drafts** carry dependencies, and the dependency gates only their Start. So anything that waits must also sit in the backlog. And `feature-dependencies-merge-order-gates` decision 6 says on purpose that a dependency merging does **not** push its dependent into Needs you. The result: a wanted feature silently sits in the backlog after its dependency ships.

## Settled with the human

- **Two separate ideas.**
  - **Backlog** means "not now". It is the human's choice, and the feature stays there until they start it. It may still have dependencies, which then only say whether it *could* start.
  - **Waiting** means "yes, as soon as X ships". It is not in the backlog and shows in its own place in the sidebar, something like "Up next — waits on X".
- **A waiting feature starts by itself when its last dependency ships.** It cuts its branch from the branch the dependency merged into, then appears as a normal feature. This launches no session and spends no tokens. The human already said "yes, after X", which is what makes starting on its own unsurprising.
- **Only features that have not started can wait.** A started feature that plans now and waits to build or merge was considered and left out by the human ("I don't think we need that for now"). It belongs to no lap.

## Open — for this feature to decide

- How "waiting" and "backlog" look in the sidebar, and whether a backlog feature whose dependencies have all shipped says so (e.g. "could start now").
- How the human moves a feature between backlog and waiting.
- What the human sees when a waiting feature starts by itself (a line under Needs you? a timeline event?).
- **Dependencies that merged into different branches**, or a base branch that no longer exists at auto-start: which base, or fall back to asking.
- **Existing drafts with unshipped dependencies** when this lands. `one-orchestrator-no-mode` and `designs-wait-for-you` were parked only because they wait on `tickets-and-review-are-tools-not-phases`; the human means them as waiting, not backlog. Decide whether existing drafts with unshipped dependencies become waiting automatically, or whether the human converts them in one click.
- **Agent surfaces.** `create_feature`'s `dependsOn` is accepted only with `draft: true` today, and `set_feature_dependencies` edits drafts only (packages/server/src/mcp/server.ts). Both need a waiting shape, and the project skill's cut step (§1c, "State the cut's order as `dependsOn`") must say when to make a feature waiting versus backlog.

## Must not swallow

- **Started features waiting on others** (see above). Out of scope.
- **Topical links between features** (`builds-on`, `related`). ADR-0013 keeps them out, and this does not reopen that.
- **The new status model.** `tickets-and-review-are-tools-not-phases`, in flight, derives each feature's status from what is happening and regroups the sidebar by it. This feature adds the waiting group and changes the backlog group. Both touch the sidebar's grouping (apps/web/src/lib/feature-ui/sidebar.ts and apps/web/src/components/Sidebar.tsx), so whichever lands second adjusts. Read its branch before changing the grouping.

## Ordering

Runs in parallel with `tickets-and-review-are-tools-not-phases`; nothing waits on it. The sooner it ships, the sooner the two features parked behind that one can be marked waiting.

## Charter / ADR

This amends ADR-0013, which says "only drafts wait, and the dependency gates only Start". The project session writes the ADR when this ships. Record the decisions in decisions.md so it can be written from them.
