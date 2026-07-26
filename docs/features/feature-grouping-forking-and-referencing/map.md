# Feature grouping, forking, and referencing — map

## Destination

runcastle gains project-level memory and project-level entry points — durable knowledge that outlives a feature, cross-feature access to it, a session that is not bound to any feature, explicit relations between features, and a way in for work too small to deserve one.

## Notes

**Where this came from.** The seed was "grouping, forking, referencing." Grilling resolved those into three symptoms of one gap: runcastle has feature-level memory but no project-level memory. See `decisions.md` 1–5 for what is already locked.

**Facts established (do not re-derive):**
- A *merged* feature's docs are already on disk in any later feature's worktree — verified: `docs/features/streamlining-user-experience/` is readable from this worktree because that branch merged. So the merged case needs discovery (pointer + index), not cross-branch reads.
- An *in-flight* feature's docs live only on its own branch and are genuinely unreadable across branches — but the human confirmed the driving case is merged work, so this is not the requirement.
- Git-level forking already exists: `feature.create` takes `baseBranch`, and the New Feature form has a "Branch from" picker. What is missing is a *knowledge* link, not a branch one.
- runcastle-the-repo already uses ADRs (`docs/adr/0001–0006`) and `docs/agents/domain.md`. runcastle-the-*product* does not: the shipped skill pack (`packages/skills/packs/runcastle/skills/ideate/SKILL.md`) and the injected system prompt (`renderSystemPrompt` in `packages/server/src/launcher/artifacts.ts`) name only brief/decisions/spec, never ADRs or `CONTEXT.md`.
- `sessions.feature_id` and `tickets.feature_id` are both `NOT NULL` (`packages/core/src/db-schema.ts`) — the schema currently assumes every session and every ticket belongs to a feature.
- `tickets.seams` is a stored JSON column, so cross-feature collision detection has the data it needs already.
- Mapped ideation (waypoints, ADR-0001) already solves decomposition *within* a feature. Every question on this map is about the space *between* features.

**Constraints carried in:**
- `CONTEXT.md` design principle: flexible guidance over brittle machinery — when in doubt, less mechanism. Prefer edges over new entities, presets over parallel systems.
- `CONTEXT.md` decision #7 already licenses a size-aware pipeline ("small features may collapse Spec+Tickets — explicit choice"), so the quick-change path has precedent and does not need a new entity.
- Doc types decay differently: `decisions.md` and ADRs record *why* (durable); `spec.md` records intent at a moment (decays against code). Proposed but NOT yet locked: cross-feature reads should carry decisions and briefs, never specs.
- Proposed but NOT yet locked: link, never copy — a copied doc is a second source of truth that starts drifting immediately.

**Ideas raised, parked for the waypoint that owns them:** a question-shaped `why(...)` tool returning cited answers rather than keyword hits; indexing burn outcomes (failures, review findings, retries) as project knowledge; recurring burner failures graduating into `CLAUDE.md` rules; cross-feature conflict detection on overlapping ticket `seams`; "main moved under you" drift warnings for long-running features; shipped features as a free changelog; the observation from `ask-matt` that Matt's flow has three on-ramps (grill / triage / diagnose) where runcastle has exactly one (New Feature).

**Converge criterion.** This map is unusual: decision 5 records that the scope is genuinely *several shippable features*, not one big one — it is a map only because runcastle cannot yet create features from anywhere but the New Feature form. Expect the converge session to cut this into a small first feature (most likely knowledge tiers + promotion, or the project-level session) rather than one spec covering the whole destination.

## Not yet specified

## Out of scope
