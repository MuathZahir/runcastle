# ADR-0012: Retire mapped ideation

- **Status:** accepted (2026-09-30)
- **Deciders:** Muath + grilling session
- **Supersedes:** ADR-0001 (mapped ideation)

## Context

ADR-0001 gave big features a second ideation mode: escalate to a map of typed
waypoints (grilling, research, prototype, task), work each in its own
`waypoint` session, then close out in a `converge` session into one spec and
one branch. Only 5 of 153 features were ever mapped, and none since
2026-08-28. The two real ones both shipped as single features; the other three
sit in the demo project with every waypoint resolved or dropped.

Meanwhile the project session already does the job maps were for, in a better
shape: it takes a lump of intent and cuts it into several features, each with
its own brief, laps and merge. The map machinery still cost two session kinds,
three MCP tools, an AFK research workflow, per-kind tool filtering and a map
branch through the UI — and every prompt and skill had to keep accounting for
a mode nobody entered. The one real gap: the project session cut big intent
with no grilling at all, so it misjudged size.

## Decision

1. **Full removal, not a soft retire.** `escalate_to_map`, `emit_waypoints`,
   `resolve_waypoint`, the `waypoint` and `converge` session kinds and their
   skills, ideate's escalation branch, the map UI, the `waypoints` table and
   `features.mapped` all go. Formerly mapped features become ordinary
   features; their `map.md`, `research/` and `prototypes/` stay on disk as
   plain docs. Git history is the archive. (Rejected: closing only the entry
   point — it keeps every carrying cost and none of the simplification.)

2. **The project session is the size gate, and it shape-grills before
   cutting.** "Too big for one session" is caught before a feature exists.
   The project session asks one question at a time, each with a
   recommendation, breadth-first across the main ideas, and only what could
   change the cut: the pieces, the core, where the human is unsure and what
   they would test-drive first, and how wide each piece is. It stops at the
   cut, locks no decisions and writes no feature docs; what it learned goes
   into each brief. Every feature it creates must be thinkable in one
   ideation window. It is a shape griller, not a design griller.

3. **Ideation has no escalation branch.** A feature that turns out bigger
   than expected mid-grill gets a thin lap 1, with the deferred scope parked
   under the spec's `## Later laps` (ADR-0010). An oversized lap defers into
   later laps the same way.

4. **The AFK research workflow goes with the maps.** Only research waypoints
   could trigger it. Sessions research inline with subagents; a question too
   big for that becomes a spike feature cut by the project session.

5. **Nothing replaces the single converged spec.** Each feature cut from big
   intent gets its own spec, laps and merge. Cross-feature truth lives where
   it already lives — ADRs and the charter, the feature index and work
   record, and the briefs, which carry the ordering between sibling features
   as prose. Features that must land together use a fork, which merges into
   its parent and rides the parent to main.

## Consequences

- One ideation mode: project session → feature → ideate → spec → tickets →
  burn → merge.
- The session kinds shrink to the ones that launch; stored `waypoint` and
  `converge` sessions read back as `chat`. Past `waypoint.*`, `research.*` and
  `feature.escalated` events stay as timeline history, and a `stepModels` key
  for a retired step is ignored on load.
- Big intent loses its one atomic branch; that trade was accepted by choosing
  independent features over maps.
- Merge-order dependencies between features are not part of this change —
  until something enforces them, the order lives in the briefs.
