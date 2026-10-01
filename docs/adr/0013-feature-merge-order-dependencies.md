# ADR-0013: Feature merge-order dependencies

- **Status:** accepted (2026-10-01)
- **Deciders:** Muath + grilling session
- **Amends:** decision 24 of `docs/features/feature-grouping-forking-and-referencing/decisions.md`
  ("runcastle gains no stored relation between features")

## Context

ADR-0012 retired maps and waypoints and made the project session the size
gate: big intent is shape-grilled there and cut into several features, usually
parked drafts. Waypoint `blockedBy` was the one place an order between pieces
of work was stored. With it gone, the order between the features a cut produces
lived only as prose in their briefs, and nothing stopped anyone clicking
**Start** on a draft whose groundwork had not merged yet.

Decision 24 of `feature-grouping-forking-and-referencing` says runcastle stores
no relation between features. Its argument targets two things: *topical* edges
(`builds-on`, `related`), which are opinions that decay from the moment they are
written, and a generic `feature_links` table with a `kind` column that would mix
a derived fact, a decaying opinion and a transient computation under one write
mode.

## Decision

1. **One stored edge type: a merge-order dependency.** A draft (the dependent)
   may wait on other features in its project (the dependencies). This is not a
   topical edge. It is a gate with one job and a clear end: it is satisfied
   the moment the dependency's phase is `shipped`, and after that it is inert,
   like ticket `blockedBy`. It does not decay, because it either still gates or
   has stopped gating, and which one is derived at read time. Nothing is
   stored to mark it satisfied.

2. **It gates only a draft's Start, and nothing overrides it.** `startDraft`
   refuses while any dependency is unmerged. An archived dependency that never
   merged keeps blocking. Once a draft starts, its edges are history: they
   never gate Burn, ideation or session launches. The only lever is editing
   the set (`feature.setDependencies`, `set_feature_dependencies`, or
   `create_feature`'s `dependsOn` at cut time). Deleting a dependency
   cascades its edges away and puts an event on each dependent's timeline.

3. **The table is `feature_dependencies`, and it has no `kind` column.**
   `(dependentId, dependencyId, createdAt)`, composite primary key, both
   foreign keys `ON DELETE CASCADE`. The name and the missing `kind` are
   deliberate. They keep this from growing into the `feature_links` graph
   decision 24 rejected. **A second edge type needs a new ADR, not an enum
   value.**

4. **"Merged" inherits decision 25.** Satisfied means `phase === 'shipped'`.
   When decision 25 narrows "shipped" to "merged into main" (a fork merged into
   its parent is not yet shipped), this predicate follows unchanged. That is
   the right meaning, because the dependent is cut from main at Start.

Decision 24 otherwise stands: there are still no topical links, no grouping
and no lineage edge.

## Consequences

- The project session states a cut's order with `dependsOn` instead of brief
  prose, and re-orders parked drafts with `set_feature_dependencies`. A chat
  session can park scope creep that waits on its own feature.
- Both context reads carry the edges: the feature index shows them, and
  `get_feature_context` has `dependsOn` and `blocks`. Agents can tell what is
  startable and what a feature is holding up.
- Cycles, self-dependencies, cross-project edges and edges to an
  already-merged feature are refused when the edge is written.
- runcastle gains its first feature-edit path, scoped to dependencies only.
