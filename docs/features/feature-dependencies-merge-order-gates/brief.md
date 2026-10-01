Surfaced during `retire-mapped-ideation-waypoints-and-converge` ideation (2026-09-29). That feature removes maps and waypoints outright and makes the project session the size gate: big intent is shape-grilled there and then cut into several features, usually drafts. Waypoints had `blockedBy`, which let a map express ordering. Once maps are gone, nothing records the order between the features a cut produces except prose in their briefs. This feature is the replacement: a stored merge-order dependency between features.

The operator's framing: when creating a draft feature, you can add a dependency on another feature (draft or started) that must be merged before the user can work on the dependent one.

It overturns a recorded decision, so it needs an ADR. `feature-grouping-forking-and-referencing` decision 24 says "runcastle gains no stored relation between features". That reasoning targets *topical* edges (builds-on/related), which are opinions that decay from the moment they are written. A merge-order dependency is a different kind of thing: a gate with one job and a clear end. It is satisfied the moment the dependency merges and is inert afterwards, like ticket `blockedBy`. Put this argument in an ADR that amends decision 24 explicitly. Do not reintroduce topical links, grouping, or a general `feature_links` graph with edge kinds.

Open design questions for this feature's own grill:
- What exactly is gated: only the draft's Start click, or also ideation or Burn on an already-started feature?
- What "merged" means: shipped to main, or merged into its base? Forks that merge into a parent show "Merged into <parent>" and not shipped (decision 25 there).
- What happens when a dependency is archived or abandoned: does the gate need an override, or should it drop?
- Cycles and self-dependencies are refused at write time.
- How it shows in the rail and the workspace (e.g. "waiting on <slug>"), and whether the rail's triage lanes need to know.
- Whether the project session's `create_feature` takes dependencies at cut time. It should: that is where the ordering is known. The same goes for ideate's scope-creep parking.
- Whether dependencies can be edited after creation, and from where.

Must NOT swallow: the retirement of maps, waypoints and converge (its own feature; this one does not depend on it and is not blocked by it), and anything about grouping or clustering in the rail.
